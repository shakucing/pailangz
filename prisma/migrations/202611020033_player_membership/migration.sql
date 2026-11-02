-- Membership and tournament eligibility are independent. Preserve former
-- members as non-members; never discard their profiles or tournament history.
-- First update every database entry point and public view so membership no
-- longer gates approved players. Historical migrations remain unchanged.

-- Replaces validate_roster from 202610070002_security.
CREATE OR REPLACE FUNCTION validate_roster() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.active THEN
  IF NOT EXISTS(SELECT FROM "Team" WHERE id=NEW."teamId" AND "categoryId"=NEW."categoryId" AND NOT archived) THEN RAISE EXCEPTION 'Team category mismatch'; END IF;
  IF NOT EXISTS(SELECT FROM "Member" WHERE id=NEW."memberId" AND verified) THEN RAISE EXCEPTION 'Unapproved team member'; END IF;
  PERFORM 1 FROM "Team" WHERE id=NEW."teamId" FOR UPDATE;
  IF (SELECT count(*) FROM "TeamMembership" WHERE "teamId"=NEW."teamId" AND active AND id<>NEW.id)>=4 THEN RAISE EXCEPTION 'Team already has four players'; END IF;
 END IF;RETURN NEW;END $$;

-- Replaces app_participation_identity from 202610080013_tournament_participation.
CREATE OR REPLACE FUNCTION app_participation_identity(canonical_ign text)
RETURNS TABLE(member_id text, encrypted_record text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT m.id, p."registrationEncrypted"
  FROM "Member" m JOIN "MemberPrivate" p ON p."memberId"=m.id
  WHERE m."canonicalIgn"=canonical_ign AND m.verified
    AND length(canonical_ign) BETWEEN 1 AND 240
$$;

-- Replaces app_team_actor from 202610080016_team_access_without_phone.
CREATE OR REPLACE FUNCTION app_team_actor(token_hash text) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT s."memberId" FROM "MemberAccessSession" s
  JOIN "Member" m ON m.id=s."memberId" JOIN "MemberPrivate" p ON p."memberId"=m.id
  WHERE s."tokenHash"=token_hash AND s."expiresAt">now() AND m.verified
    AND s."verifiedRecord"=p."registrationEncrypted"
$$;

-- Replaces app_team_action from 202610090028_configurable_team_rosters.
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
  -- Recheck the saved roster policy under the tournament lock.
  IF event."teamRosterManagement"='STAFF' THEN RETURN jsonb_build_object('error','STAFF_MANAGED'); END IF;
  IF event.published OR event.status NOT IN ('DRAFT','REGISTRATION_OPEN') OR event."registrationDeadline"<=now() THEN RETURN jsonb_build_object('error','CLOSED'); END IF;
  -- Recheck identity and eligibility after acquiring the event lock, including
  -- approval revocations that occurred while the action was waiting.
  PERFORM m.id FROM "Member" m JOIN "MemberPrivate" mp ON mp."memberId"=m.id
    JOIN "Participant" p ON p."memberId"=m.id AND p."tournamentId"=event.id
    WHERE m.id=mid AND m.verified AND p.eligible FOR SHARE OF m,mp,p;
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
        WHERE m.id=selected_team."ownerId" AND m.verified) THEN RETURN jsonb_build_object('error','APPLICATIONS_CLOSED'); END IF;
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
          WHERE m.id=target_member AND m.verified AND p.eligible FOR SHARE OF m,p;
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

