-- Only the display family name is public; registration answers stay encrypted.
ALTER TABLE "Member" ADD COLUMN "publicFamilyName" text;

CREATE OR REPLACE VIEW "PublicEventPlayerName" AS
SELECT t.slug, p.code, m."displayIgn" AS ign,
  CASE WHEN m."isMember" THEN 'Pailangz'
    ELSE COALESCE(NULLIF(btrim(m."publicFamilyName"), ''), 'Null')
  END AS "familyLabel"
FROM "Tournament" t
JOIN "Participant" p ON p."tournamentId" = t.id
JOIN "Member" m ON m.id = p."memberId"
WHERE NOT p.withdrawn AND t.status <> 'ARCHIVED'
  AND (
    t.id = (SELECT value #>> '{}' FROM "IntegrationSetting" WHERE key = 'officialSeedTournament')
    OR (
      t.published AND t.status <> 'DRAFT' AND p.eligible AND m.verified
      AND EXISTS (
        SELECT FROM "Category" c WHERE c."tournamentId" = t.id AND c.kind = 'SOLO'
      )
    )
  );
