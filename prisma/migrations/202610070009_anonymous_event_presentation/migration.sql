-- Permanent, category-local public codes. Archived teams retain their codes.
BEGIN;
ALTER TABLE "Team" ADD COLUMN code text NOT NULL DEFAULT 'AUTO';
WITH numbered AS (
  SELECT id, row_number() OVER (PARTITION BY "categoryId" ORDER BY id) AS n FROM "Team"
)
UPDATE "Team" t SET code = 'T' || lpad(n.n::text, greatest(2, length(n.n::text)), '0')
FROM numbered n WHERE n.id = t.id;
CREATE UNIQUE INDEX "Team_categoryId_code_key" ON "Team"("categoryId", code);
ALTER TABLE "Team" ADD CONSTRAINT team_code_format CHECK (code ~ '^T[0-9]{2,}$');

CREATE FUNCTION assign_team_code() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE next_number integer;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.code IS DISTINCT FROM OLD.code THEN RAISE EXCEPTION 'Team public codes are permanent'; END IF;
  ELSIF NEW.code = 'AUTO' THEN
    -- Serialize allocation in the category, including archived records.
    PERFORM 1 FROM "Category" WHERE id = NEW."categoryId" FOR UPDATE;
    SELECT coalesce(max(substring(code FROM 2)::integer), 0) + 1 INTO next_number
      FROM "Team" WHERE "categoryId" = NEW."categoryId";
    NEW.code := 'T' || lpad(next_number::text, greatest(2, length(next_number::text)), '0');
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER team_public_code BEFORE INSERT OR UPDATE ON "Team"
  FOR EACH ROW EXECUTE FUNCTION assign_team_code();

-- The explicitly requested landing preview exposes only anonymous codes and
-- prepared fixtures for the original event. Other private drafts stay hidden.
-- Team names are public; member names, IDs, private answers and draft results are excluded.
CREATE VIEW "PublicEventPreview" AS
SELECT jsonb_build_object(
  'name', t.name, 'slug', t.slug, 'status', t.status, 'configuration', t.configuration,
  'participants', coalesce((
    SELECT jsonb_agg(jsonb_build_object('code', p.code) ORDER BY p.code)
    FROM "Participant" p WHERE p."tournamentId" = t.id
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
  AND t.id = (SELECT value #>> '{}' FROM "IntegrationSetting" WHERE key = 'officialSeedTournament');
GRANT SELECT ON "PublicEventPreview" TO pailangz_app;
COMMIT;
