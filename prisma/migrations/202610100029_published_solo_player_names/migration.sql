-- Published SOLO events expose their approved entrants' codes and display
-- names. Keep the original event's existing preview; other drafts stay private.
CREATE OR REPLACE VIEW "PublicEventPlayerName" AS
SELECT t.slug, p.code, m."displayIgn" AS ign
FROM "Tournament" t
JOIN "Participant" p ON p."tournamentId" = t.id
JOIN "Member" m ON m.id = p."memberId"
WHERE NOT p.withdrawn AND t.status <> 'ARCHIVED' AND NOT m.archived
  AND (
    t.id = (SELECT value #>> '{}' FROM "IntegrationSetting" WHERE key = 'officialSeedTournament')
    OR (
      t.published AND t.status <> 'DRAFT' AND p.eligible AND m.verified
      AND EXISTS (
        SELECT FROM "Category" c WHERE c."tournamentId" = t.id AND c.kind = 'SOLO'
      )
    )
  );
