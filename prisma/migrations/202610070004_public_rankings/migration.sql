-- This owner-executed view exposes only public competition statistics, never
-- staff identity, snapshot reasons, or registration data. Latest stale snapshots
-- are retained so the public interface can explicitly mark rankings provisional.
CREATE VIEW "PublicRanking" AS
SELECT r."stageId", r.stale, r.rankings
FROM "RankingSnapshot" r
JOIN "Stage" s ON s.id=r."stageId"
JOIN "Category" c ON c.id=s."categoryId"
JOIN "Tournament" t ON t.id=c."tournamentId"
WHERE t.published AND t.status NOT IN ('DRAFT','ARCHIVED') AND s.published
AND r.version=(SELECT max(r2.version) FROM "RankingSnapshot" r2 WHERE r2."stageId"=r."stageId");
GRANT SELECT ON "PublicRanking" TO pailangz_app;
