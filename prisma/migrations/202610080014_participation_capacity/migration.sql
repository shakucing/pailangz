-- The combined PAILANGZ event accepts 32 distinct player applications.
CREATE OR REPLACE FUNCTION app_submit_participation(
  request_id text, member_id text, canonical_ign text, verified_record text, audit_id text
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE event_id text; saved_id text; changed boolean;
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
    WHERE t.slug='pailangz-solo-team' AND t.status IN ('DRAFT','REGISTRATION_OPEN')
      AND (t."registrationDeadline" IS NULL OR t."registrationDeadline">now())
      AND EXISTS(SELECT FROM "Category" c WHERE c."tournamentId"=t.id AND c.kind='SOLO')
      AND EXISTS(SELECT FROM "Category" c WHERE c."tournamentId"=t.id AND c.kind='TEAM')
    FOR UPDATE OF t;
  IF event_id IS NULL THEN RETURN 'CLOSED'; END IF;
  -- The tournament row lock serializes every applicant, not just retries by
  -- one member. Check retries first so an accepted player can retry at capacity.
  IF EXISTS(SELECT FROM "ParticipationRequest" p
    WHERE p."tournamentId"=event_id AND p."memberId"=member_id)
    THEN RETURN 'ACCEPTED'; END IF;
  IF (SELECT count(*) FROM "ParticipationRequest" p WHERE p."tournamentId"=event_id) >= 32
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
  RETURN 'ACCEPTED';
END $$;
REVOKE ALL ON FUNCTION app_submit_participation(text,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_submit_participation(text,text,text,text,text) TO pailangz_app;
