export type ScoreDraft = { scoreA: string; scoreB: string };

export type GameWinner = "A" | "B";
type GameScore = { scoreA: number; scoreB: number };
export type WinnerDraft = { winner: GameWinner | null; original?: GameScore };

export function winnerDrafts(
  games: GameScore[],
  bestOf: number,
): WinnerDraft[] {
  return Array.from({ length: bestOf }, (_, index) => {
    const original = games[index];
    return {
      winner: original
        ? original.scoreA > original.scoreB
          ? "A"
          : original.scoreB > original.scoreA
            ? "B"
            : null
        : null,
      original,
    };
  });
}

export function readGameWinners(drafts: WinnerDraft[], bestOf: number) {
  // The existing result API stores game wins in scoreA/scoreB. New picks use
  // 1/0 win markers; unchanged historical games retain their recorded scores.
  return readScoreEntry(
    drafts.map(({ winner, original }) => {
      if (!winner) return { scoreA: "", scoreB: "" };
      const unchanged =
        original &&
        (winner === "A"
          ? original.scoreA > original.scoreB
          : original.scoreB > original.scoreA);
      const game = unchanged
        ? original
        : { scoreA: winner === "A" ? 1 : 0, scoreB: winner === "B" ? 1 : 0 };
      return { scoreA: String(game.scoreA), scoreB: String(game.scoreB) };
    }),
    bestOf,
  );
}

export function selectGameWinner(
  drafts: WinnerDraft[],
  index: number,
  winner: GameWinner | null,
  bestOf: number,
): WinnerDraft[] {
  const needed = Math.floor(bestOf / 2) + 1;
  let winsA = 0,
    winsB = 0,
    stopped = false;
  return drafts.map((draft, i) => {
    const next = i === index ? { ...draft, winner } : draft;
    if (stopped) return { winner: null };
    if (next.winner === "A") winsA++;
    if (next.winner === "B") winsB++;
    stopped = !next.winner || winsA === needed || winsB === needed;
    return next;
  });
}

export function readScoreEntry(drafts: ScoreDraft[], bestOf: number) {
  if (bestOf !== 3 && bestOf !== 5)
    throw new Error("This match needs a best-of-three or best-of-five format.");
  const needed = Math.floor(bestOf / 2) + 1;
  const games: { scoreA: number; scoreB: number }[] = [];
  let winsA = 0,
    winsB = 0,
    blank = false;
  for (const [index, draft] of drafts.entries()) {
    const a = draft.scoreA.trim(),
      b = draft.scoreB.trim();
    if (!a && !b) {
      blank = true;
      continue;
    }
    if (blank)
      throw new Error(
        `Enter Game ${games.length + 1} before Game ${index + 1}.`,
      );
    if (!a || !b)
      throw new Error(`Enter both players’ scores for Game ${index + 1}.`);
    const scoreA = Number(a),
      scoreB = Number(b);
    if (
      ![scoreA, scoreB].every(
        (score) => Number.isInteger(score) && score >= 0 && score <= 100000,
      )
    )
      throw new Error(
        `Game ${index + 1} scores must be whole numbers from 0 to 100,000.`,
      );
    if (winsA === needed || winsB === needed)
      throw new Error(
        `The series is already won. Remove Game ${index + 1} and any later games.`,
      );
    if (games.length === bestOf)
      throw new Error(`This series allows at most ${bestOf} games.`);
    if (scoreA === scoreB)
      throw new Error(`Game ${index + 1} is tied. Each game needs a winner.`);
    games.push({ scoreA, scoreB });
    if (scoreA > scoreB) winsA++;
    else winsB++;
  }
  return {
    games,
    winsA,
    winsB,
    needed,
    outcome:
      winsA === needed
        ? ("A_WIN" as const)
        : winsB === needed
          ? ("B_WIN" as const)
          : null,
  };
}
