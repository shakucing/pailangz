import type { EventStage } from "./event-presentation-data";

export function playerMatchResults(stages: EventStage[], playerCode: string) {
  const stageOrder = ["league", "qualification", "knockout"];
  return [...stages]
    .sort((a, b) => stageOrder.indexOf(a.key) - stageOrder.indexOf(b.key))
    .flatMap((stage) =>
      [...stage.rounds]
        .sort((a, b) => a.number - b.number)
        .flatMap((round) =>
          [...round.matches]
            .sort((a, b) => a.order - b.order)
            .flatMap((match) => {
              const sideA = match.a?.split(" · ")[0] === playerCode;
              const sideB = match.b?.split(" · ")[0] === playerCode;
              if (!sideA && !sideB) return [];
              const result = match.status === "FINALIZED" ? match.result : null;
              const won =
                result &&
                (sideA
                  ? ["A_WIN", "B_FORFEIT"].includes(result.outcome)
                  : ["B_WIN", "A_FORFEIT"].includes(result.outcome));
              const lost =
                result &&
                (sideA
                  ? ["B_WIN", "A_FORFEIT"].includes(result.outcome)
                  : ["A_WIN", "B_FORFEIT"].includes(result.outcome));
              const outcome = won
                ? "win"
                : lost
                  ? "loss"
                  : result?.outcome === "DRAW"
                    ? "draw"
                    : null;
              const games = (result?.games ?? []).map((g) => ({
                number: g.number,
                scoreFor: sideA ? g.scoreA : g.scoreB,
                scoreAgainst: sideA ? g.scoreB : g.scoreA,
              }));
              return [
                {
                  id: match.id,
                  stageKey: stage.key,
                  round: round.number,
                  roundName: round.name,
                  opponent: sideA ? match.b : match.a,
                  status: match.status,
                  outcome,
                  forfeit: result?.outcome.includes("FORFEIT") ?? false,
                  games,
                  wins: games.filter((g) => g.scoreFor > g.scoreAgainst).length,
                  losses: games.filter((g) => g.scoreFor < g.scoreAgainst)
                    .length,
                  points:
                    ["league", "qualification"].includes(stage.key) && outcome
                      ? won
                        ? 3
                        : lost
                          ? 0
                          : 1
                      : null,
                },
              ];
            }),
        ),
    );
}

export function playerMatchResultSections(
  stages: EventStage[],
  playerCode: string,
) {
  const carry = stages.find(
    (s) => s.key === "qualification",
  )?.qualificationCarry;
  const matches = playerMatchResults(stages, playerCode);
  const sections = new Map<
    string,
    { key: string; stageKeys: string[]; matches: typeof matches }
  >();
  for (const match of matches) {
    const combined =
      carry === true && ["league", "qualification"].includes(match.stageKey);
    const key = combined ? "league-qualification" : match.stageKey;
    let section = sections.get(key);
    if (!section) {
      section = {
        key,
        stageKeys: combined ? ["league", "qualification"] : [match.stageKey],
        matches: [],
      };
      sections.set(key, section);
    }
    section.matches.push(match);
  }
  return [...sections.values()].map((section) => {
    const completed = section.matches.filter((match) => match.outcome);
    return {
      ...section,
      summary: {
        played: completed.length,
        wins: completed.filter((match) => match.outcome === "win").length,
        draws: completed.filter((match) => match.outcome === "draw").length,
        losses: completed.filter((match) => match.outcome === "loss").length,
        // Count each match once; qualification standings may already include
        // the carried league points.
        points: section.stageKeys.some((key) =>
          ["league", "qualification"].includes(key),
        )
          ? completed.reduce((total, match) => total + (match.points ?? 0), 0)
          : null,
      },
    };
  });
}
