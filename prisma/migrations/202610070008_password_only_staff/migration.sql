-- The user's later request replaces the original mandatory MFA requirement.
-- Preserve staff identities/password hashes, and expire prior sessions.
REVOKE UPDATE("lastTotpStep") ON "StaffUser" FROM pailangz_app;
ALTER TABLE "StaffUser" DROP COLUMN "totpEncrypted", DROP COLUMN "lastTotpStep";
UPDATE "StaffSession" SET revoked=true;
UPDATE "StaffUser" SET "sessionVersion"="sessionVersion"+1;
INSERT INTO "AuditEvent" (id,"actorRole",action,"entityType","entityId",changes,reason,"correlationId",source,outcome)
VALUES (gen_random_uuid()::text,'SYSTEM','STAFF_AUTHENTICATION_POLICY_CHANGE','SECURITY','staff-login','{"authenticationMethod":"password","authenticatorRequired":false,"priorSessionsRevoked":true}'::jsonb,'User requested removal of the authenticator requirement; existing passwords and staff roles are preserved.',gen_random_uuid()::text,'MIGRATION','SUCCESS');
