ALTER TABLE "Team" ADD COLUMN slug text NOT NULL DEFAULT 'AUTO';
ALTER TABLE "Team" ADD COLUMN "ownerId" text REFERENCES "Member"(id) ON DELETE RESTRICT;
UPDATE "Team" SET slug=lower(code);
CREATE UNIQUE INDEX "Team_categoryId_slug_key" ON "Team"("categoryId",slug);
CREATE UNIQUE INDEX one_owned_team_per_category ON "Team"("categoryId","ownerId") WHERE NOT archived AND "ownerId" IS NOT NULL;
CREATE FUNCTION assign_team_slug() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='UPDATE' AND NEW.slug IS DISTINCT FROM OLD.slug THEN
    RAISE EXCEPTION 'Team slugs are permanent';
  ELSIF NEW.slug='AUTO' THEN NEW.slug:=lower(NEW.code);
  END IF;
  IF NEW.slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' OR length(NEW.slug)>120 THEN
    RAISE EXCEPTION 'Invalid team slug';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER z_team_slug BEFORE INSERT OR UPDATE ON "Team" FOR EACH ROW EXECUTE FUNCTION assign_team_slug();

CREATE TABLE "MemberAccessSession" (
  "tokenHash" text PRIMARY KEY,
  "memberId" text NOT NULL REFERENCES "Member"(id) ON DELETE RESTRICT,
  "verifiedRecord" text NOT NULL,
  "verifiedPhone" text NOT NULL,
  "expiresAt" timestamptz(3) NOT NULL
);
CREATE INDEX "MemberAccessSession_memberId_expiresAt_idx" ON "MemberAccessSession"("memberId","expiresAt");
ALTER TABLE "MemberAccessSession" ENABLE ROW LEVEL SECURITY;
-- Session capabilities and verification snapshots are never table-readable by runtime.
CREATE TABLE "TeamApplication" (
  id text PRIMARY KEY,
  "teamId" text NOT NULL REFERENCES "Team"(id) ON DELETE RESTRICT,
  "memberId" text NOT NULL REFERENCES "Member"(id) ON DELETE RESTRICT,
  status "ReviewStatus" NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','APPROVED','REJECTED')),
  "createdAt" timestamptz(3) NOT NULL DEFAULT now(),
  "decidedAt" timestamptz(3),
  CONSTRAINT "TeamApplication_teamId_memberId_key" UNIQUE("teamId","memberId")
);
CREATE INDEX "TeamApplication_teamId_status_createdAt_idx" ON "TeamApplication"("teamId",status,"createdAt");
ALTER TABLE "TeamApplication" ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON "TeamApplication" TO pailangz_app;
CREATE POLICY team_application_staff ON "TeamApplication" FOR SELECT TO pailangz_app USING((SELECT app_staff_allowed()));

