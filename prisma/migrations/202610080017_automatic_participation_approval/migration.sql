-- Matching approved, active members receive a tournament slot automatically.
-- Applications, eligibility and their audit events commit together.
CREATE OR REPLACE FUNCTION app_submit_participation(
  request_id text, member_id text, canonical_ign text, verified_record text, audit_id text
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE event_id text; saved_id text; slot_id text; slot_code text; next_code integer; capacity_limit integer; changed boolean; approved boolean;
BEGIN
  IF request_id IS NULL OR audit_id IS NULL THEN RAISE EXCEPTION 'Invalid participation'; END IF;
  -- Serialize roster/contact changes with verification, and reject a record
  -- changed since the server checked it. IDs alone cannot bypass the check.
  PERFORM m.id FROM "Member" m JOIN "MemberPrivate" p ON p."memberId"=m.id
    WHERE m.id=member_id AND m."canonicalIgn"=canonical_ign AND m.verified AND NOT m.archived
      AND p."registrationEncrypted"=verified_record FOR SHARE OF m,p;
  IF NOT FOUND THEN RETURN 'VERIFICATION_FAILED'; END IF;
  -- The individually shared link can collect requests while the original event
  -- is a draft. Closed, started, archived and past-deadline events reject entry.
  SELECT t.id INTO event_id FROM "Tournament" t JOIN "IntegrationSetting" s
    ON s.key='officialSeedTournament' AND t.id=s.value #>> '{}'
    WHERE t.slug='pailangz-solo-team' AND NOT t.published AND t.status IN ('DRAFT','REGISTRATION_OPEN')
      AND (t."registrationDeadline" IS NULL OR t."registrationDeadline">now())
      AND EXISTS(SELECT FROM "Category" c WHERE c."tournamentId"=t.id AND c.kind='SOLO')
      AND EXISTS(SELECT FROM "Category" c WHERE c."tournamentId"=t.id AND c.kind='TEAM')
    FOR UPDATE OF t;
  IF event_id IS NULL THEN RETURN 'CLOSED'; END IF;
  -- Count one shared player pool, including any staff-assigned entrants.
  SELECT LEAST(32,c.capacity) INTO capacity_limit FROM "Category" c
    WHERE c."tournamentId"=event_id AND c.kind='SOLO';
  SELECT p.id INTO saved_id FROM "ParticipationRequest" p
    WHERE p."tournamentId"=event_id AND p."memberId"=member_id;
  SELECT p.id,p.code,p.eligible AND NOT p.provisional INTO slot_id,slot_code,approved
    FROM "Participant" p WHERE p."tournamentId"=event_id AND p."memberId"=member_id;
  IF saved_id IS NOT NULL AND approved THEN RETURN 'ACCEPTED'; END IF;
  IF saved_id IS NULL AND slot_id IS NULL AND (
    SELECT count(*) FROM (
      SELECT p."memberId" FROM "ParticipationRequest" p WHERE p."tournamentId"=event_id
      UNION SELECT p."memberId" FROM "Participant" p WHERE p."tournamentId"=event_id
    ) players
  ) >= capacity_limit THEN RETURN 'FULL'; END IF;
  IF slot_id IS NULL AND (SELECT count(*) FROM "Participant" p WHERE p."tournamentId"=event_id) >= capacity_limit
    THEN RETURN 'FULL'; END IF;
  INSERT INTO "ParticipationRequest" (id,"tournamentId","memberId")
    VALUES(request_id,event_id,member_id)
    ON CONFLICT ("tournamentId","memberId") DO NOTHING
    RETURNING id INTO saved_id;
  changed := FOUND;
  IF changed THEN
    INSERT INTO "AuditEvent" (
      id,"actorRole",action,"entityType","entityId","tournamentId","correlationId",source,changes,"relatedIds"
    ) VALUES (
      audit_id,'PUBLIC','PARTICIPATION_SUBMIT','PARTICIPATION',saved_id,event_id,audit_id,'PARTICIPATION_FORM',
      jsonb_build_object('categories',jsonb_build_array('SOLO','TEAM')),ARRAY[member_id]
    );
  END IF;
  IF NOT changed THEN
    SELECT p.id INTO saved_id FROM "ParticipationRequest" p
      WHERE p."tournamentId"=event_id AND p."memberId"=member_id;
  END IF;
  IF slot_id IS NULL THEN
    SELECT COALESCE(max(substring(p.code FROM '^P([0-9]+)$')::integer),0)+1 INTO next_code
      FROM "Participant" p WHERE p."tournamentId"=event_id;
    slot_code := 'P' || lpad(next_code::text,GREATEST(2,length(next_code::text)),'0');
    slot_id := gen_random_uuid()::text;
    INSERT INTO "Participant" (id,"tournamentId","memberId",code,eligible,provisional)
      VALUES(slot_id,event_id,member_id,slot_code,true,false);
  ELSE
    UPDATE "Participant" SET eligible=true,provisional=false WHERE id=slot_id;
  END IF;
  IF NOT COALESCE(approved,false) THEN
    INSERT INTO "AuditEvent" (
      id,"actorRole",action,"entityType","entityId","tournamentId","correlationId",source,changes,"relatedIds"
    ) VALUES (
      gen_random_uuid()::text,'SYSTEM','PARTICIPATION_AUTO_APPROVE','PARTICIPATION',saved_id,event_id,audit_id,'PARTICIPATION_FORM',
      jsonb_build_object('categories',jsonb_build_array('SOLO','TEAM'),'eligible',true,'code',slot_code),ARRAY[member_id,slot_id]
    );
  END IF;
  RETURN 'ACCEPTED';
END $$;
REVOKE ALL ON FUNCTION app_submit_participation(text,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_submit_participation(text,text,text,text,text) TO pailangz_app;

-- Existing verified applications receive the same approval, in submission order.
-- Closed events and inactive members remain untouched; no fixtures are generated.
DO $$
DECLARE application record; outcome text;
BEGIN
  FOR application IN
    SELECT a.id,m.id AS member_id,m."canonicalIgn",mp."registrationEncrypted"
    FROM "ParticipationRequest" a JOIN "Member" m ON m.id=a."memberId"
    JOIN "MemberPrivate" mp ON mp."memberId"=m.id
    JOIN "Tournament" t ON t.id=a."tournamentId"
    JOIN "IntegrationSetting" s ON s.key='officialSeedTournament' AND s.value #>> '{}' = t.id
    WHERE t.slug='pailangz-solo-team' AND NOT t.published
      AND t.status IN ('DRAFT','REGISTRATION_OPEN')
      AND (t."registrationDeadline" IS NULL OR t."registrationDeadline">now())
      AND m.verified AND NOT m.archived
    ORDER BY a."createdAt",a.id
  LOOP
    outcome := app_submit_participation(application.id,application.member_id,
      application."canonicalIgn",application."registrationEncrypted",gen_random_uuid()::text);
    IF outcome NOT IN ('ACCEPTED','FULL') THEN RAISE EXCEPTION 'Existing application approval failed'; END IF;
  END LOOP;
END $$;
