-- Password hashes remain inaccessible to the runtime; verify the current admin
-- session inside the database, including when a caller forges an application role.
CREATE FUNCTION app_reset_staff_password(target_id text, password_hash text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE target_email text;
BEGIN
  LOCK TABLE "StaffUser" IN SHARE ROW EXCLUSIVE MODE;
  IF NOT app_staff_allowed('ADMIN') OR target_id=current_setting('app.actor_id',true) THEN
    RAISE EXCEPTION 'Staff administration denied';
  END IF;
  IF password_hash IS NULL OR password_hash !~ '^\$2[aby]\$12\$[./a-zA-Z0-9]{53}$' THEN
    RAISE EXCEPTION 'Invalid password hash';
  END IF;
  SELECT email INTO target_email FROM "StaffUser" WHERE id=target_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Staff account not found'; END IF;
  UPDATE "StaffUser" SET "passwordHash"=password_hash,"sessionVersion"="sessionVersion"+1 WHERE id=target_id;
  UPDATE "StaffSession" SET revoked=true WHERE "userId"=target_id;
  DELETE FROM "AuthThrottle" WHERE key='login:'||encode(sha256(convert_to(lower(btrim(target_email)),'UTF8')),'hex');
END $$;
REVOKE ALL ON FUNCTION app_reset_staff_password(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_reset_staff_password(text,text) TO pailangz_app;