-- Replaces app_team_start_session from 202610080016_team_access_without_phone.
CREATE OR REPLACE FUNCTION app_team_start_session(member_id text, verified_record text, token_hash text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF token_hash IS NULL OR token_hash !~ '^[a-f0-9]{64}$' THEN RETURN false; END IF;
  PERFORM m.id FROM "Member" m JOIN "MemberPrivate" p ON p."memberId"=m.id
    WHERE m.id=member_id AND m.verified
      AND p."registrationEncrypted"=verified_record FOR SHARE OF m,p;
  IF NOT FOUND THEN RETURN false; END IF;
  DELETE FROM "MemberAccessSession" WHERE "memberId"=member_id AND "expiresAt"<=now();
  INSERT INTO "MemberAccessSession"("tokenHash","memberId","verifiedRecord","expiresAt")
    VALUES(token_hash,member_id,verified_record,now()+interval '8 hours');
  RETURN true;
END $$;

-- Replaces app_submit_participation from 202610090024_independent_tournament_formats.
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
    WHERE m.id=member_id AND m."canonicalIgn"=canonical_ign AND m.verified
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

-- Replaces app_lock_participation_identity from 202610130032_participation_profile.
CREATE OR REPLACE FUNCTION app_lock_participation_identity(member_id text, canonical_ign text, verified_record text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  PERFORM m.id FROM "Member" m JOIN "MemberPrivate" p ON p."memberId"=m.id
    WHERE m.id=member_id AND m."canonicalIgn"=canonical_ign AND m.verified
      AND p."registrationEncrypted"=verified_record FOR UPDATE OF m,p;
  RETURN FOUND;
END $$;

-- Replaces app_complete_participation_profile from 202610130032_participation_profile.
CREATE OR REPLACE FUNCTION app_complete_participation_profile(
  member_id text, verified_record text, completed_record text,
  phone_changed boolean, completed_phone text, phone_last_four text, phone_issue text,
  changed_fields text[], audit_id text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF completed_record IS NULL OR completed_record='' OR audit_id IS NULL
     OR changed_fields IS NULL OR cardinality(changed_fields)=0
     OR NOT changed_fields <@ ARRAY['gmcId','email','whatsapp','discordName','discordId']::text[]
     OR phone_changed IS DISTINCT FROM ('whatsapp'=ANY(changed_fields)) THEN
    RAISE EXCEPTION 'Invalid profile completion';
  END IF;
  PERFORM m.id FROM "Member" m JOIN "MemberPrivate" p ON p."memberId"=m.id
    WHERE m.id=member_id AND m.verified
      AND p."registrationEncrypted"=verified_record FOR UPDATE OF m,p;
  IF NOT FOUND THEN RAISE EXCEPTION 'Stale profile verification'; END IF;
  UPDATE "MemberPrivate" p SET
    "registrationEncrypted"=completed_record,
    "phoneEncrypted"=CASE WHEN phone_changed THEN completed_phone ELSE p."phoneEncrypted" END,
    "phoneLastFour"=CASE WHEN phone_changed THEN phone_last_four ELSE p."phoneLastFour" END,
    "phoneIssue"=CASE WHEN phone_changed THEN phone_issue ELSE p."phoneIssue" END
    WHERE p."memberId"=member_id;
  INSERT INTO "AuditEvent" (id,"actorRole",action,"entityType","entityId","correlationId",source,changes)
    VALUES(audit_id,'PUBLIC','PARTICIPATION_PROFILE_COMPLETE','MEMBER',member_id,audit_id,'PARTICIPATION_FORM',
      jsonb_build_object('fields',to_jsonb(changed_fields)));
END $$;

-- Replaces "PublicEventPlayerName" from 202610100029_published_solo_player_names.
CREATE OR REPLACE VIEW "PublicEventPlayerName" AS
SELECT t.slug, p.code, m."displayIgn" AS ign
FROM "Tournament" t
JOIN "Participant" p ON p."tournamentId" = t.id
JOIN "Member" m ON m.id = p."memberId"
WHERE NOT p.withdrawn AND t.status <> 'ARCHIVED'
  AND (
    t.id = (SELECT value #>> '{}' FROM "IntegrationSetting" WHERE key = 'officialSeedTournament')
    OR (
      t.published AND t.status <> 'DRAFT' AND p.eligible AND m.verified
      AND EXISTS (
        SELECT FROM "Category" c WHERE c."tournamentId" = t.id AND c.kind = 'SOLO'
      )
    )
  );

-- Replaces "PublicTeamDirectory" from 202610090028_configurable_team_rosters.
CREATE OR REPLACE VIEW "PublicTeamDirectory" AS
  SELECT e.slug AS "tournamentSlug",team.slug,team.name,team.code,
    t."teamRosterManagement"='PLAYER' AND EXISTS(SELECT FROM "Member" m JOIN "Participant" p ON p."memberId"=m.id AND p."tournamentId"=t.id AND p.eligible
      JOIN "TeamMembership" tm ON tm."memberId"=m.id AND tm."teamId"=team.id AND tm.active
      WHERE m.id=team."ownerId" AND m.verified) AS "acceptsApplications",
    (SELECT m."displayIgn" FROM "Member" m WHERE m.id=team."ownerId" AND m.verified) AS "ownerIgn",
    (SELECT count(*)::int FROM "TeamMembership" tm WHERE tm."teamId"=team.id AND tm.active) AS "playerCount",
    COALESCE((SELECT jsonb_agg(jsonb_build_object('ign',m."displayIgn",'owner',m.id=team."ownerId") ORDER BY (m.id=team."ownerId") DESC,m."displayIgn")
      FROM "TeamMembership" tm JOIN "Member" m ON m.id=tm."memberId"
      JOIN "Participant" p ON p."memberId"=m.id AND p."tournamentId"=t.id AND p.eligible
      WHERE tm."teamId"=team.id AND tm.active AND m.verified),'[]'::jsonb) AS roster, team."avatarImage"
  FROM "PublicTeamEvent" e JOIN "Tournament" t ON t.slug=e.slug
  JOIN "Category" c ON c."tournamentId"=t.id AND c.kind='TEAM'
  JOIN "Team" team ON team."categoryId"=c.id AND NOT team.archived;

-- Replaces "PublicEventTeamMember" from 202610090027_landing_highlights.
CREATE OR REPLACE VIEW "PublicEventTeamMember" AS
SELECT t.slug, team.code AS "teamCode", m."displayIgn" AS ign,
  COALESCE(m.id = team."ownerId", false) AS owner
FROM "Tournament" t
JOIN "Category" c ON c."tournamentId" = t.id AND c.kind = 'TEAM'
JOIN "Team" team ON team."categoryId" = c.id AND NOT team.archived
JOIN "TeamMembership" tm ON tm."teamId" = team.id AND tm.active
JOIN "Member" m ON m.id = tm."memberId" AND m.verified
JOIN "Participant" p ON p."tournamentId" = t.id AND p."memberId" = m.id
  AND p.eligible AND NOT p.withdrawn
WHERE t.status <> 'ARCHIVED' AND (
  (t.published AND t.status <> 'DRAFT') OR t.id IN (
    SELECT value #>> '{}' FROM "IntegrationSetting"
    WHERE key IN ('officialSeedTournament', 'officialTeamTournament')
  ) OR EXISTS (
    SELECT FROM "LandingHighlight" h WHERE h."tournamentId"=t.id
      AND h.format=t.configuration->>'format'
  )
);

DROP POLICY public_member ON "Member";
CREATE POLICY public_member ON "Member" FOR SELECT TO pailangz_app
USING (verified AND EXISTS(
  SELECT FROM "Participant" p JOIN "Tournament" t ON t.id=p."tournamentId"
  WHERE p."memberId"="Member".id AND p.eligible AND t.published
    AND t.status NOT IN ('DRAFT','ARCHIVED')
));

ALTER TABLE "Member" RENAME COLUMN archived TO "isMember";
UPDATE "Member" SET "isMember" = NOT "isMember";
ALTER TABLE "Member" ALTER COLUMN "isMember" SET DEFAULT true;
