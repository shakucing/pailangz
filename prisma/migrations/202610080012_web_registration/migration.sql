-- Narrow anonymous intake. Existing staff-only table policies stay in place.
-- It writes encrypted submissions and fixed provenance; it returns no rows or
-- conflict details and never modifies members, staff, or tournament eligibility.
CREATE FUNCTION app_submit_registration(
  submission_id text, job_id text, display_ign text, canonical_ign text,
  encrypted_payload text, encrypted_phone text, last_four text, phone_issue text,
  conflict_id text, audit_id text
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE existing_member text; pending boolean; conflict_reason text;
BEGIN
  IF submission_id IS NULL OR submission_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    OR job_id IS NULL OR conflict_id IS NULL OR audit_id IS NULL
    OR display_ign IS NULL OR length(btrim(display_ign)) NOT BETWEEN 1 AND 80
    OR canonical_ign IS NULL OR length(btrim(canonical_ign)) NOT BETWEEN 1 AND 240
    OR encrypted_payload IS NULL OR length(encrypted_payload) NOT BETWEEN 30 AND 16000
    OR encrypted_payload !~ '^[^.]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$'
    OR (encrypted_phone IS NOT NULL AND (length(encrypted_phone) NOT BETWEEN 30 AND 1000
      OR encrypted_phone !~ '^[^.]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$'))
    OR (last_four IS NOT NULL AND last_four !~ '^[0-9]{0,4}$')
    OR (phone_issue IS NOT NULL AND phone_issue NOT IN ('MISSING','INVALID_REQUIRES_REVIEW'))
  THEN RAISE EXCEPTION 'Invalid registration'; END IF;

  -- Serialize retries and submissions with the same canonical IGN.
  PERFORM pg_advisory_xact_lock(hashtextextended(submission_id, 12));
  IF EXISTS(SELECT FROM "RegistrationSubmission" WHERE source='WEB_FORM' AND "sourceResponseId"=submission_id) THEN
    RETURN 1;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(canonical_ign, 13));
  SELECT id INTO existing_member FROM "Member" WHERE "canonicalIgn"=canonical_ign;
  SELECT EXISTS(SELECT FROM "RegistrationSubmission" WHERE "canonicalIgn"=canonical_ign
    AND status IN ('PENDING','NEEDS_CLARIFICATION')) INTO pending;

  INSERT INTO "ImportJob" (id,source,"rowCount") VALUES(job_id,'WEB_FORM',1);
  INSERT INTO "RegistrationSubmission" (
    id,source,"sourceResponseId","importJobId","originalIgn","displayIgn","canonicalIgn",
    "payloadEncrypted","phoneEncrypted","phoneLastFour","phoneIssue",status
  ) VALUES (
    submission_id,'WEB_FORM',submission_id,job_id,display_ign,display_ign,canonical_ign,
    encrypted_payload,encrypted_phone,last_four,phone_issue,'PENDING'
  );
  IF existing_member IS NOT NULL OR pending THEN
    conflict_reason := CASE WHEN existing_member IS NOT NULL
      THEN 'Canonical IGN already exists; explicit linking required.'
      ELSE 'Canonical IGN is already in the review inbox; resolve the conflict explicitly.' END;
    INSERT INTO "IgnConflict" (id,"submissionId","existingMemberId",reason)
      VALUES(conflict_id,submission_id,existing_member,conflict_reason);
  END IF;
  INSERT INTO "AuditEvent" (
    id,"actorRole",action,"entityType","entityId","correlationId",source,changes,"relatedIds"
  ) VALUES (
    audit_id,'PUBLIC','REGISTRATION_SUBMIT','SUBMISSION',submission_id,audit_id,'WEB_FORM',
    jsonb_build_object('changedFields',jsonb_build_array('IGN','Whatsapp Number','Tiktok username',
      'Tiktok ID','Discord Name','Discord ID','State/Province','Country'),
      'conflict',existing_member IS NOT NULL OR pending),ARRAY[job_id]
  );
  RETURN 1;
END $$;
REVOKE ALL ON FUNCTION app_submit_registration(text,text,text,text,text,text,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_submit_registration(text,text,text,text,text,text,text,text,text,text) TO pailangz_app;
