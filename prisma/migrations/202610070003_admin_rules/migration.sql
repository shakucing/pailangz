CREATE FUNCTION admin_rule_changes() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF current_user='pailangz_app' AND NOT app_staff_allowed('ADMIN') THEN
  IF TG_TABLE_NAME='Stage' AND (NEW.rules IS DISTINCT FROM OLD.rules OR NEW."confirmedRules" IS DISTINCT FROM OLD."confirmedRules" OR NEW."ruleVersion"<>OLD."ruleVersion") THEN RAISE EXCEPTION 'Rule confirmation requires admin'; END IF;
  IF TG_TABLE_NAME='Tournament' AND NEW."mappingConfirmed" IS DISTINCT FROM OLD."mappingConfirmed" THEN RAISE EXCEPTION 'Mapping confirmation requires admin'; END IF;
 END IF;RETURN NEW;END $$;
CREATE TRIGGER stage_admin_rules BEFORE UPDATE ON "Stage" FOR EACH ROW EXECUTE FUNCTION admin_rule_changes();
CREATE TRIGGER tournament_admin_mapping BEFORE UPDATE ON "Tournament" FOR EACH ROW EXECUTE FUNCTION admin_rule_changes();
CREATE FUNCTION admin_initial_publication() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF current_user='pailangz_app' AND NEW.published AND NOT app_staff_allowed('ADMIN') THEN RAISE EXCEPTION 'Publication requires admin'; END IF;RETURN NEW;END $$;
CREATE TRIGGER announcement_initial_publication BEFORE INSERT ON "Announcement" FOR EACH ROW EXECUTE FUNCTION admin_initial_publication();
CREATE TRIGGER tournament_initial_publication BEFORE INSERT ON "Tournament" FOR EACH ROW EXECUTE FUNCTION admin_initial_publication();
CREATE TRIGGER stage_initial_publication BEFORE INSERT ON "Stage" FOR EACH ROW EXECUTE FUNCTION admin_initial_publication();
