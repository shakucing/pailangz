-- Only the small, re-encoded 64px avatar is stored; originals are discarded.
ALTER TABLE "Team" ADD COLUMN "avatarImage" text;
ALTER TABLE "Team" ADD CONSTRAINT team_avatar_image CHECK (
  "avatarImage" IS NULL OR (
    length("avatarImage") <= 32768 AND
    "avatarImage" ~ '^data:image/webp;base64,[A-Za-z0-9+/]+={0,2}$'
  )
);
CREATE OR REPLACE VIEW "PublicTeamDirectory" AS
  SELECT e.slug AS "tournamentSlug",team.slug,team.name,team.code,
    EXISTS(SELECT FROM "Member" m JOIN "Participant" p ON p."memberId"=m.id AND p."tournamentId"=t.id AND p.eligible
      JOIN "TeamMembership" tm ON tm."memberId"=m.id AND tm."teamId"=team.id AND tm.active
      WHERE m.id=team."ownerId" AND m.verified AND NOT m.archived) AS "acceptsApplications",
    (SELECT m."displayIgn" FROM "Member" m WHERE m.id=team."ownerId" AND m.verified AND NOT m.archived) AS "ownerIgn",
    (SELECT count(*)::int FROM "TeamMembership" tm WHERE tm."teamId"=team.id AND tm.active) AS "playerCount",
    COALESCE((SELECT jsonb_agg(jsonb_build_object('ign',m."displayIgn",'owner',m.id=team."ownerId") ORDER BY (m.id=team."ownerId") DESC,m."displayIgn")
      FROM "TeamMembership" tm JOIN "Member" m ON m.id=tm."memberId"
      JOIN "Participant" p ON p."memberId"=m.id AND p."tournamentId"=t.id AND p.eligible
      WHERE tm."teamId"=team.id AND tm.active AND m.verified AND NOT m.archived),'[]'::jsonb) AS roster, team."avatarImage"
  FROM "PublicTeamEvent" e JOIN "Tournament" t ON t.slug=e.slug
  JOIN "Category" c ON c."tournamentId"=t.id AND c.kind='TEAM'
  JOIN "Team" team ON team."categoryId"=c.id AND NOT team.archived;

CREATE FUNCTION app_team_create_with_avatar(token_hash text,event_slug text,team_slug text,team_name text,entity_id text,audit_id text,avatar_image text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE result jsonb;
BEGIN
  IF avatar_image IS NOT NULL AND (length(avatar_image)>32768 OR avatar_image !~ '^data:image/webp;base64,[A-Za-z0-9+/]+={0,2}$')
    THEN RETURN jsonb_build_object('error','INVALID_IMAGE'); END IF;
  -- Reuse the existing approval, owner, roster and capacity checks. Saving the
  -- avatar and creating the team share one transaction, including its audit.
  result:=app_team_action(token_hash,event_slug,'CREATE',team_slug,team_name,'',entity_id,audit_id);
  IF result ? 'error' THEN RETURN result; END IF;
  UPDATE "Team" SET "avatarImage"=avatar_image WHERE id=entity_id;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION app_team_create_with_avatar(text,text,text,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_team_create_with_avatar(text,text,text,text,text,text,text) TO pailangz_app;
