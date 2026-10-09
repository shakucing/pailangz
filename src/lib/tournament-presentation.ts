import {
  knockoutBestOf,
  type TournamentConfiguration,
} from "./tournament-config";

export type ProgressionRound = {
  key: string;
  size: number;
  bestOf: number;
  matches: number;
};

// Both diagrams describe the approved configuration, not live advancement.
export function progressionRounds(
  config: TournamentConfiguration,
  category: "SOLO" | "TEAM",
): ProgressionRound[] {
  const size =
    category === "SOLO" ? config.soloBracketSize : config.teamBracketSize;
  const rounds: ProgressionRound[] = [];
  for (let n = size; n >= 2; n /= 2)
    rounds.push({
      key: `${category}-${n}`,
      size: n,
      bestOf: knockoutBestOf(config, category, n === 2),
      matches: n / 2,
    });
  return rounds;
}

export function qualificationRange(config: TournamentConfiguration) {
  return config.playoffEntrants
    ? {
        from: config.directSlots + 1,
        to: config.directSlots + config.playoffEntrants,
      }
    : null;
}

export function configuredByes(
  config: TournamentConfiguration,
  category: "SOLO" | "TEAM",
) {
  return category === "SOLO"
    ? config.soloBracketSize - config.directSlots - config.playoffSlots
    : config.teamBracketSize - config.teamCapacity;
}
