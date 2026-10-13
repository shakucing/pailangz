-- Profile answers remain inside the existing encrypted member record. No
-- plaintext contact columns or broader table permissions are introduced.
CREATE FUNCTION app_lock_participation_identity(member_id text, canonical_ign text, verified_record text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  PERFORM m.id FROM "Member" m JOIN "MemberPrivate" p ON p."memberId"=m.id
    WHERE m.id=member_id AND m."canonicalIgn"=canonical_ign AND m.verified AND NOT m.archived
      AND p."registrationEncrypted"=verified_record FOR UPDATE OF m,p;
  RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION app_lock_participation_identity(text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_lock_participation_identity(text,text,text) TO pailangz_app;

CREATE FUNCTION app_complete_participation_profile(
  member_id text, verified_record text, completed_record text,
  phone_changed boolean, completed_phone text, phone_last_four text, phone_issue text,
  changed_fields text[], audit_id text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF completed_record IS NULL OR completed_record='' OR audit_id IS NULL
     OR changed_fields IS NULL OR cardinality(changed_fields)=0
     OR NOT changed_fields <@ ARRAY['gmcId','email','whatsapp','discordName','discordId']::text[]
     OR phone_changed IS DISTINCT FROM ('whatsapp'=ANY(changed_fields)) THEN
    RAISE EXCEPTION 'Invalid profile completion';
  END IF;
  PERFORM m.id FROM "Member" m JOIN "MemberPrivate" p ON p."memberId"=m.id
    WHERE m.id=member_id AND m.verified AND NOT m.archived
      AND p."registrationEncrypted"=verified_record FOR UPDATE OF m,p;
  IF NOT FOUND THEN RAISE EXCEPTION 'Stale profile verification'; END IF;
  UPDATE "MemberPrivate" p SET
    "registrationEncrypted"=completed_record,
    "phoneEncrypted"=CASE WHEN phone_changed THEN completed_phone ELSE p."phoneEncrypted" END,
    "phoneLastFour"=CASE WHEN phone_changed THEN phone_last_four ELSE p."phoneLastFour" END,
    "phoneIssue"=CASE WHEN phone_changed THEN phone_issue ELSE p."phoneIssue" END
    WHERE p."memberId"=member_id;
  INSERT INTO "AuditEvent" (id,"actorRole",action,"entityType","entityId","correlationId",source,changes)
    VALUES(audit_id,'PUBLIC','PARTICIPATION_PROFILE_COMPLETE','MEMBER',member_id,audit_id,'PARTICIPATION_FORM',
      jsonb_build_object('fields',to_jsonb(changed_fields)));
END $$;
REVOKE ALL ON FUNCTION app_complete_participation_profile(text,text,text,boolean,text,text,text,text[],text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_complete_participation_profile(text,text,text,boolean,text,text,text,text[],text) TO pailangz_app;
