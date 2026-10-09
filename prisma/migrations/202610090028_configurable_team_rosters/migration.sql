-- Existing events retain player-managed rosters until staff select otherwise.
ALTER TABLE "Tournament" ADD COLUMN "teamRosterManagement" text NOT NULL DEFAULT 'PLAYER'
 CHECK ("teamRosterManagement" IN ('PLAYER','STAFF'));
CREATE OR REPLACE VIEW "PublicTeamEvent" AS
 SELECT t.slug,t.name,t.status,t."registrationDeadline",c.capacity,t.published,
   t.configuration->>'format' AS format,t."teamRosterManagement"
 FROM "Tournament" t JOIN "Category" c ON c."tournamentId"=t.id AND c.kind='TEAM'
 WHERE t.status<>'ARCHIVED' AND ((t.published AND t.status<>'DRAFT') OR t."registrationEnabled");

CREATE OR REPLACE VIEW "PublicTeamDirectory" AS
  SELECT e.slug AS "tournamentSlug",team.slug,team.name,team.code,
    t."teamRosterManagement"='PLAYER' AND EXISTS(SELECT FROM "Member" m JOIN "Participant" p ON p."memberId"=m.id AND p."tournamentId"=t.id AND p.eligible
      JOIN "TeamMembership" tm ON tm."memberId"=m.id AND tm."teamId"=team.id AND tm.active
      WHERE m.id=team."ownerId" AND m.verified AND NOT m.archived) AS "acceptsApplications",
    (SELECT m."displayIgn" FROM "Member" m WHERE m.id=team."ownerId" AND m.verified AND NOT m.archived) AS "ownerIgn",
    (SELECT count(*)::int FROM "TeamMembership" tm WHERE tm."teamId"=team.id AND tm.active) AS "playerCount",
    COALESCE((SELECT jsonb_agg(jsonb_build_object('ign',m."displayIgn",'owner',m.id=team."ownerId") ORDER BY (m.id=team."ownerId") DESC,m."displayIgn")
      FROM "TeamMembership" tm JOIN "Member" m ON m.id=tm."memberId"
      JOIN "Participant" p ON p."memberId"=m.id AND p."tournamentId"=t.id AND p.eligible
      WHERE tm."teamId"=team.id AND tm.active AND m.verified AND NOT m.archived),'[]'::jsonb) AS roster, team."avatarImage"
  FROM "PublicTeamEvent" e JOIN "Tournament" t ON t.slug=e.slug
  JOIN "Category" c ON c."tournamentId"=t.id AND c.kind='TEAM'
  JOIN "Team" team ON team."categoryId"=c.id AND NOT team.archived;

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

CREATE OR REPLACE VIEW "PublicTournamentRegistration" AS
 SELECT t.slug,t.name,t.overview,t."overviewEn",t."gameTitle",t."startsAt",t."registrationDeadline",
   COALESCE(
     (SELECT capacity FROM "Category" WHERE "tournamentId"=t.id AND kind='SOLO'),
     (SELECT capacity*4 FROM "Category" WHERE "tournamentId"=t.id AND kind='TEAM')
   ) AS capacity,t.configuration->>'format' AS format,t."teamRosterManagement"
 FROM "Tournament" t
 WHERE t."registrationEnabled" AND t.status<>'ARCHIVED'
   AND EXISTS(SELECT FROM "Category" WHERE "tournamentId"=t.id AND kind IN ('SOLO','TEAM'));

