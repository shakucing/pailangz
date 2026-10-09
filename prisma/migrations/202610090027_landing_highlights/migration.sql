-- At most two staff-managed slots. No tournament is highlighted implicitly.
CREATE TABLE "LandingHighlight" (
  format text PRIMARY KEY CHECK (format IN ('SOLO', 'TEAM')),
  "tournamentId" text UNIQUE REFERENCES "Tournament"(id) ON DELETE SET NULL ON UPDATE CASCADE
);
ALTER TABLE "LandingHighlight" ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON "LandingHighlight" TO pailangz_app;
CREATE POLICY staff_highlight_select ON "LandingHighlight" FOR SELECT TO pailangz_app
  USING ((SELECT app_staff_allowed()));
CREATE POLICY staff_highlight_insert ON "LandingHighlight" FOR INSERT TO pailangz_app
  WITH CHECK ((SELECT app_staff_allowed()));
CREATE POLICY staff_highlight_update ON "LandingHighlight" FOR UPDATE TO pailangz_app
  USING ((SELECT app_staff_allowed())) WITH CHECK ((SELECT app_staff_allowed()));

CREATE FUNCTION app_validate_landing_highlight() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
  IF NEW."tournamentId" IS NOT NULL AND NOT EXISTS (
    SELECT FROM "Tournament" t WHERE t.id=NEW."tournamentId"
      AND t.configuration->>'format'=NEW.format AND t.status<>'ARCHIVED'
  ) THEN
    RAISE EXCEPTION 'Choose a non-archived tournament matching the highlight format'
      USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER landing_highlight_format BEFORE INSERT OR UPDATE ON "LandingHighlight"
  FOR EACH ROW EXECUTE FUNCTION app_validate_landing_highlight();

-- Anonymous callers receive only the chosen format and slug, including an
-- explicitly selected draft's safe schedule preview. Archives fail closed.
CREATE VIEW "PublicLandingHighlight" AS
SELECT h.format, t.slug FROM "LandingHighlight" h
JOIN "Tournament" t ON t.id=h."tournamentId"
WHERE t.status<>'ARCHIVED' AND t.configuration->>'format'=h.format;
GRANT SELECT ON "PublicLandingHighlight" TO pailangz_app;

-- Highlighting a draft explicitly enables its existing safe schedule projection.
CREATE OR REPLACE VIEW "PublicEventPreview" AS
SELECT jsonb_build_object(
  'name', t.name, 'slug', t.slug, 'status', t.status, 'configuration', t.configuration,
  'participants', coalesce((
    SELECT jsonb_agg(jsonb_build_object('code', p.code) ORDER BY p.code)
    FROM "Participant" p WHERE p."tournamentId" = t.id AND NOT p.withdrawn
  ), '[]'::jsonb),
  'categories', coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'kind', c.kind,
      'teams', coalesce((
        SELECT jsonb_agg(jsonb_build_object(
          'code', tm.code,
          'name', tm.name,
          'playerCount', (SELECT count(*) FROM "TeamMembership" ms WHERE ms."teamId" = tm.id AND ms.active)
        ) ORDER BY tm.code) FROM "Team" tm WHERE tm."categoryId" = c.id AND NOT tm.archived
      ), '[]'::jsonb),
      'stages', coalesce((
        SELECT jsonb_agg(jsonb_build_object(
          'key', s.key, 'name', s.name, 'format', s.format,
          'qualificationBestOf', CASE WHEN s.key = 'qualification' AND 'qualificationBestOf' = ANY(s."confirmedRules")
            THEN s.rules->'qualificationBestOf' ELSE NULL END,
          'standings', '[]'::jsonb,
          'rounds', coalesce((
            SELECT jsonb_agg(jsonb_build_object(
              'number', r.number, 'name', r.name,
              'matches', coalesce((
                SELECT jsonb_agg(jsonb_build_object(
                  'id', m.id, 'order', m."order", 'bestOf', m."bestOf",
                  'a', CASE WHEN m."sideKind" = 'TEAM' THEN ta.code || ' · ' || ta.name ELSE pa.code END,
                  'b', CASE WHEN m.status = 'BYE' THEN 'BYE' WHEN m."sideKind" = 'TEAM' THEN tb.code || ' · ' || tb.name ELSE pb.code END,
                  'status', CASE WHEN m.status = 'BYE' THEN 'BYE' ELSE 'SCHEDULED' END,
                  'scheduledAt', NULL, 'result', NULL
                ) ORDER BY m."order") FROM "Match" m
                LEFT JOIN "Participant" pa ON pa.id = m."sideAId" AND pa."tournamentId" = t.id
                LEFT JOIN "Participant" pb ON pb.id = m."sideBId" AND pb."tournamentId" = t.id
                LEFT JOIN "Team" ta ON ta.id = m."sideAId" AND ta."categoryId" = c.id
                LEFT JOIN "Team" tb ON tb.id = m."sideBId" AND tb."categoryId" = c.id
                WHERE m."roundId" = r.id
              ), '[]'::jsonb)
            ) ORDER BY r.number) FROM "Round" r WHERE r."stageId" = s.id
          ), '[]'::jsonb)
        ) ORDER BY s.key) FROM "Stage" s WHERE s."categoryId" = c.id AND NOT s.archived
      ), '[]'::jsonb)
    ) ORDER BY c.kind) FROM "Category" c WHERE c."tournamentId" = t.id
  ), '[]'::jsonb)
) AS data
FROM "Tournament" t
WHERE t.status <> 'ARCHIVED'
  AND (t.id IN (
    SELECT value #>> '{}' FROM "IntegrationSetting"
    WHERE key IN ('officialSeedTournament', 'officialTeamTournament')
  ) OR EXISTS (
    SELECT FROM "LandingHighlight" h WHERE h."tournamentId"=t.id
      AND h.format=t.configuration->>'format'
  ));


CREATE OR REPLACE VIEW "PublicEventTeamMember" AS
SELECT t.slug, team.code AS "teamCode", m."displayIgn" AS ign,
  COALESCE(m.id = team."ownerId", false) AS owner
FROM "Tournament" t
JOIN "Category" c ON c."tournamentId" = t.id AND c.kind = 'TEAM'
JOIN "Team" team ON team."categoryId" = c.id AND NOT team.archived
JOIN "TeamMembership" tm ON tm."teamId" = team.id AND tm.active
JOIN "Member" m ON m.id = tm."memberId" AND m.verified AND NOT m.archived
JOIN "Participant" p ON p."tournamentId" = t.id AND p."memberId" = m.id
  AND p.eligible AND NOT p.withdrawn
WHERE t.status <> 'ARCHIVED' AND (
  (t.published AND t.status <> 'DRAFT') OR t.id IN (
    SELECT value #>> '{}' FROM "IntegrationSetting"
    WHERE key IN ('officialSeedTournament', 'officialTeamTournament')
  ) OR EXISTS (
    SELECT FROM "LandingHighlight" h WHERE h."tournamentId"=t.id
      AND h.format=t.configuration->>'format'
  )
);
