-- The event-centre roster exposes only eligible members' public in-game names.
-- Official schedule previews remain available when registration is closed.
CREATE VIEW "PublicEventTeamMember" AS
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
  )
);
GRANT SELECT ON "PublicEventTeamMember" TO pailangz_app;
