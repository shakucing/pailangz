-- The app is not a database owner and cannot bypass row policies.
DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='pailangz_app') THEN CREATE ROLE pailangz_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS; END IF; END $$;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO pailangz_app;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
CREATE TABLE "DeploymentEnvironment" (singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton), tier text NOT NULL CHECK(tier IN ('development','preview','production')));
INSERT INTO "DeploymentEnvironment" (tier) VALUES ('development');
GRANT SELECT ON "DeploymentEnvironment" TO pailangz_app;
CREATE FUNCTION app_staff_allowed(required_role text DEFAULT 'STAFF') RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM "StaffUser" u JOIN "StaffSession" s ON s."userId"=u.id
    WHERE u.id=current_setting('app.actor_id',true) AND s.id=current_setting('app.session_id',true)
    AND NOT u.suspended AND NOT s.revoked AND s."expiresAt">now()
    AND (u.role='ADMIN' OR required_role='STAFF' AND u.role='MODERATOR'));
$$;
REVOKE ALL ON FUNCTION app_staff_allowed(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_staff_allowed(text) TO pailangz_app;
GRANT SELECT,INSERT,UPDATE ON "StaffSession","AuthThrottle" TO pailangz_app;
GRANT SELECT ON "StaffUser" TO pailangz_app;
-- Credentials login can atomically consume a TOTP step; it cannot write roles or passwords.
GRANT UPDATE("lastTotpStep") ON "StaffUser" TO pailangz_app;
CREATE FUNCTION app_update_staff(target_id text,new_role "StaffRole",is_suspended boolean) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NOT app_staff_allowed('ADMIN') OR target_id=current_setting('app.actor_id',true) THEN RAISE EXCEPTION 'Staff administration denied'; END IF;
 IF EXISTS(SELECT FROM "StaffUser" WHERE id=target_id AND role='ADMIN' AND NOT suspended) AND (new_role<>'ADMIN' OR is_suspended) AND (SELECT count(*) FROM "StaffUser" WHERE role='ADMIN' AND NOT suspended)<=1 THEN RAISE EXCEPTION 'Last admin cannot be removed'; END IF;
 UPDATE "StaffUser" SET role=new_role,suspended=is_suspended,"sessionVersion"="sessionVersion"+1 WHERE id=target_id;
 UPDATE "StaffSession" SET revoked=true WHERE "userId"=target_id;
END $$;
REVOKE ALL ON FUNCTION app_update_staff(text,"StaffRole",boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_update_staff(text,"StaffRole",boolean) TO pailangz_app;
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['MemberPrivate','ImportJob','RegistrationSubmission','SubmissionDecision','IgnConflict','Evidence','Dispute','RankingSnapshot','BracketDependency'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('GRANT SELECT,INSERT,UPDATE ON %I TO pailangz_app',t);
    EXECUTE format('CREATE POLICY staff_only ON %I TO pailangz_app USING (app_staff_allowed()) WITH CHECK (app_staff_allowed())',t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['Member','Tournament','Category','Stage','Participant','Team','TeamMembership','Round','Match','ResultVersion','GameResult','Announcement','IntegrationSetting'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('GRANT SELECT,INSERT,UPDATE ON %I TO pailangz_app',t);
    EXECUTE format('CREATE POLICY staff_read ON %I FOR SELECT TO pailangz_app USING (app_staff_allowed())',t);
    EXECUTE format('CREATE POLICY staff_insert ON %I FOR INSERT TO pailangz_app WITH CHECK (app_staff_allowed())',t);
    EXECUTE format('CREATE POLICY staff_update ON %I FOR UPDATE TO pailangz_app USING (app_staff_allowed()) WITH CHECK (app_staff_allowed())',t);
  END LOOP;
END $$;
CREATE POLICY public_member ON "Member" FOR SELECT TO pailangz_app USING (verified AND NOT archived AND EXISTS(SELECT FROM "Participant" p JOIN "Tournament" t ON t.id=p."tournamentId" WHERE p."memberId"="Member".id AND p.eligible AND t.published AND t.status NOT IN ('DRAFT','ARCHIVED')));
CREATE POLICY public_tournament ON "Tournament" FOR SELECT TO pailangz_app USING(published AND status NOT IN ('DRAFT','ARCHIVED'));
CREATE POLICY public_category ON "Category" FOR SELECT TO pailangz_app USING(EXISTS(SELECT FROM "Tournament" t WHERE t.id="tournamentId" AND t.published));
CREATE POLICY public_stage ON "Stage" FOR SELECT TO pailangz_app USING(published AND EXISTS(SELECT FROM "Category" c JOIN "Tournament" t ON t.id=c."tournamentId" WHERE c.id="categoryId" AND t.published));
CREATE POLICY public_participant ON "Participant" FOR SELECT TO pailangz_app USING(eligible AND EXISTS(SELECT FROM "Tournament" t WHERE t.id="tournamentId" AND t.published));
CREATE POLICY public_team ON "Team" FOR SELECT TO pailangz_app USING(NOT archived AND EXISTS(SELECT FROM "Category" c WHERE c.id="categoryId"));
CREATE POLICY public_membership ON "TeamMembership" FOR SELECT TO pailangz_app USING(active AND EXISTS(SELECT FROM "Team" t WHERE t.id="teamId"));
CREATE POLICY public_round ON "Round" FOR SELECT TO pailangz_app USING(EXISTS(SELECT FROM "Stage" s WHERE s.id="stageId"));
CREATE POLICY public_match ON "Match" FOR SELECT TO pailangz_app USING(EXISTS(SELECT FROM "Round" r WHERE r.id="roundId"));
-- Result reason is encrypted; public DAL never selects it or any submitter identifiers.
CREATE POLICY public_result ON "ResultVersion" FOR SELECT TO pailangz_app USING(status='ACCEPTED' AND EXISTS(SELECT FROM "Match" m WHERE m.id="matchId" AND m.status='FINALIZED' AND m."currentResultId"="ResultVersion".id));
CREATE POLICY public_game ON "GameResult" FOR SELECT TO pailangz_app USING(EXISTS(SELECT FROM "ResultVersion" r WHERE r.id="resultId"));
CREATE POLICY public_announcement ON "Announcement" FOR SELECT TO pailangz_app USING(published AND NOT archived);
CREATE POLICY public_responder ON "IntegrationSetting" FOR SELECT TO pailangz_app USING(key='responderUrl');
-- Settings/publication require an administrator even if UI checks are bypassed.
DROP POLICY staff_insert ON "IntegrationSetting";
DROP POLICY staff_update ON "IntegrationSetting";
CREATE POLICY admin_setting_insert ON "IntegrationSetting" FOR INSERT TO pailangz_app WITH CHECK(app_staff_allowed('ADMIN'));
CREATE POLICY admin_setting_update ON "IntegrationSetting" FOR UPDATE TO pailangz_app USING(app_staff_allowed('ADMIN')) WITH CHECK(app_staff_allowed('ADMIN'));
ALTER TABLE "AuditEvent" ENABLE ROW LEVEL SECURITY;
GRANT SELECT,INSERT ON "AuditEvent" TO pailangz_app;
CREATE POLICY audit_read ON "AuditEvent" FOR SELECT TO pailangz_app USING(app_staff_allowed('ADMIN') OR app_staff_allowed() AND "entityType" NOT IN ('STAFF','SECURITY','SETTING'));
CREATE POLICY audit_insert ON "AuditEvent" FOR INSERT TO pailangz_app WITH CHECK(app_staff_allowed() AND "actorId"=current_setting('app.actor_id',true) OR "actorRole"='AUTH' AND "entityType"='SECURITY');
CREATE FUNCTION audit_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Audit history is append-only'; END $$;
CREATE TRIGGER immutable_audit BEFORE UPDATE OR DELETE ON "AuditEvent" FOR EACH ROW EXECUTE FUNCTION audit_immutable();
CREATE FUNCTION result_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF OLD.status='ACCEPTED' THEN RAISE EXCEPTION 'Accepted result versions are immutable'; END IF; RETURN NEW; END $$;
CREATE TRIGGER immutable_accepted_result BEFORE UPDATE OR DELETE ON "ResultVersion" FOR EACH ROW EXECUTE FUNCTION result_immutable();
CREATE UNIQUE INDEX one_active_team_per_category ON "TeamMembership"("categoryId","memberId") WHERE active;
ALTER TABLE "MemberPrivate" ADD CONSTRAINT private_source_fk FOREIGN KEY("sourceSubmissionId") REFERENCES "RegistrationSubmission"(id);
ALTER TABLE "RegistrationSubmission" ADD CONSTRAINT linked_member_fk FOREIGN KEY("linkedMemberId") REFERENCES "Member"(id);
ALTER TABLE "IgnConflict" ADD CONSTRAINT conflict_member_fk FOREIGN KEY("existingMemberId") REFERENCES "Member"(id);
ALTER TABLE "Match" ADD CONSTRAINT no_self_match CHECK("sideAId" IS NULL OR "sideBId" IS NULL OR "sideAId"<>"sideBId");
ALTER TABLE "GameResult" ADD CONSTRAINT nonnegative_scores CHECK("scoreA">=0 AND "scoreB">=0);
CREATE FUNCTION validate_roster() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.active THEN
  IF NOT EXISTS(SELECT FROM "Team" WHERE id=NEW."teamId" AND "categoryId"=NEW."categoryId" AND NOT archived) THEN RAISE EXCEPTION 'Team category mismatch'; END IF;
  IF NOT EXISTS(SELECT FROM "Member" WHERE id=NEW."memberId" AND verified AND NOT archived) THEN RAISE EXCEPTION 'Unapproved team member'; END IF;
  PERFORM 1 FROM "Team" WHERE id=NEW."teamId" FOR UPDATE;
  IF (SELECT count(*) FROM "TeamMembership" WHERE "teamId"=NEW."teamId" AND active AND id<>NEW.id)>=4 THEN RAISE EXCEPTION 'Team already has four players'; END IF;
 END IF;RETURN NEW;END $$;
CREATE TRIGGER roster_constraint BEFORE INSERT OR UPDATE ON "TeamMembership" FOR EACH ROW EXECUTE FUNCTION validate_roster();
CREATE FUNCTION validate_match_refs() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE tid text;cid text;side text; BEGIN
 SELECT c."tournamentId",c.id INTO tid,cid FROM "Round" r JOIN "Stage" s ON s.id=r."stageId" JOIN "Category" c ON c.id=s."categoryId" WHERE r.id=NEW."roundId";
 FOREACH side IN ARRAY ARRAY[NEW."sideAId",NEW."sideBId"] LOOP IF side IS NOT NULL THEN
  IF NEW."sideKind"='PARTICIPANT' AND NOT EXISTS(SELECT FROM "Participant" WHERE id=side AND "tournamentId"=tid) THEN RAISE EXCEPTION 'Unknown participant'; END IF;
  IF NEW."sideKind"='TEAM' AND NOT EXISTS(SELECT FROM "Team" WHERE id=side AND "categoryId"=cid) THEN RAISE EXCEPTION 'Unknown team'; END IF;
 END IF;END LOOP;RETURN NEW;END $$;
CREATE TRIGGER match_ref_constraint BEFORE INSERT OR UPDATE ON "Match" FOR EACH ROW EXECUTE FUNCTION validate_match_refs();
CREATE FUNCTION admin_publication() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF current_user='pailangz_app' AND (NEW.published IS DISTINCT FROM OLD.published) AND NOT app_staff_allowed('ADMIN') THEN RAISE EXCEPTION 'Publication requires admin'; END IF;RETURN NEW;END $$;
CREATE TRIGGER tournament_publication BEFORE UPDATE ON "Tournament" FOR EACH ROW EXECUTE FUNCTION admin_publication();
CREATE TRIGGER announcement_publication BEFORE UPDATE ON "Announcement" FOR EACH ROW EXECUTE FUNCTION admin_publication();
CREATE TRIGGER stage_publication BEFORE UPDATE ON "Stage" FOR EACH ROW EXECUTE FUNCTION admin_publication();
