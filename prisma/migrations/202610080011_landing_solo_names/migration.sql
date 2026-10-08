-- The user approved displaying the original event's SOLO in-game names on
-- the landing page. Expose only this roster's codes and display names; other
-- tournaments, team memberships and private registration fields stay hidden.
BEGIN;
CREATE VIEW "PublicEventPlayerName" AS
SELECT t.slug, p.code, m."displayIgn" AS ign
FROM "Tournament" t
JOIN "Participant" p ON p."tournamentId" = t.id
JOIN "Member" m ON m.id = p."memberId"
WHERE t.status <> 'ARCHIVED' AND NOT m.archived
  AND t.id = (SELECT value #>> '{}' FROM "IntegrationSetting" WHERE key = 'officialSeedTournament');
GRANT SELECT ON "PublicEventPlayerName" TO pailangz_app;
COMMIT;
