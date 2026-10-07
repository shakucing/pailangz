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
