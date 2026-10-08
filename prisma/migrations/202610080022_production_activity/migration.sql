-- Keep original audit events append-only. Persist verified development identities
-- separately so their old activity stays excluded after test accounts are removed.
CREATE TABLE "DevelopmentAuditActor" (id text PRIMARY KEY);
INSERT INTO "DevelopmentAuditActor" (id)
SELECT id FROM "StaffUser"
WHERE email ~ '^[^@]+@synthetic\.invalid$'
  AND name ~ '^Disposable (synthetic|browser) QA(\y|$)'
UNION
SELECT "entityId" FROM "AuditEvent"
WHERE action IN ('QA_ACCOUNT_PROVISION','QA_ACCOUNT_REVOKE') AND "entityId" <> 'synthetic-qa'
UNION
SELECT jsonb_array_elements_text(changes->'accountIds') FROM "AuditEvent"
WHERE action IN ('QA_ACCOUNT_PROVISION','QA_ACCOUNT_REVOKE','QA_STAFF_REMOVE')
  AND jsonb_typeof(changes->'accountIds')='array';
REVOKE ALL ON "DevelopmentAuditActor" FROM PUBLIC;
GRANT SELECT ON "DevelopmentAuditActor" TO pailangz_app;

-- A restrictive policy combines with existing staff permissions. It covers
-- activity lists, counts, dashboard previews and exports in the deployed app.
CREATE POLICY production_activity_only ON "AuditEvent" AS RESTRICTIVE
FOR SELECT TO pailangz_app USING (
  (SELECT tier FROM "DeploymentEnvironment" LIMIT 1) <> 'production'
  OR NOT (
    source='TEST'
    OR action IN ('QA_ACCOUNT_PROVISION','QA_ACCOUNT_REVOKE','QA_STAFF_REMOVE')
    OR changes->>'synthetic'='true'
    OR "actorId" IN (SELECT id FROM "DevelopmentAuditActor")
    OR ("entityType" IN ('STAFF','SECURITY') AND "entityId" IN (SELECT id FROM "DevelopmentAuditActor"))
    OR COALESCE(changes->'accountIds','[]'::jsonb) ?| ARRAY(SELECT id FROM "DevelopmentAuditActor")
    OR "relatedIds" && ARRAY(SELECT id FROM "DevelopmentAuditActor")
  ) IS TRUE
);
