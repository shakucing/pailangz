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
                    stage.key === "league" && outcome
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
