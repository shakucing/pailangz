-- Routine competition operations are available to authenticated staff.
-- Staff accounts, secrets, private exports and controlled restarts retain their guards.
ALTER TABLE "Tournament" ADD COLUMN "registrationEnabled" boolean NOT NULL DEFAULT false;
UPDATE "Tournament" SET "registrationEnabled"=true
 WHERE slug='pailangz-solo-team' AND id=(SELECT value #>> '{}' FROM "IntegrationSetting" WHERE key='officialSeedTournament');
ALTER TABLE "Participant" ADD COLUMN withdrawn boolean NOT NULL DEFAULT false;
ALTER TABLE "Participant" ADD CONSTRAINT withdrawn_not_eligible CHECK (NOT withdrawn OR NOT eligible);

CREATE OR REPLACE FUNCTION admin_rule_changes() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF current_user='pailangz_app' AND NOT app_staff_allowed() THEN RAISE EXCEPTION 'Staff permission required'; END IF;
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION admin_publication() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF current_user='pailangz_app' AND NEW.published IS DISTINCT FROM OLD.published AND NOT app_staff_allowed() THEN RAISE EXCEPTION 'Staff permission required'; END IF;
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION admin_initial_publication() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF current_user='pailangz_app' AND NEW.published AND NOT app_staff_allowed() THEN RAISE EXCEPTION 'Staff permission required'; END IF;
 RETURN NEW;
END $$;

-- Registration exposes only the information required by an individually shared link.
-- It never exposes private drafts' fixtures, results, registration answers or contacts.
CREATE VIEW "PublicTournamentRegistration" AS
 SELECT t.slug,t.name,t.overview,t."overviewEn",t."gameTitle",t."startsAt",t."registrationDeadline",c.capacity
 FROM "Tournament" t JOIN "Category" c ON c."tournamentId"=t.id AND c.kind='SOLO'
 WHERE t."registrationEnabled" AND t.status<>'ARCHIVED';
GRANT SELECT ON "PublicTournamentRegistration" TO pailangz_app;
CREATE OR REPLACE VIEW "PublicTeamEvent" AS
 SELECT t.slug,t.name,t.status,t."registrationDeadline",c.capacity,t.published
 FROM "Tournament" t JOIN "Category" c ON c."tournamentId"=t.id AND c.kind='TEAM'
 WHERE t.status<>'ARCHIVED' AND ((t.published AND t.status<>'DRAFT') OR t."registrationEnabled");

-- Historical applications for withdrawn players no longer consume a place.
CREATE FUNCTION app_participation_count(event_id text) RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT count(*) FROM (
   SELECT p."memberId" FROM "Participant" p WHERE p."tournamentId"=event_id AND NOT p.withdrawn
   UNION
   SELECT a."memberId" FROM "ParticipationRequest" a WHERE a."tournamentId"=event_id
     AND NOT EXISTS(SELECT FROM "Participant" p WHERE p."tournamentId"=event_id AND p."memberId"=a."memberId" AND p.withdrawn)
 ) players
$$;
REVOKE ALL ON FUNCTION app_participation_count(text) FROM PUBLIC;

CREATE FUNCTION app_participation_status(event_slug text) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT COALESCE((
   SELECT CASE WHEN app_participation_count(t.id)>=c.capacity THEN 'FULL' ELSE 'OPEN' END
   FROM "Tournament" t JOIN "Category" c ON c."tournamentId"=t.id AND c.kind='SOLO'
   WHERE t.slug=event_slug AND t."registrationEnabled" AND NOT t.published
     AND t.status IN ('DRAFT','REGISTRATION_OPEN')
     AND (t."registrationDeadline" IS NULL OR t."registrationDeadline">now())
     AND EXISTS(SELECT FROM "Category" team WHERE team."tournamentId"=t.id AND team.kind='TEAM')
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
      AND EXISTS(SELECT FROM "Category" c WHERE c."tournamentId"=t.id AND c.kind='SOLO')
      AND EXISTS(SELECT FROM "Category" c WHERE c."tournamentId"=t.id AND c.kind='TEAM')
    FOR UPDATE OF t;
  IF event_id IS NULL THEN RETURN 'CLOSED'; END IF;
  -- Count one shared player pool, including any staff-assigned entrants.
  SELECT c.capacity INTO capacity_limit FROM "Category" c
    WHERE c."tournamentId"=event_id AND c.kind='SOLO';
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
REVOKE ALL ON FUNCTION app_submit_participation(text,text,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_submit_participation(text,text,text,text,text,text) TO pailangz_app;

-- Keep the original individually shared link and older callers working.
CREATE OR REPLACE FUNCTION app_submit_participation(request_id text, member_id text, canonical_ign text, verified_record text, audit_id text)
RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT app_submit_participation('pailangz-solo-team',request_id,member_id,canonical_ign,verified_record,audit_id)
$$;

CREATE OR REPLACE FUNCTION category_capacity_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ BEGIN
 IF NEW.capacity<>(SELECT (t.configuration->>CASE WHEN NEW.kind='SOLO' THEN 'soloCapacity' ELSE 'teamCapacity' END)::integer FROM "Tournament" t WHERE t.id=NEW."tournamentId") THEN RAISE EXCEPTION 'Capacity must match recorded tournament configuration'; END IF;
 IF NEW.kind='SOLO' AND NEW.capacity<app_participation_count(NEW."tournamentId") THEN RAISE EXCEPTION 'Capacity cannot remove active entrants'; END IF;
 IF NEW.kind='TEAM' AND NEW.capacity<(SELECT count(*) FROM "Team" WHERE "categoryId"=NEW.id AND NOT archived) THEN RAISE EXCEPTION 'Capacity cannot remove active teams'; END IF;
 RETURN NEW;
END $$;
-- Only registration functions and the capacity trigger call the private count helper.

CREATE OR REPLACE VIEW "PublicEventPreview" AS
SELECT jsonb_build_object(
  'name', t.name, 'slug', t.slug, 'status', t.status, 'configuration', t.configuration,
  'participants', coalesce((
    SELECT jsonb_agg(jsonb_build_object('code', p.code) ORDER BY p.code)
    FROM "Participant" p WHERE p."tournamentId" = t.id AND NOT p.withdrawn
  ), '[]'::jsonb),
  'categories', coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'kind', c.kind,
      'teams', coalesce((
        SELECT jsonb_agg(jsonb_build_object(
          'code', tm.code,
          'name', tm.name,
          'playerCount', (SELECT count(*) FROM "TeamMembership" ms WHERE ms."teamId" = tm.id AND ms.active)
        ) ORDER BY tm.code) FROM "Team" tm WHERE tm."categoryId" = c.id AND NOT tm.archived
      ), '[]'::jsonb),
      'stages', coalesce((
        SELECT jsonb_agg(jsonb_build_object(
          'key', s.key, 'name', s.name, 'format', s.format,
          'qualificationBestOf', CASE WHEN s.key = 'qualification' AND 'qualificationBestOf' = ANY(s."confirmedRules")
            THEN s.rules->'qualificationBestOf' ELSE NULL END,
          'standings', '[]'::jsonb,
          'rounds', coalesce((
            SELECT jsonb_agg(jsonb_build_object(
              'number', r.number, 'name', r.name,
              'matches', coalesce((
                SELECT jsonb_agg(jsonb_build_object(
                  'id', m.id, 'order', m."order", 'bestOf', m."bestOf",
                  'a', CASE WHEN m."sideKind" = 'TEAM' THEN ta.code || ' · ' || ta.name ELSE pa.code END,
                  'b', CASE WHEN m.status = 'BYE' THEN 'BYE' WHEN m."sideKind" = 'TEAM' THEN tb.code || ' · ' || tb.name ELSE pb.code END,
                  'status', CASE WHEN m.status = 'BYE' THEN 'BYE' ELSE 'SCHEDULED' END,
                  'scheduledAt', NULL, 'result', NULL
                ) ORDER BY m."order") FROM "Match" m
                LEFT JOIN "Participant" pa ON pa.id = m."sideAId" AND pa."tournamentId" = t.id
                LEFT JOIN "Participant" pb ON pb.id = m."sideBId" AND pb."tournamentId" = t.id
                LEFT JOIN "Team" ta ON ta.id = m."sideAId" AND ta."categoryId" = c.id
                LEFT JOIN "Team" tb ON tb.id = m."sideBId" AND tb."categoryId" = c.id
                WHERE m."roundId" = r.id
              ), '[]'::jsonb)
            ) ORDER BY r.number) FROM "Round" r WHERE r."stageId" = s.id
          ), '[]'::jsonb)
        ) ORDER BY s.key) FROM "Stage" s WHERE s."categoryId" = c.id AND NOT s.archived
      ), '[]'::jsonb)
    ) ORDER BY c.kind) FROM "Category" c WHERE c."tournamentId" = t.id
  ), '[]'::jsonb)
) AS data
FROM "Tournament" t
WHERE t.status <> 'ARCHIVED'
  AND t.id = (SELECT value #>> '{}' FROM "IntegrationSetting" WHERE key = 'officialSeedTournament');

CREATE OR REPLACE VIEW "PublicEventPlayerName" AS
SELECT t.slug, p.code, m."displayIgn" AS ign
FROM "Tournament" t
JOIN "Participant" p ON p."tournamentId" = t.id
JOIN "Member" m ON m.id = p."memberId"
WHERE NOT p.withdrawn AND t.status <> 'ARCHIVED' AND NOT m.archived
  AND t.id = (SELECT value #>> '{}' FROM "IntegrationSetting" WHERE key = 'officialSeedTournament');

-- Withdrawing an entrant closes their pending join requests in the same audited transaction.
GRANT UPDATE (status,"decidedAt") ON "TeamApplication" TO pailangz_app;
CREATE POLICY staff_reject_withdrawn_application ON "TeamApplication" FOR UPDATE TO pailangz_app
 USING((SELECT app_staff_allowed()) AND status='PENDING') WITH CHECK((SELECT app_staff_allowed()) AND status='REJECTED');

-- Published rosters stay locked for public team owners as well as staff.
CREATE OR REPLACE FUNCTION app_team_action(token_hash text,event_slug text,operation text,team_slug text,team_name text,application_id text,entity_id text,audit_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE mid text; event "Tournament"; category "Category"; selected_team "Team"; application "TeamApplication"; result_id text; target_member text;
BEGIN
  mid:=app_team_actor(token_hash);
  IF mid IS NULL THEN RETURN jsonb_build_object('error','SIGN_IN'); END IF;
  -- All public roster changes in this tournament share this lock. Staff uses
  -- serializable transactions; roster constraints additionally enforce capacity.
  SELECT t.* INTO event FROM "Tournament" t JOIN "PublicTeamEvent" e ON e.slug=t.slug WHERE t.slug=event_slug FOR UPDATE OF t;
  IF event.id IS NULL THEN RETURN jsonb_build_object('error','NOT_FOUND'); END IF;
  IF event.published OR event.status NOT IN ('DRAFT','REGISTRATION_OPEN') OR event."registrationDeadline"<=now() THEN RETURN jsonb_build_object('error','CLOSED'); END IF;
  -- Recheck identity and eligibility after acquiring the event lock, including
  -- approval revocations that occurred while the action was waiting.
  PERFORM m.id FROM "Member" m JOIN "MemberPrivate" mp ON mp."memberId"=m.id
    JOIN "Participant" p ON p."memberId"=m.id AND p."tournamentId"=event.id
    WHERE m.id=mid AND m.verified AND NOT m.archived AND p.eligible FOR SHARE OF m,mp,p;
  IF NOT FOUND OR app_team_actor(token_hash) IS DISTINCT FROM mid THEN RETURN jsonb_build_object('error','NOT_APPROVED'); END IF;
  SELECT * INTO category FROM "Category" WHERE "tournamentId"=event.id AND kind='TEAM' FOR UPDATE;
  IF operation='CREATE' THEN
    IF team_name IS NULL OR length(btrim(team_name)) NOT BETWEEN 2 AND 80 OR team_slug IS NULL OR team_slug IN ('new') THEN RETURN jsonb_build_object('error','VALIDATION'); END IF;
    IF EXISTS(SELECT FROM "TeamMembership" WHERE "categoryId"=category.id AND "memberId"=mid AND active)
      OR EXISTS(SELECT FROM "Team" WHERE "categoryId"=category.id AND "ownerId"=mid AND NOT archived)
      THEN RETURN jsonb_build_object('error','ALREADY_IN_TEAM'); END IF;
    IF (SELECT count(*) FROM "Team" WHERE "categoryId"=category.id AND NOT archived)>=category.capacity THEN RETURN jsonb_build_object('error','TOURNAMENT_FULL'); END IF;
    INSERT INTO "Team" (id,"categoryId",name,slug,"ownerId") VALUES(entity_id,category.id,btrim(team_name),team_slug,mid) RETURNING * INTO selected_team;
    INSERT INTO "TeamMembership"(id,"teamId","categoryId","memberId") VALUES(entity_id||'-owner',selected_team.id,category.id,mid);
    UPDATE "TeamApplication" a SET status='REJECTED',"decidedAt"=now() FROM "Team" team
      WHERE a."teamId"=team.id AND team."categoryId"=category.id AND a."memberId"=mid AND a.status='PENDING';
    result_id:=selected_team.id;
  ELSE
    SELECT * INTO selected_team FROM "Team" WHERE "categoryId"=category.id AND slug=team_slug AND NOT archived FOR UPDATE;
    IF selected_team.id IS NULL THEN RETURN jsonb_build_object('error','NOT_FOUND'); END IF;
    IF operation='APPLY' THEN
      IF NOT EXISTS(SELECT FROM "Member" m JOIN "Participant" p ON p."memberId"=m.id AND p."tournamentId"=event.id AND p.eligible
        JOIN "TeamMembership" tm ON tm."memberId"=m.id AND tm."teamId"=selected_team.id AND tm.active
        WHERE m.id=selected_team."ownerId" AND m.verified AND NOT m.archived) THEN RETURN jsonb_build_object('error','APPLICATIONS_CLOSED'); END IF;
      IF EXISTS(SELECT FROM "TeamMembership" WHERE "categoryId"=category.id AND "memberId"=mid AND active) THEN RETURN jsonb_build_object('error','ALREADY_IN_TEAM'); END IF;
      SELECT * INTO application FROM "TeamApplication" WHERE "teamId"=selected_team.id AND "memberId"=mid;
      IF FOUND THEN RETURN jsonb_build_object('slug',selected_team.slug,'status',application.status); END IF;
      IF (SELECT count(*) FROM "TeamMembership" WHERE "teamId"=selected_team.id AND active)>=4 THEN RETURN jsonb_build_object('error','TEAM_FULL'); END IF;
      INSERT INTO "TeamApplication"(id,"teamId","memberId") VALUES(entity_id,selected_team.id,mid);
      result_id:=entity_id;
    ELSIF operation IN ('APPROVE','REJECT') THEN
      IF selected_team."ownerId" IS DISTINCT FROM mid OR NOT EXISTS(SELECT FROM "TeamMembership" WHERE "teamId"=selected_team.id AND "memberId"=mid AND active) THEN RETURN jsonb_build_object('error','OWNER_ONLY'); END IF;
      SELECT * INTO application FROM "TeamApplication" WHERE id=application_id AND "teamId"=selected_team.id FOR UPDATE;
      IF application.id IS NULL THEN RETURN jsonb_build_object('error','NOT_FOUND'); END IF;
      IF application.status<>'PENDING' THEN RETURN jsonb_build_object('error','ALREADY_REVIEWED'); END IF;
      target_member:=application."memberId";
      IF operation='APPROVE' THEN
        PERFORM m.id FROM "Member" m JOIN "Participant" p ON p."memberId"=m.id AND p."tournamentId"=event.id
          WHERE m.id=target_member AND m.verified AND NOT m.archived AND p.eligible FOR SHARE OF m,p;
        IF NOT FOUND THEN RETURN jsonb_build_object('error','APPLICANT_NOT_APPROVED'); END IF;
        IF EXISTS(SELECT FROM "TeamMembership" WHERE "categoryId"=category.id AND "memberId"=target_member AND active) THEN RETURN jsonb_build_object('error','APPLICANT_IN_TEAM'); END IF;
        IF (SELECT count(*) FROM "TeamMembership" WHERE "teamId"=selected_team.id AND active)>=4 THEN RETURN jsonb_build_object('error','TEAM_FULL'); END IF;
        INSERT INTO "TeamMembership"(id,"teamId","categoryId","memberId") VALUES(entity_id,selected_team.id,category.id,target_member);
        UPDATE "TeamApplication" a SET status='REJECTED',"decidedAt"=now() FROM "Team" team
          WHERE a."teamId"=team.id AND team."categoryId"=category.id AND a."memberId"=target_member AND a.status='PENDING' AND a.id<>application.id;
      END IF;
      UPDATE "TeamApplication" SET status=CASE WHEN operation='APPROVE' THEN 'APPROVED'::"ReviewStatus" ELSE 'REJECTED'::"ReviewStatus" END,"decidedAt"=now() WHERE id=application.id;
      result_id:=application.id;
    ELSE RETURN jsonb_build_object('error','VALIDATION');
    END IF;
  END IF;
  INSERT INTO "AuditEvent"(id,"actorId","actorRole",action,"entityType","entityId","tournamentId","correlationId",source,changes,"relatedIds")
    VALUES(audit_id,mid,'MEMBER','TEAM_'||operation,'TEAM',result_id,event.id,audit_id,'TEAM_PORTAL',jsonb_build_object('teamId',selected_team.id),ARRAY[mid,COALESCE(target_member,mid)]);
  RETURN jsonb_build_object('slug',selected_team.slug,'status',CASE WHEN operation='APPLY' THEN 'PENDING' WHEN operation='REJECT' THEN 'REJECTED' ELSE 'APPROVED' END);
END $$;
