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
