-- Expose only the confirmed carry-forward choice in safe schedule previews.
-- Preserve preview eligibility and keep unpublished results hidden.
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
          'qualificationCarry', CASE WHEN s.key = 'qualification' AND 'qualificationCarry' = ANY(s."confirmedRules")
            THEN s.rules->'qualificationCarry' ELSE NULL END,
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
