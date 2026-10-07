export type ScoreDraft = { scoreA: string; scoreB: string };

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
