ALTER TYPE "MatchStatus" ADD VALUE 'BYE';
ALTER ROLE pailangz_app SET timezone = 'UTC';
-- Evaluate record fields only for the corresponding trigger table.
CREATE OR REPLACE FUNCTION admin_rule_changes() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF current_user='pailangz_app' AND NOT app_staff_allowed('ADMIN') THEN
  IF TG_TABLE_NAME='Stage' THEN
   IF NEW.rules IS DISTINCT FROM OLD.rules OR NEW."confirmedRules" IS DISTINCT FROM OLD."confirmedRules" OR NEW."ruleVersion"<>OLD."ruleVersion" THEN RAISE EXCEPTION 'Rule confirmation requires admin'; END IF;
  ELSIF TG_TABLE_NAME='Tournament' THEN
   IF NEW."mappingConfirmed" IS DISTINCT FROM OLD."mappingConfirmed" THEN RAISE EXCEPTION 'Mapping confirmation requires admin'; END IF;
  END IF;
 END IF; RETURN NEW;
END $$;
ALTER TABLE "Tournament" ADD COLUMN configuration JSONB NOT NULL DEFAULT '{}', ADD COLUMN "configurationVersion" INTEGER NOT NULL DEFAULT 1;
UPDATE "Tournament" SET configuration='{"soloCapacity":64,"teamCapacity":16,"leagueRounds":6,"leagueMatchesPerPlayer":6,"soloBracketSize":16,"teamBracketSize":16,"directSlots":8,"playoffSlots":8,"playoffEntrants":16,"qualificationMatchesPerPlayer":2,"leagueByePolicy":"none","bracketByePolicy":"none","scheduleSource":"supplied"}' WHERE slug='pailangz-solo-team';
ALTER TABLE "Stage" ADD COLUMN archived BOOLEAN NOT NULL DEFAULT false, ADD COLUMN "archivedStandings" JSONB;
CREATE TABLE "ConfigurationRevision" (id TEXT PRIMARY KEY, "tournamentId" TEXT NOT NULL REFERENCES "Tournament"(id), version INTEGER NOT NULL, "beforeConfiguration" JSONB NOT NULL, configuration JSONB NOT NULL, status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','APPLIED','REJECTED')), "requiresAdmin" BOOLEAN NOT NULL DEFAULT false, "reasonEncrypted" TEXT NOT NULL, "resolutionEncrypted" TEXT, "createdBy" TEXT NOT NULL, "appliedBy" TEXT, "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT now(), "appliedAt" TIMESTAMPTZ(3), UNIQUE("tournamentId",version));
ALTER TABLE "ConfigurationRevision" ENABLE ROW LEVEL SECURITY;
GRANT SELECT,INSERT,UPDATE ON "ConfigurationRevision" TO pailangz_app;
CREATE POLICY staff_revision ON "ConfigurationRevision" TO pailangz_app USING(app_staff_allowed()) WITH CHECK(app_staff_allowed());
CREATE FUNCTION revision_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF OLD.status<>'PENDING' THEN RAISE EXCEPTION 'Applied/rejected revision history is immutable'; END IF;
 IF NEW.id<>OLD.id OR NEW."createdBy"<>OLD."createdBy" OR NEW."createdAt"<>OLD."createdAt" OR NEW.configuration<>OLD.configuration OR NEW."beforeConfiguration"<>OLD."beforeConfiguration" OR NEW."reasonEncrypted"<>OLD."reasonEncrypted" OR NEW."tournamentId"<>OLD."tournamentId" OR NEW.version<>OLD.version OR NEW."requiresAdmin"<>OLD."requiresAdmin" THEN RAISE EXCEPTION 'Revision proposal is immutable'; END IF;
 IF OLD."requiresAdmin" AND NOT app_staff_allowed('ADMIN') THEN RAISE EXCEPTION 'Controlled revision requires an admin'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER revision_immutable BEFORE UPDATE ON "ConfigurationRevision" FOR EACH ROW EXECUTE FUNCTION revision_guard();
CREATE FUNCTION configuration_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.configuration IS DISTINCT FROM OLD.configuration OR NEW."configurationVersion" IS DISTINCT FROM OLD."configurationVersion" THEN
  IF NOT EXISTS(SELECT FROM "ConfigurationRevision" r WHERE r.id=current_setting('app.config_revision_id',true) AND r."tournamentId"=NEW.id AND r.configuration=NEW.configuration AND r.version=NEW."configurationVersion" AND r.version>OLD."configurationVersion" AND r.status='PENDING' AND (NOT r."requiresAdmin" OR app_staff_allowed('ADMIN'))) THEN RAISE EXCEPTION 'Configuration changes require a recorded revision'; END IF;
 END IF; RETURN NEW;
END $$;
CREATE TRIGGER controlled_configuration BEFORE UPDATE OF configuration,"configurationVersion" ON "Tournament" FOR EACH ROW EXECUTE FUNCTION configuration_guard();

CREATE FUNCTION archived_match_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF EXISTS(SELECT FROM "Round" r JOIN "Stage" s ON s.id=r."stageId" WHERE r.id=OLD."roundId" AND s.archived) THEN RAISE EXCEPTION 'Archived matches are immutable competition history'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER archived_match_immutable BEFORE UPDATE ON "Match" FOR EACH ROW EXECUTE FUNCTION archived_match_guard();

CREATE FUNCTION category_capacity_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.capacity<>(SELECT (t.configuration->>CASE WHEN NEW.kind='SOLO' THEN 'soloCapacity' ELSE 'teamCapacity' END)::integer FROM "Tournament" t WHERE t.id=NEW."tournamentId") THEN RAISE EXCEPTION 'Capacity must match recorded tournament configuration'; END IF;
 IF NEW.kind='SOLO' AND NEW.capacity<(SELECT count(*) FROM "Participant" WHERE "tournamentId"=NEW."tournamentId") THEN RAISE EXCEPTION 'Capacity cannot remove assigned entrants'; END IF;
 IF NEW.kind='TEAM' AND NEW.capacity<(SELECT count(*) FROM "Team" WHERE "categoryId"=NEW.id AND NOT archived) THEN RAISE EXCEPTION 'Capacity cannot remove active teams'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER configured_capacity BEFORE INSERT OR UPDATE OF capacity ON "Category" FOR EACH ROW EXECUTE FUNCTION category_capacity_guard();

CREATE FUNCTION archived_stage_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF OLD.archived THEN RAISE EXCEPTION 'Archived stages are immutable competition history'; END IF; RETURN NEW;
END $$;
CREATE TRIGGER archived_stage_immutable BEFORE UPDATE ON "Stage" FOR EACH ROW EXECUTE FUNCTION archived_stage_guard();

CREATE FUNCTION archived_result_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF EXISTS(SELECT FROM "Match" m JOIN "Round" r ON r.id=m."roundId" JOIN "Stage" s ON s.id=r."stageId" WHERE m.id=NEW."matchId" AND s.archived) THEN RAISE EXCEPTION 'Archived result history cannot be edited'; END IF; RETURN NEW;
END $$;
CREATE TRIGGER archived_result_immutable BEFORE INSERT OR UPDATE ON "ResultVersion" FOR EACH ROW EXECUTE FUNCTION archived_result_guard();
