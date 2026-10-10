type StageDisplayInput = {
  key: string;
  format: string;
  rankingsFinalized: boolean;
  rounds: {
    number: number;
    matches: {
      status: string;
      currentResult: { status: string; outcome: string } | null;
      dependencies: { id: string }[];
    }[];
  }[];
};

export type StageDisplayStatus = "Completed" | "Current stage" | "Upcoming";

// Apply independently to each category: SOLO and TEAM progress separately.
export function tournamentStageCards<T extends StageDisplayInput>(stages: T[]) {
  const order = ["league", "qualification", "knockout"];
  let currentFound = false;
  return [...stages]
    .sort(
      (a, b) =>
        (order.includes(a.key) ? order.indexOf(a.key) : order.length) -
        (order.includes(b.key) ? order.indexOf(b.key) : order.length),
    )
    .map((stage) => {
      const matches = stage.rounds.flatMap((round) => round.matches);
      const final = [...stage.rounds].sort((a, b) => b.number - a.number)[0];
      const completed =
        !matches.some((match) => match.dependencies.length > 0) &&
        (stage.format === "LEAGUE"
          ? stage.rankingsFinalized
          : matches.length > 0 &&
            matches.every(
              (match) =>
                match.status === "BYE" ||
                (match.status === "FINALIZED" &&
                  match.currentResult?.status === "ACCEPTED"),
            ) &&
            final?.matches.length === 1 &&
            final.matches[0].status === "FINALIZED" &&
            ["A_WIN", "B_WIN", "A_FORFEIT", "B_FORFEIT"].includes(
              final.matches[0].currentResult?.outcome ?? "",
            ));
      const displayStatus: StageDisplayStatus = completed
        ? "Completed"
        : currentFound
          ? "Upcoming"
          : "Current stage";
      if (!completed) currentFound = true;
      return { ...stage, displayStatus };
    });
}