CREATE FUNCTION app_team_identity(canonical_ign text)
RETURNS TABLE(member_id text, encrypted_record text, encrypted_phone text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT m.id,p."registrationEncrypted",p."phoneEncrypted" FROM "Member" m
  JOIN "MemberPrivate" p ON p."memberId"=m.id
  WHERE m."canonicalIgn"=canonical_ign AND m.verified AND NOT m.archived
    AND p."phoneEncrypted" IS NOT NULL AND p."phoneIssue" IS NULL
    AND length(canonical_ign) BETWEEN 1 AND 240
$$;
CREATE FUNCTION app_team_start_session(member_id text, verified_record text, verified_phone text, token_hash text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF token_hash IS NULL OR token_hash !~ '^[a-f0-9]{64}$' THEN RETURN false; END IF;
  PERFORM m.id FROM "Member" m JOIN "MemberPrivate" p ON p."memberId"=m.id
    WHERE m.id=member_id AND m.verified AND NOT m.archived AND p."phoneIssue" IS NULL
      AND p."registrationEncrypted"=verified_record AND p."phoneEncrypted"=verified_phone FOR SHARE OF m,p;
  IF NOT FOUND THEN RETURN false; END IF;
  DELETE FROM "MemberAccessSession" WHERE "memberId"=member_id AND "expiresAt"<=now();
  INSERT INTO "MemberAccessSession" VALUES(token_hash,member_id,verified_record,verified_phone,now()+interval '8 hours');
  RETURN true;
END $$;
CREATE FUNCTION app_team_actor(token_hash text) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT s."memberId" FROM "MemberAccessSession" s
  JOIN "Member" m ON m.id=s."memberId" JOIN "MemberPrivate" p ON p."memberId"=m.id
  WHERE s."tokenHash"=token_hash AND s."expiresAt">now() AND m.verified AND NOT m.archived
    AND s."verifiedRecord"=p."registrationEncrypted" AND s."verifiedPhone"=p."phoneEncrypted" AND p."phoneIssue" IS NULL
$$;
CREATE FUNCTION app_team_end_session(token_hash text) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$
  DELETE FROM "MemberAccessSession" WHERE "tokenHash"=token_hash
$$;

-- The official event already has a public landing preview while it is a draft.
-- Expose only tournament/team names and approved roster names, never private contacts or requests.
CREATE VIEW "PublicTeamEvent" AS
  SELECT t.slug,t.name,t.status,t."registrationDeadline",c.capacity
  FROM "Tournament" t JOIN "Category" c ON c."tournamentId"=t.id AND c.kind='TEAM'
  WHERE t.status<>'ARCHIVED' AND (
    (t.published AND t.status<>'DRAFT') OR EXISTS(SELECT FROM "IntegrationSetting" s
      WHERE s.key='officialSeedTournament' AND s.value #>> '{}' = t.id)
  );
CREATE VIEW "PublicTeamDirectory" AS
  SELECT e.slug AS "tournamentSlug",team.slug,team.name,team.code,
    EXISTS(SELECT FROM "Member" m JOIN "Participant" p ON p."memberId"=m.id AND p."tournamentId"=t.id AND p.eligible
      JOIN "TeamMembership" tm ON tm."memberId"=m.id AND tm."teamId"=team.id AND tm.active
      WHERE m.id=team."ownerId" AND m.verified AND NOT m.archived) AS "acceptsApplications",
    (SELECT m."displayIgn" FROM "Member" m WHERE m.id=team."ownerId" AND m.verified AND NOT m.archived) AS "ownerIgn",
    (SELECT count(*)::int FROM "TeamMembership" tm WHERE tm."teamId"=team.id AND tm.active) AS "playerCount",
    COALESCE((SELECT jsonb_agg(jsonb_build_object('ign',m."displayIgn",'owner',m.id=team."ownerId") ORDER BY (m.id=team."ownerId") DESC,m."displayIgn")
      FROM "TeamMembership" tm JOIN "Member" m ON m.id=tm."memberId"
      JOIN "Participant" p ON p."memberId"=m.id AND p."tournamentId"=t.id AND p.eligible
      WHERE tm."teamId"=team.id AND tm.active AND m.verified AND NOT m.archived),'[]'::jsonb) AS roster
  FROM "PublicTeamEvent" e JOIN "Tournament" t ON t.slug=e.slug
  JOIN "Category" c ON c."tournamentId"=t.id AND c.kind='TEAM'
  JOIN "Team" team ON team."categoryId"=c.id AND NOT team.archived;
GRANT SELECT ON "PublicTeamEvent","PublicTeamDirectory" TO pailangz_app;

CREATE FUNCTION app_team_state(token_hash text,event_slug text,team_slug text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE mid text; tid text; cid text; selected_team "Team"; approved boolean;
BEGIN
  mid:=app_team_actor(token_hash);
  IF mid IS NULL THEN RETURN NULL; END IF;
  SELECT t.id,c.id INTO tid,cid FROM "Tournament" t JOIN "Category" c ON c."tournamentId"=t.id AND c.kind='TEAM'
    JOIN "PublicTeamEvent" e ON e.slug=t.slug WHERE t.slug=event_slug;
  IF tid IS NULL THEN RETURN NULL; END IF;
  SELECT EXISTS(SELECT FROM "Participant" p WHERE p."tournamentId"=tid AND p."memberId"=mid AND p.eligible) INTO approved;
  SELECT * INTO selected_team FROM "Team" WHERE "categoryId"=cid AND slug=team_slug AND NOT archived;
  RETURN jsonb_build_object(
    'ign',(SELECT "displayIgn" FROM "Member" WHERE id=mid),'approved',approved,
    'teamSlug',(SELECT team.slug FROM "TeamMembership" tm JOIN "Team" team ON team.id=tm."teamId" WHERE tm."memberId"=mid AND tm."categoryId"=cid AND tm.active AND NOT team.archived),
    'isOwner',COALESCE(selected_team."ownerId"=mid AND EXISTS(SELECT FROM "TeamMembership" WHERE "teamId"=selected_team.id AND "memberId"=mid AND active),false),
    'application',(SELECT status FROM "TeamApplication" WHERE "teamId"=selected_team.id AND "memberId"=mid),
    'requests',CASE WHEN approved AND selected_team."ownerId"=mid AND EXISTS(SELECT FROM "TeamMembership" WHERE "teamId"=selected_team.id AND "memberId"=mid AND active)
      THEN COALESCE((SELECT jsonb_agg(jsonb_build_object('id',a.id,'ign',m."displayIgn",'status',a.status,'createdAt',a."createdAt") ORDER BY a."createdAt",a.id)
        FROM "TeamApplication" a JOIN "Member" m ON m.id=a."memberId" WHERE a."teamId"=selected_team.id AND a.status='PENDING'),'[]'::jsonb)
      ELSE '[]'::jsonb END
  );
END $$;

CREATE FUNCTION app_team_action(token_hash text,event_slug text,operation text,team_slug text,team_name text,application_id text,entity_id text,audit_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE mid text; event "Tournament"; category "Category"; selected_team "Team"; application "TeamApplication"; result_id text; target_member text;
BEGIN
  mid:=app_team_actor(token_hash);
  IF mid IS NULL THEN RETURN jsonb_build_object('error','SIGN_IN'); END IF;
  -- All public roster changes in this tournament share this lock. Staff uses
  -- serializable transactions; roster constraints additionally enforce capacity.
  SELECT t.* INTO event FROM "Tournament" t JOIN "PublicTeamEvent" e ON e.slug=t.slug WHERE t.slug=event_slug FOR UPDATE OF t;
  IF event.id IS NULL THEN RETURN jsonb_build_object('error','NOT_FOUND'); END IF;
  IF event.status NOT IN ('DRAFT','REGISTRATION_OPEN') OR event."registrationDeadline"<=now() THEN RETURN jsonb_build_object('error','CLOSED'); END IF;
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

REVOKE ALL ON FUNCTION app_team_identity(text),app_team_start_session(text,text,text,text),app_team_actor(text),app_team_end_session(text),app_team_state(text,text,text),app_team_action(text,text,text,text,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_team_identity(text),app_team_start_session(text,text,text,text),app_team_end_session(text),app_team_state(text,text,text),app_team_action(text,text,text,text,text,text,text,text) TO pailangz_app;
