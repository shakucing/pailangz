-- PAILANGZ Neon upgrade through migration 020, generated 8 October 2026.
-- Source: commit 76a649d. Run this entire file in the existing production
-- database's Neon SQL Editor using the role that owns the application tables.
-- Requires migrations 001-009 already applied and recorded by Prisma.
-- Applies only pending migrations 010-020 and records their ORIGINAL SHA-256
-- checksums in _prisma_migrations. Completed migrations are skipped on rerun.
-- All changes and migration records occur in one atomic DO statement.
-- Any error rolls back this upgrade; do not manually mark a failed run applied.
-- Migration 011's BEGIN/COMMIT are omitted inside the enclosing atomic block.
-- No import, seed, tournament reset, password change or key rotation is run.
-- Included data changes: team slugs are backfilled; migration 017 approves
-- eligible existing participation requests up to capacity; migration 020
-- enables registration for the configured original event. Existing event
-- sizes, fixtures and results are not reset to the new local seed defaults.
-- Only schema/publication/access changes already present in the migrations
-- are applied. This script has not been executed against your Neon database.

DO $pailangz_upgrade$
DECLARE
  expected jsonb := $manifest$
[
  {
    "ordinal": 1,
    "name": "202610070001_initial",
    "checksum": "9e0a2ee1306b86c5c577de41521dbce6cd6585908cd2543dc7512a9a43d92026"
  },
  {
    "ordinal": 2,
    "name": "202610070002_security",
    "checksum": "b46b874ce70bff8d209f592b6793e249289c485f5007feb219fdf710c3ec2d37"
  },
  {
    "ordinal": 3,
    "name": "202610070003_admin_rules",
    "checksum": "ccf2706839d5a0ab17a9239f25d47c4f080ae3bab0b36274e892530b61311a38"
  },
  {
    "ordinal": 4,
    "name": "202610070004_public_rankings",
    "checksum": "a4097b52afbcce70ed8d64dcc6036910de633742a559b18eb5feaddc21b39528"
  },
  {
    "ordinal": 5,
    "name": "202610070005_bilingual_content",
    "checksum": "c77d184613193db4e194dc3fed3535a0665490be49f2ec96eb5fcc7b3149f58c"
  },
  {
    "ordinal": 6,
    "name": "202610070006_utc_timestamps",
    "checksum": "74aa4d0a0e6021c02d8af270184988a2126f54e486fd0e69e0233fd18fcf396b"
  },
  {
    "ordinal": 7,
    "name": "202610070007_configurable_competitions",
    "checksum": "5626bda60107e776e0d979eddd5c70fab3ef25338418fc9fa3ff2e5fd3145b6e"
  },
  {
    "ordinal": 8,
    "name": "202610070008_password_only_staff",
    "checksum": "456126be401506aa6e9dc8733539280e0565c440bd43589197357e8ad5769f81"
  },
  {
    "ordinal": 9,
    "name": "202610070009_anonymous_event_presentation",
    "checksum": "d98d57063ce3a42750a2d539e292ac22944e3ee94397d583b4dd8b319bd9911a"
  },
  {
    "ordinal": 10,
    "name": "202610070010_staff_management_performance",
    "checksum": "3de2c8a752d653c36560e6c1cf1fdb84ed65c929c230115c64be044e8545f0a3"
  },
  {
    "ordinal": 11,
    "name": "202610080011_landing_solo_names",
    "checksum": "909e39b59e34ef42d6c6c10b1fc32b9e91f4abf56de26a69c69c01fa62368c2d"
  },
  {
    "ordinal": 12,
    "name": "202610080012_web_registration",
    "checksum": "5c2d7740c9089d9fac067668b4187b96ba5aff9084451ab0971daa4d52c7f54b"
  },
  {
    "ordinal": 13,
    "name": "202610080013_tournament_participation",
    "checksum": "0cf899ac9e2b8d7ccc9a8595d85521b525b9efad9ddecffe67a629697648117c"
  },
  {
    "ordinal": 14,
    "name": "202610080014_participation_capacity",
    "checksum": "b1471ca62b3567c20e748ed57b91aeda8845a62a91949aebc14ad518df9c9133"
  },
  {
    "ordinal": 15,
    "name": "202610080015_team_applications",
    "checksum": "b6225bd628de736b05c2a1f23437662c98952f912ec2fda7851aa523eb17aabc"
  },
  {
    "ordinal": 16,
    "name": "202610080016_team_access_without_phone",
    "checksum": "3307c2dc957d98fd46e7fd7b3a1b14716c575fb2ee031b4e7ded97841e907a8a"
  },
  {
    "ordinal": 17,
    "name": "202610080017_automatic_participation_approval",
    "checksum": "40a111d6686720677322495145799d93d396a74567034ff43c113604bad671b4"
  },
  {
    "ordinal": 18,
    "name": "202610080018_team_avatars",
    "checksum": "b7b0926eeb35e85b98cbb40e5c7762a50be13ec91ecb1aa3ea093b1c7d172e91"
  },
  {
    "ordinal": 19,
    "name": "202610080019_participation_registration_status",
    "checksum": "75972ea302c4a8b7ce725e742f3331e18a87319993092b3525032d59d8a06c00"
  },
  {
    "ordinal": 20,
    "name": "202610080020_moderator_tournament_setup",
    "checksum": "020603ff43c20ea4c22035c06f58fef8fa0659be575128ff27843823942b6610"
  }
]
$manifest$::jsonb;
  item jsonb;
  migration record;
  completed_count integer;
  applied_count integer := 0;
  migration_started_at timestamptz;
  gap_seen boolean := false;
