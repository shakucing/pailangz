-- Formats have independent player pools and registration. Historical combined
-- configurations (no format property) remain readable until explicitly split.
CREATE FUNCTION app_tournament_player_capacity(event_id text) RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT COALESCE(
   (SELECT capacity FROM "Category" WHERE "tournamentId"=event_id AND kind='SOLO'),
   (SELECT capacity*4 FROM "Category" WHERE "tournamentId"=event_id AND kind='TEAM')
 )
$$;
REVOKE ALL ON FUNCTION app_tournament_player_capacity(text) FROM PUBLIC;

CREATE OR REPLACE VIEW "PublicTournamentRegistration" AS
 SELECT t.slug,t.name,t.overview,t."overviewEn",t."gameTitle",t."startsAt",t."registrationDeadline",
   COALESCE(
     (SELECT capacity FROM "Category" WHERE "tournamentId"=t.id AND kind='SOLO'),
     (SELECT capacity*4 FROM "Category" WHERE "tournamentId"=t.id AND kind='TEAM')
   ) AS capacity,t.configuration->>'format' AS format
 FROM "Tournament" t
 WHERE t."registrationEnabled" AND t.status<>'ARCHIVED'
   AND EXISTS(SELECT FROM "Category" WHERE "tournamentId"=t.id AND kind IN ('SOLO','TEAM'));

CREATE OR REPLACE FUNCTION app_participation_status(event_slug text) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT COALESCE((
   SELECT CASE WHEN app_participation_count(t.id)>=app_tournament_player_capacity(t.id) THEN 'FULL' ELSE 'OPEN' END
   FROM "Tournament" t
   WHERE t.slug=event_slug AND t."registrationEnabled" AND NOT t.published
     AND t.status IN ('DRAFT','REGISTRATION_OPEN')
     AND (t."registrationDeadline" IS NULL OR t."registrationDeadline">now())
     AND app_tournament_player_capacity(t.id) IS NOT NULL
 ), 'CLOSED')
$$;
REVOKE ALL ON FUNCTION app_participation_status(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_participation_status(text) TO pailangz_app;
CREATE OR REPLACE FUNCTION app_participation_status() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT app_participation_status('pailangz-solo-team')
$$;
CREATE OR REPLACE FUNCTION app_submit_participation(
  event_slug text, request_id text, member_id text, canonical_ign text, verified_record text, audit_id text
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
  -- Serialize submissions with staff roster changes in this tournament.
  SELECT t.id INTO event_id FROM "Tournament" t
    WHERE t.slug=event_slug AND t."registrationEnabled" AND NOT t.published AND t.status IN ('DRAFT','REGISTRATION_OPEN')
      AND (t."registrationDeadline" IS NULL OR t."registrationDeadline">now())
      AND app_tournament_player_capacity(t.id) IS NOT NULL
    FOR UPDATE OF t;
  IF event_id IS NULL THEN RETURN 'CLOSED'; END IF;
  -- Each event reserves its own entrants: SOLO players or TEAM roster players.
  capacity_limit := app_tournament_player_capacity(event_id);
  SELECT p.id INTO saved_id FROM "ParticipationRequest" p
    WHERE p."tournamentId"=event_id AND p."memberId"=member_id;
  SELECT p.id,p.code,p.eligible AND NOT p.provisional INTO slot_id,slot_code,approved
    FROM "Participant" p WHERE p."tournamentId"=event_id AND p."memberId"=member_id;
  IF EXISTS(SELECT FROM "Participant" p WHERE p.id=slot_id AND p.withdrawn) THEN RETURN 'WITHDRAWN'; END IF;
  IF saved_id IS NOT NULL AND approved THEN RETURN 'ACCEPTED'; END IF;
  IF saved_id IS NULL AND slot_id IS NULL AND app_participation_count(event_id)>=capacity_limit THEN RETURN 'FULL'; END IF;
  IF slot_id IS NULL AND (SELECT count(*) FROM "Participant" p WHERE p."tournamentId"=event_id AND NOT p.withdrawn)>=capacity_limit THEN RETURN 'FULL'; END IF;
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
      jsonb_build_object('categories',(SELECT jsonb_agg(c.kind ORDER BY c.kind) FROM "Category" c WHERE c."tournamentId"=event_id)),ARRAY[member_id]
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
      jsonb_build_object('categories',(SELECT jsonb_agg(c.kind ORDER BY c.kind) FROM "Category" c WHERE c."tournamentId"=event_id),'eligible',true,'code',slot_code),ARRAY[member_id,slot_id]
    );
  END IF;
  RETURN 'ACCEPTED';
END $$;
REVOKE ALL ON FUNCTION app_submit_participation(text,text,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_submit_participation(text,text,text,text,text,text) TO pailangz_app;


CREATE OR REPLACE FUNCTION category_capacity_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE config jsonb;
BEGIN
 SELECT configuration INTO config FROM "Tournament" WHERE id=NEW."tournamentId";
 IF config->>'format' IS NOT NULL AND NEW.kind<>config->>'format' THEN
   RAISE EXCEPTION 'Category must match the tournament format';
 END IF;
 IF NEW.capacity<>(config->>CASE WHEN NEW.kind='SOLO' THEN 'soloCapacity' ELSE 'teamCapacity' END)::integer THEN
   RAISE EXCEPTION 'Capacity must match recorded tournament configuration';
 END IF;
 IF (NEW.kind='SOLO' OR config->>'format'='TEAM') AND
   app_participation_count(NEW."tournamentId") > NEW.capacity * (CASE WHEN NEW.kind='TEAM' THEN 4 ELSE 1 END) THEN
   RAISE EXCEPTION 'Capacity cannot remove active entrants';
 END IF;
 IF NEW.kind='TEAM' AND NEW.capacity<(SELECT count(*) FROM "Team" WHERE "categoryId"=NEW.id AND NOT archived) THEN
   RAISE EXCEPTION 'Capacity cannot remove active teams';
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER configured_capacity ON "Category";
CREATE TRIGGER configured_capacity BEFORE INSERT OR UPDATE OF capacity,kind,"tournamentId" ON "Category"
 FOR EACH ROW EXECUTE FUNCTION category_capacity_guard();
