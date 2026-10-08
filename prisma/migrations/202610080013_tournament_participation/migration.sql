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