BEGIN
  PERFORM set_config('search_path', 'public,pg_catalog,pg_temp', true);
  PERFORM set_config('lock_timeout', '10s', true);

  IF to_regclass('public."DeploymentEnvironment"') IS NULL
     OR to_regclass('public."_prisma_migrations"') IS NULL THEN
    RAISE EXCEPTION 'Expected an existing PAILANGZ database with Prisma migration history; this is not a fresh-database setup script.';
  END IF;
  IF current_user = 'pailangz_app' OR current_user <> (
    SELECT pg_get_userbyid(relowner) FROM pg_class
    WHERE oid = 'public."Tournament"'::regclass
  ) THEN
    RAISE EXCEPTION 'Select the role that owns the PAILANGZ application tables, not pailangz_app.';
  END IF;
  IF (SELECT count(*) FROM public."DeploymentEnvironment") <> 1
     OR NOT EXISTS (SELECT FROM public."DeploymentEnvironment" WHERE tier='production') THEN
    RAISE EXCEPTION 'The selected database is not labelled production.';
  END IF;

  -- Match Prisma Migrate's PostgreSQL advisory lock to exclude another deploy.
  IF NOT pg_try_advisory_xact_lock(72707369::bigint) THEN
    RAISE EXCEPTION 'Another migration is running. Retry after it completes.';
  END IF;
  LOCK TABLE public."_prisma_migrations" IN EXCLUSIVE MODE;

  IF EXISTS (SELECT FROM public."_prisma_migrations"
             WHERE rolled_back_at IS NULL AND finished_at IS NULL) THEN
    RAISE EXCEPTION 'An unfinished Prisma migration requires recovery before this upgrade.';
  END IF;
  IF EXISTS (
    SELECT FROM public."_prisma_migrations" h
    WHERE h.rolled_back_at IS NULL AND NOT EXISTS (
      SELECT FROM jsonb_array_elements(expected) e
      WHERE e->>'name'=h.migration_name AND e->>'checksum'=h.checksum
    )
  ) THEN
    RAISE EXCEPTION 'Migration names or checksums differ from commit 76a649d. Resolve the history mismatch first.';
  END IF;
  IF EXISTS (SELECT FROM public."_prisma_migrations" WHERE rolled_back_at IS NULL
             GROUP BY migration_name HAVING count(*)>1) THEN
    RAISE EXCEPTION 'Duplicate active migration records require recovery before this upgrade.';
  END IF;

  FOR item IN SELECT value FROM jsonb_array_elements(expected) LOOP
    SELECT count(*) INTO completed_count FROM public."_prisma_migrations"
    WHERE migration_name=item->>'name' AND rolled_back_at IS NULL AND finished_at IS NOT NULL;
    IF (item->>'ordinal')::integer <= 9 AND completed_count <> 1 THEN
      RAISE EXCEPTION 'Required baseline migration % is missing. Apply the baseline before running this file.', item->>'name';
    END IF;
    IF completed_count=0 THEN
      gap_seen := true;
    ELSIF gap_seen THEN
      RAISE EXCEPTION 'Migration history has a gap before %. Resolve it first.', item->>'name';
    END IF;
  END LOOP;

  FOR migration IN
    SELECT * FROM (VALUES
    (10, '202610070010_staff_management_performance', '3de2c8a752d653c36560e6c1cf1fdb84ed65c929c230115c64be044e8545f0a3', $migration_010$
-- Account administration stays behind the current database-verified admin session.
-- Do not grant the application direct writes to staff identities or password hashes.
CREATE FUNCTION app_create_staff(target_id text, new_email text, new_name text, password_hash text, new_role "StaffRole") RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF NOT app_staff_allowed('ADMIN') THEN RAISE EXCEPTION 'Staff administration denied'; END IF;
  IF length(new_name) NOT BETWEEN 1 AND 100 OR length(new_email)>254 OR new_email<>lower(btrim(new_email)) OR password_hash !~ '^\$2[aby]\$12\$' THEN
    RAISE EXCEPTION 'Invalid staff account';
  END IF;
  INSERT INTO "StaffUser" (id,email,name,"passwordHash",role) VALUES(target_id,new_email,new_name,password_hash,new_role);
END $$;
REVOKE ALL ON FUNCTION app_create_staff(text,text,text,text,"StaffRole") FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_create_staff(text,text,text,text,"StaffRole") TO pailangz_app;

CREATE FUNCTION app_edit_staff(target_id text, new_email text, new_name text, new_role "StaffRole", is_suspended boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  -- Serialize staff changes, including concurrent demotion/deletion of admins.
  LOCK TABLE "StaffUser" IN SHARE ROW EXCLUSIVE MODE;
  IF NOT app_staff_allowed('ADMIN') OR target_id=current_setting('app.actor_id',true) THEN RAISE EXCEPTION 'Staff administration denied'; END IF;
  IF NOT EXISTS(SELECT FROM "StaffUser" WHERE id=target_id) THEN RAISE EXCEPTION 'Staff account not found'; END IF;
  IF length(new_name) NOT BETWEEN 1 AND 100 OR length(new_email)>254 OR new_email<>lower(btrim(new_email)) THEN RAISE EXCEPTION 'Invalid staff account'; END IF;
  IF EXISTS(SELECT FROM "StaffUser" WHERE id=target_id AND role='ADMIN' AND NOT suspended) AND (new_role<>'ADMIN' OR is_suspended) AND (SELECT count(*) FROM "StaffUser" WHERE role='ADMIN' AND NOT suspended)<=1 THEN RAISE EXCEPTION 'Last admin cannot be removed'; END IF;
  UPDATE "StaffUser" SET email=new_email,name=new_name,role=new_role,suspended=is_suspended,"sessionVersion"="sessionVersion"+1 WHERE id=target_id;
  UPDATE "StaffSession" SET revoked=true WHERE "userId"=target_id;
END $$;
REVOKE ALL ON FUNCTION app_edit_staff(text,text,text,"StaffRole",boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_edit_staff(text,text,text,"StaffRole",boolean) TO pailangz_app;

CREATE FUNCTION app_remove_staff(target_id text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  LOCK TABLE "StaffUser" IN SHARE ROW EXCLUSIVE MODE;
  IF NOT app_staff_allowed('ADMIN') OR target_id=current_setting('app.actor_id',true) THEN RAISE EXCEPTION 'Staff administration denied'; END IF;
  IF NOT EXISTS(SELECT FROM "StaffUser" WHERE id=target_id) THEN RAISE EXCEPTION 'Staff account not found'; END IF;
  IF EXISTS(SELECT FROM "StaffUser" WHERE id=target_id AND role='ADMIN' AND NOT suspended) AND (SELECT count(*) FROM "StaffUser" WHERE role='ADMIN' AND NOT suspended)<=1 THEN RAISE EXCEPTION 'Last admin cannot be removed'; END IF;
  DELETE FROM "StaffSession" WHERE "userId"=target_id;
  DELETE FROM "StaffUser" WHERE id=target_id;
  -- Historical actors are plain IDs; retain all audit and result history.
END $$;
REVOKE ALL ON FUNCTION app_remove_staff(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_remove_staff(text) TO pailangz_app;

-- Session identity is constant for a statement. Evaluate session checks once,
-- instead of re-running the staff/session join for each row and nested relation.
DO $$ DECLARE p record; q text; c text; BEGIN
  FOR p IN SELECT tablename,policyname,qual,with_check FROM pg_policies WHERE schemaname='public' LOOP
    q := replace(replace(p.qual, 'app_staff_allowed(''ADMIN''::text)', '(SELECT app_staff_allowed(''ADMIN''::text))'), 'app_staff_allowed()', '(SELECT app_staff_allowed())');
    c := replace(replace(p.with_check, 'app_staff_allowed(''ADMIN''::text)', '(SELECT app_staff_allowed(''ADMIN''::text))'), 'app_staff_allowed()', '(SELECT app_staff_allowed())');
    IF q IS DISTINCT FROM p.qual OR c IS DISTINCT FROM p.with_check THEN
      EXECUTE format('ALTER POLICY %I ON %I %s %s',p.policyname,p.tablename,
        CASE WHEN q IS NULL THEN '' ELSE 'USING ('||q||')' END,
        CASE WHEN c IS NULL THEN '' ELSE 'WITH CHECK ('||c||')' END);
    END IF;
  END LOOP;
END $$;
CREATE INDEX "StaffUser_role_suspended_idx" ON "StaffUser"(role,suspended);
CREATE INDEX "StaffUser_createdAt_id_idx" ON "StaffUser"("createdAt",id);
CREATE INDEX "AuditEvent_actorId_idx" ON "AuditEvent"("actorId");
CREATE INDEX "AuditEvent_action_createdAt_idx" ON "AuditEvent"(action,"createdAt");
$migration_010$),
    (11, '202610080011_landing_solo_names', '909e39b59e34ef42d6c6c10b1fc32b9e91f4abf56de26a69c69c01fa62368c2d', $migration_011$
-- The user approved displaying the original event's SOLO in-game names on
-- the landing page. Expose only this roster's codes and display names; other
-- tournaments, team memberships and private registration fields stay hidden.
CREATE VIEW "PublicEventPlayerName" AS
SELECT t.slug, p.code, m."displayIgn" AS ign
FROM "Tournament" t
JOIN "Participant" p ON p."tournamentId" = t.id
JOIN "Member" m ON m.id = p."memberId"
WHERE t.status <> 'ARCHIVED' AND NOT m.archived
  AND t.id = (SELECT value #>> '{}' FROM "IntegrationSetting" WHERE key = 'officialSeedTournament');
GRANT SELECT ON "PublicEventPlayerName" TO pailangz_app;
$migration_011$),
    (12, '202610080012_web_registration', '5c2d7740c9089d9fac067668b4187b96ba5aff9084451ab0971daa4d52c7f54b', $migration_012$
-- Narrow anonymous intake. Existing staff-only table policies stay in place.
-- It writes encrypted submissions and fixed provenance; it returns no rows or
-- conflict details and never modifies members, staff, or tournament eligibility.
CREATE FUNCTION app_submit_registration(
  submission_id text, job_id text, display_ign text, canonical_ign text,
  encrypted_payload text, encrypted_phone text, last_four text, phone_issue text,
  conflict_id text, audit_id text
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE existing_member text; pending boolean; conflict_reason text;
BEGIN
  IF submission_id IS NULL OR submission_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    OR job_id IS NULL OR conflict_id IS NULL OR audit_id IS NULL
    OR display_ign IS NULL OR length(btrim(display_ign)) NOT BETWEEN 1 AND 80
    OR canonical_ign IS NULL OR length(btrim(canonical_ign)) NOT BETWEEN 1 AND 240
    OR encrypted_payload IS NULL OR length(encrypted_payload) NOT BETWEEN 30 AND 16000
    OR encrypted_payload !~ '^[^.]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$'
    OR (encrypted_phone IS NOT NULL AND (length(encrypted_phone) NOT BETWEEN 30 AND 1000
      OR encrypted_phone !~ '^[^.]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$'))
    OR (last_four IS NOT NULL AND last_four !~ '^[0-9]{0,4}$')
    OR (phone_issue IS NOT NULL AND phone_issue NOT IN ('MISSING','INVALID_REQUIRES_REVIEW'))
  THEN RAISE EXCEPTION 'Invalid registration'; END IF;

  -- Serialize retries and submissions with the same canonical IGN.
  PERFORM pg_advisory_xact_lock(hashtextextended(submission_id, 12));
  IF EXISTS(SELECT FROM "RegistrationSubmission" WHERE source='WEB_FORM' AND "sourceResponseId"=submission_id) THEN
    RETURN 1;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(canonical_ign, 13));
  SELECT id INTO existing_member FROM "Member" WHERE "canonicalIgn"=canonical_ign;
  SELECT EXISTS(SELECT FROM "RegistrationSubmission" WHERE "canonicalIgn"=canonical_ign
    AND status IN ('PENDING','NEEDS_CLARIFICATION')) INTO pending;

  INSERT INTO "ImportJob" (id,source,"rowCount") VALUES(job_id,'WEB_FORM',1);
  INSERT INTO "RegistrationSubmission" (
    id,source,"sourceResponseId","importJobId","originalIgn","displayIgn","canonicalIgn",
    "payloadEncrypted","phoneEncrypted","phoneLastFour","phoneIssue",status
  ) VALUES (
    submission_id,'WEB_FORM',submission_id,job_id,display_ign,display_ign,canonical_ign,
    encrypted_payload,encrypted_phone,last_four,phone_issue,'PENDING'
  );
  IF existing_member IS NOT NULL OR pending THEN
    conflict_reason := CASE WHEN existing_member IS NOT NULL
      THEN 'Canonical IGN already exists; explicit linking required.'
      ELSE 'Canonical IGN is already in the review inbox; resolve the conflict explicitly.' END;
    INSERT INTO "IgnConflict" (id,"submissionId","existingMemberId",reason)
      VALUES(conflict_id,submission_id,existing_member,conflict_reason);
  END IF;
  INSERT INTO "AuditEvent" (
    id,"actorRole",action,"entityType","entityId","correlationId",source,changes,"relatedIds"
  ) VALUES (
    audit_id,'PUBLIC','REGISTRATION_SUBMIT','SUBMISSION',submission_id,audit_id,'WEB_FORM',
    jsonb_build_object('changedFields',jsonb_build_array('IGN','Whatsapp Number','Tiktok username',
      'Tiktok ID','Discord Name','Discord ID','State/Province','Country'),
      'conflict',existing_member IS NOT NULL OR pending),ARRAY[job_id]
  );
  RETURN 1;
END $$;
REVOKE ALL ON FUNCTION app_submit_registration(text,text,text,text,text,text,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_submit_registration(text,text,text,text,text,text,text,text,text,text) TO pailangz_app;
$migration_012$),
    (13, '202610080013_tournament_participation', '0cf899ac9e2b8d7ccc9a8595d85521b525b9efad9ddecffe67a629697648117c', $migration_013$
CREATE TABLE "ParticipationRequest" (
  id text PRIMARY KEY,
  "tournamentId" text NOT NULL REFERENCES "Tournament"(id) ON DELETE RESTRICT,
  "memberId" text NOT NULL REFERENCES "Member"(id) ON DELETE RESTRICT,
  "createdAt" timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT "ParticipationRequest_tournamentId_memberId_key" UNIQUE ("tournamentId", "memberId")
);
CREATE INDEX "ParticipationRequest_createdAt_idx" ON "ParticipationRequest"("createdAt");
ALTER TABLE "ParticipationRequest" ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON "ParticipationRequest" TO pailangz_app;
CREATE POLICY participation_staff_read ON "ParticipationRequest" FOR SELECT TO pailangz_app
  USING ((SELECT app_staff_allowed()));

-- Node must decrypt the exact member's record to compare the saved TikTok ID.
-- No anonymous table reads, prefix searches, or public HTTP lookup are added.
CREATE FUNCTION app_participation_identity(canonical_ign text)
RETURNS TABLE(member_id text, encrypted_record text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT m.id, p."registrationEncrypted"
  FROM "Member" m JOIN "MemberPrivate" p ON p."memberId"=m.id
  WHERE m."canonicalIgn"=canonical_ign AND m.verified AND NOT m.archived
    AND length(canonical_ign) BETWEEN 1 AND 240
$$;
REVOKE ALL ON FUNCTION app_participation_identity(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_participation_identity(text) TO pailangz_app;

CREATE FUNCTION app_submit_participation(
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
    FOR SHARE OF t;
  IF event_id IS NULL THEN RETURN 'CLOSED'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(event_id || ':' || member_id, 14));
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
$migration_013$),
    (14, '202610080014_participation_capacity', 'b1471ca62b3567c20e748ed57b91aeda8845a62a91949aebc14ad518df9c9133', $migration_014$
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
$migration_014$),
    (15, '202610080015_team_applications', 'b6225bd628de736b05c2a1f23437662c98952f912ec2fda7851aa523eb17aabc', $migration_015$
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
$migration_015$),
    (16, '202610080016_team_access_without_phone', '3307c2dc957d98fd46e7fd7b3a1b14716c575fb2ee031b4e7ded97841e907a8a', $migration_016$
-- Team access follows the existing participation identity check: IGN + saved TikTok ID.
DROP FUNCTION app_team_identity(text);
DROP FUNCTION app_team_start_session(text,text,text,text);
ALTER TABLE "MemberAccessSession" DROP COLUMN "verifiedPhone";
CREATE FUNCTION app_team_start_session(member_id text, verified_record text, token_hash text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF token_hash IS NULL OR token_hash !~ '^[a-f0-9]{64}$' THEN RETURN false; END IF;
  PERFORM m.id FROM "Member" m JOIN "MemberPrivate" p ON p."memberId"=m.id
    WHERE m.id=member_id AND m.verified AND NOT m.archived
      AND p."registrationEncrypted"=verified_record FOR SHARE OF m,p;
  IF NOT FOUND THEN RETURN false; END IF;
  DELETE FROM "MemberAccessSession" WHERE "memberId"=member_id AND "expiresAt"<=now();
  INSERT INTO "MemberAccessSession"("tokenHash","memberId","verifiedRecord","expiresAt")
    VALUES(token_hash,member_id,verified_record,now()+interval '8 hours');
  RETURN true;
END $$;
CREATE OR REPLACE FUNCTION app_team_actor(token_hash text) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT s."memberId" FROM "MemberAccessSession" s
  JOIN "Member" m ON m.id=s."memberId" JOIN "MemberPrivate" p ON p."memberId"=m.id
  WHERE s."tokenHash"=token_hash AND s."expiresAt">now() AND m.verified AND NOT m.archived
    AND s."verifiedRecord"=p."registrationEncrypted"
$$;
REVOKE ALL ON FUNCTION app_team_start_session(text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_team_start_session(text,text,text) TO pailangz_app;
$migration_016$),
    (17, '202610080017_automatic_participation_approval', '40a111d6686720677322495145799d93d396a74567034ff43c113604bad671b4', $migration_017$
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
$migration_017$),
    (18, '202610080018_team_avatars', 'b7b0926eeb35e85b98cbb40e5c7762a50be13ec91ecb1aa3ea093b1c7d172e91', $migration_018$
-- Only the small, re-encoded 64px avatar is stored; originals are discarded.
ALTER TABLE "Team" ADD COLUMN "avatarImage" text;
ALTER TABLE "Team" ADD CONSTRAINT team_avatar_image CHECK (
  "avatarImage" IS NULL OR (
    length("avatarImage") <= 32768 AND
    "avatarImage" ~ '^data:image/webp;base64,[A-Za-z0-9+/]+={0,2}$'
  )
);
CREATE OR REPLACE VIEW "PublicTeamDirectory" AS
  SELECT e.slug AS "tournamentSlug",team.slug,team.name,team.code,
    EXISTS(SELECT FROM "Member" m JOIN "Participant" p ON p."memberId"=m.id AND p."tournamentId"=t.id AND p.eligible
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

CREATE FUNCTION app_team_create_with_avatar(token_hash text,event_slug text,team_slug text,team_name text,entity_id text,audit_id text,avatar_image text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE result jsonb;
BEGIN
  IF avatar_image IS NOT NULL AND (length(avatar_image)>32768 OR avatar_image !~ '^data:image/webp;base64,[A-Za-z0-9+/]+={0,2}$')
    THEN RETURN jsonb_build_object('error','INVALID_IMAGE'); END IF;
  -- Reuse the existing approval, owner, roster and capacity checks. Saving the
  -- avatar and creating the team share one transaction, including its audit.
  result:=app_team_action(token_hash,event_slug,'CREATE',team_slug,team_name,'',entity_id,audit_id);
  IF result ? 'error' THEN RETURN result; END IF;
  UPDATE "Team" SET "avatarImage"=avatar_image WHERE id=entity_id;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION app_team_create_with_avatar(text,text,text,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_team_create_with_avatar(text,text,text,text,text,text,text) TO pailangz_app;
$migration_018$),
    (19, '202610080019_participation_registration_status', '75972ea302c4a8b7ce725e742f3331e18a87319993092b3525032d59d8a06c00', $migration_019$
-- Expose only availability for the individually shared registration link.
-- Use the same lifecycle and distinct player pool as app_submit_participation;
-- private applications and member records remain inaccessible to anonymous users.
CREATE FUNCTION app_participation_status() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT COALESCE((
    SELECT CASE WHEN (
      SELECT count(*) FROM (
        SELECT p."memberId" FROM "ParticipationRequest" p WHERE p."tournamentId"=t.id
        UNION SELECT p."memberId" FROM "Participant" p WHERE p."tournamentId"=t.id
      ) players
    ) >= LEAST(32,c.capacity) THEN 'FULL' ELSE 'OPEN' END
    FROM "Tournament" t
    JOIN "IntegrationSetting" s ON s.key='officialSeedTournament' AND t.id=s.value #>> '{}'
    JOIN "Category" c ON c."tournamentId"=t.id AND c.kind='SOLO'
    WHERE t.slug='pailangz-solo-team' AND NOT t.published
      AND t.status IN ('DRAFT','REGISTRATION_OPEN')
      AND (t."registrationDeadline" IS NULL OR t."registrationDeadline">now())
      AND EXISTS(SELECT FROM "Category" team WHERE team."tournamentId"=t.id AND team.kind='TEAM')
  ), 'CLOSED')
$$;
REVOKE ALL ON FUNCTION app_participation_status() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_participation_status() TO pailangz_app;
$migration_019$),
    (20, '202610080020_moderator_tournament_setup', '020603ff43c20ea4c22035c06f58fef8fa0659be575128ff27843823942b6610', $migration_020$
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
$migration_020$)
    ) AS pending(ordinal, name, checksum, sql)
    ORDER BY ordinal
  LOOP
    IF EXISTS (SELECT FROM public."_prisma_migrations"
               WHERE migration_name=migration.name AND rolled_back_at IS NULL AND finished_at IS NOT NULL) THEN
      CONTINUE;
    END IF;
    migration_started_at := clock_timestamp();
    RAISE NOTICE 'Applying %', migration.name;
    EXECUTE migration.sql;
    INSERT INTO public."_prisma_migrations"
      (id, checksum, started_at, finished_at, migration_name, logs, rolled_back_at, applied_steps_count)
    VALUES
      (gen_random_uuid()::text, migration.checksum, migration_started_at, clock_timestamp(), migration.name, NULL, NULL, 1);
    applied_count := applied_count + 1;
  END LOOP;

  SELECT count(*) INTO completed_count FROM public."_prisma_migrations"
  WHERE rolled_back_at IS NULL AND finished_at IS NOT NULL;
  IF completed_count <> jsonb_array_length(expected) THEN
    RAISE EXCEPTION 'Final migration count mismatch; rolling back this upgrade.';
  END IF;
  RAISE NOTICE 'PAILANGZ migration 020 verified. Applied % migration(s); % total completed.', applied_count, completed_count;
END
$pailangz_upgrade$;

-- After success this returns 20 completed migrations, ending with
-- 202610080020_moderator_tournament_setup. Deploy the updated app afterwards.
SELECT migration_name, finished_at
FROM public."_prisma_migrations"
WHERE rolled_back_at IS NULL AND finished_at IS NOT NULL
ORDER BY migration_name;
