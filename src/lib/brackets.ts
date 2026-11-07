import type { Tx } from "./db";
import {
  knockoutBestOf,
  knockoutRoundNames,
  thirdPlaceBestOf,
  THIRD_PLACE_ROUND,
  type ScheduledPair,
  type TournamentConfiguration,
} from "./tournament-config";
export async function persistBracket(
  tx: Tx,
  stageId: string,
  size: number,
  pairs: ScheduledPair[],
  kind: "SOLO" | "TEAM",
  config: TournamentConfiguration,
  snapshotIds: string[] = [],
) {
  const names = knockoutRoundNames(size);
  let byes = 0;
  for (const [r, name] of names.entries()) {
    const round = await tx.round.create({
      data: { stageId, number: r + 1, name },
    });
    for (let i = 0; i < size / 2 ** (r + 1); i++) {
      const pair = r === 0 ? pairs[i] : undefined;
      if (pair && pair.b === null) byes++;
      const match = await tx.match.create({
        data: {
          roundId: round.id,
          order: i + 1,
          sideKind: kind === "TEAM" ? "TEAM" : "PARTICIPANT",
          sideAId: pair?.a,
          sideBId: pair?.b,
          bestOf: knockoutBestOf(config, kind, r === names.length - 1),
          status: pair && pair.b === null ? "BYE" : "SCHEDULED",
        },
      });
      if (r === 0)
        for (const snapshotId of snapshotIds)
          await tx.bracketDependency.create({
            data: { snapshotId, matchId: match.id },
          });
    }
  }
  const hasThirdPlace =
    pairs.reduce((count, pair) => count + (pair.b ? 2 : 1), 0) >= 4;
  if (hasThirdPlace) {
    const round = await tx.round.create({
      data: { stageId, number: names.length + 1, name: THIRD_PLACE_ROUND },
    });
    await tx.match.create({
      data: {
        roundId: round.id,
        order: 1,
        sideKind: kind === "TEAM" ? "TEAM" : "PARTICIPANT",
        bestOf: thirdPlaceBestOf(config, kind),
        status: "SCHEDULED",
      },
    });
  }
  return { matches: size - 1 + Number(hasThirdPlace), byes };
}
