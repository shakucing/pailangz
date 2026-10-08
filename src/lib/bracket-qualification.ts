import type { EventStage } from "./event-presentation-data";
import type { TournamentConfiguration } from "./tournament-config";

type Standing = EventStage["standings"][number];

// Live standings can show a rank without having a staff-approved snapshot.
// A qualification snapshot also depends on the current league snapshot.
export function bracketQualification(
  config: TournamentConfiguration,
  stages: EventStage[] = [],
) {
  const league = stages.find((s) => s.key === "league");
  const qualification = stages.find((s) => s.key === "qualification");
  const leagueFinal = Boolean(
    league?.rankingsFinalized && !league.rankingsStale,
  );
  const qualificationFinal = Boolean(
    leagueFinal &&
    qualification?.rankingsFinalized &&
    !qualification.rankingsStale,
  );
  const ranked = (
    stage: EventStage | undefined,
    start: number,
    count: number,
  ) =>
    Array.from({ length: count }, (_, i) =>
      stage?.standings.find((r) => r.rank === start + i),
    );
  const direct = leagueFinal ? ranked(league, 1, config.directSlots) : [];
  const pool = leagueFinal
    ? ranked(league, config.directSlots + 1, config.playoffEntrants)
    : [];
  const playoff = qualificationFinal
    ? ranked(qualification, 1, config.playoffSlots)
    : [];
  const origins = new Map<
    string,
    { stage: "league" | "qualification"; rank: number }
  >();
  const record = (
    rows: (Standing | undefined)[],
    stage: "league" | "qualification",
  ) => {
    for (const row of rows)
      if (row?.rank) origins.set(row.code, { stage, rank: row.rank });
  };
  record(direct, "league");
  record(playoff, "qualification");
  return {
    league,
    qualification,
    leagueFinal,
    qualificationFinal,
    direct,
    pool,
    playoff,
    origins,
  };
}
