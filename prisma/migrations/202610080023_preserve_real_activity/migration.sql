-- Keep system events whose actor is absent, and retain mixed maintenance that
-- also affects real staff. Apply forward: migration 022 was already deployed.
DROP POLICY production_activity_only ON "AuditEvent";
CREATE POLICY production_activity_only ON "AuditEvent" AS RESTRICTIVE
FOR SELECT TO pailangz_app USING (
  (SELECT tier FROM "DeploymentEnvironment" LIMIT 1) <> 'production'
  OR NOT COALESCE((
    source='TEST'
    OR action IN ('QA_ACCOUNT_PROVISION','QA_ACCOUNT_REVOKE','QA_STAFF_REMOVE')
    OR changes->>'synthetic'='true'
    OR "actorId" IN (SELECT id FROM "DevelopmentAuditActor")
    OR ("entityType" IN ('STAFF','SECURITY') AND "entityId" IN (SELECT id FROM "DevelopmentAuditActor"))
    OR (CASE WHEN jsonb_typeof(changes->'accountIds')='array' THEN
      jsonb_array_length(changes->'accountIds') > 0
      AND NOT EXISTS (SELECT FROM jsonb_array_elements_text(changes->'accountIds') AS account(id)
        WHERE account.id NOT IN (SELECT id FROM "DevelopmentAuditActor"))
      ELSE false END)
    OR (cardinality("relatedIds") > 0 AND "relatedIds" <@ ARRAY(SELECT id FROM "DevelopmentAuditActor"))
  ), false)
);
