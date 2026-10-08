-- Expose only availability for the individually shared registration link.
-- Use the same lifecycle and distinct player pool as app_submit_participation;
-- private applications and member records remain inaccessible to anonymous users.
CREATE FUNCTION app_participation_status() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT COALESCE((
    SELECT CASE WHEN (
      SELECT count(*) FROM (
        SELECT p."memberId" FROM "ParticipationRequest" p WHERE p."tournamentId"=t.id
        UNION SELECT p."memberId" FROM "Participant" p WHERE p."tournamentId"=t.id
      ) players
    ) >= LEAST(32,c.capacity) THEN 'FULL' ELSE 'OPEN' END
    FROM "Tournament" t
    JOIN "IntegrationSetting" s ON s.key='officialSeedTournament' AND t.id=s.value #>> '{}'
    JOIN "Category" c ON c."tournamentId"=t.id AND c.kind='SOLO'
    WHERE t.slug='pailangz-solo-team' AND NOT t.published
      AND t.status IN ('DRAFT','REGISTRATION_OPEN')
      AND (t."registrationDeadline" IS NULL OR t."registrationDeadline">now())
      AND EXISTS(SELECT FROM "Category" team WHERE team."tournamentId"=t.id AND team.kind='TEAM')
  ), 'CLOSED')
$$;
REVOKE ALL ON FUNCTION app_participation_status() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_participation_status() TO pailangz_app;
