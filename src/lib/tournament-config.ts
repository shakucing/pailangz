import { z } from "zod";
import { DomainError } from "./domain";
const count = z.number().int().min(2).max(256);
const bracket = count.refine(
  (n) => (n & (n - 1)) === 0,
  "Bracket size must be a power of two.",
);
export const configurationSchema = z
  .object({
    soloCapacity: count,
    teamCapacity: count,
    leagueRounds: z.number().int().min(1).max(256),
    leagueMatchesPerPlayer: z.number().int().min(1).max(255),
    soloBracketSize: bracket,
    teamBracketSize: bracket,
    directSlots: z.number().int().min(0).max(256),
    playoffSlots: z.number().int().min(0).max(256),
    playoffEntrants: z.number().int().min(0).max(256),
    qualificationMatchesPerPlayer: z.number().int().min(1).max(255),
    leagueByePolicy: z.enum(["none", "rotating_no_points"]),
    bracketByePolicy: z.enum(["none", "seeded_top"]),
    scheduleSource: z.enum(["generated", "supplied"]).default("generated"),
  })
  .strict()
  .superRefine((c, ctx) => {
    const issue = (message: string) =>
      ctx.addIssue({ code: "custom", message });
    if (c.directSlots + c.playoffEntrants > c.soloCapacity)
      issue("Direct players and the playoff pool exceed SOLO capacity.");
    if (
      c.playoffSlots > c.playoffEntrants ||
      (c.playoffSlots === 0) !== (c.playoffEntrants === 0)
    )
      issue("Playoff winners and pool sizes do not fit.");
    const entrants = c.directSlots + c.playoffSlots;
    if (entrants < 2 || entrants > c.soloBracketSize)
      issue("Qualification slots must fit the SOLO bracket.");
    if (
      c.soloBracketSize > 2 * entrants ||
      c.teamBracketSize > 2 * c.teamCapacity
    )
      issue(
        "Bracket size leaves empty first-round pairs; choose a smaller bracket.",
      );
    if (c.teamCapacity > c.teamBracketSize)
      issue("TEAM entrants exceed the TEAM bracket size.");
    if (
      (entrants < c.soloBracketSize || c.teamCapacity < c.teamBracketSize) &&
      c.bracketByePolicy === "none"
    )
      issue(
        "An explicit seeded bye policy is required for incomplete brackets.",
      );
    if (c.leagueMatchesPerPlayer >= c.soloCapacity)
      issue("Non-repeating league opponents are not possible.");
    if (c.soloCapacity % 2 === 0) {
      if (c.leagueRounds !== c.leagueMatchesPerPlayer)
        issue("Even-sized leagues require one match per player per round.");
    } else {
      if (c.leagueByePolicy !== "rotating_no_points")
        issue("Odd player counts require an explicit rotating bye policy.");
      if (
        c.leagueRounds !== c.soloCapacity ||
        c.leagueMatchesPerPlayer !== c.soloCapacity - 1
      )
        issue(
          "The balanced odd-count generator requires a complete cycle: N rounds, N−1 matches per player, one bye each.",
        );
    }
    if (
      c.playoffEntrants &&
      (c.qualificationMatchesPerPlayer >= c.playoffEntrants ||
        (c.playoffEntrants * c.qualificationMatchesPerPlayer) % 2)
    )
      issue(
        "Non-repeating, equal-match qualification pairings are impossible.",
      );
  });
export type TournamentConfiguration = z.infer<typeof configurationSchema>;
export const newTournamentConfiguration: TournamentConfiguration = {
  soloCapacity: 32,
  teamCapacity: 8,
  leagueRounds: 6,
  leagueMatchesPerPlayer: 6,
  soloBracketSize: 8,
  teamBracketSize: 8,
  directSlots: 4,
  playoffSlots: 4,
  playoffEntrants: 8,
  qualificationMatchesPerPlayer: 2,
  leagueByePolicy: "none",
  bracketByePolicy: "none",
  scheduleSource: "generated",
};
export const originalConfiguration: TournamentConfiguration = {
  soloCapacity: 64,
  teamCapacity: 16,
  leagueRounds: 6,
  leagueMatchesPerPlayer: 6,
  soloBracketSize: 16,
  teamBracketSize: 16,
  directSlots: 8,
  playoffSlots: 8,
  playoffEntrants: 16,
  qualificationMatchesPerPlayer: 2,
  leagueByePolicy: "none",
  bracketByePolicy: "none",
  scheduleSource: "supplied",
};
export function configuration(value: unknown) {
  const parsed = configurationSchema.safeParse(value);
  if (!parsed.success)
    throw new DomainError(
      parsed.error.issues.map((issue) => issue.message).join(" "),
    );
  return parsed.data;
}
export type ScheduledPair = { a: string; b: string | null };
export function generateLeague(
  ids: string[],
  config: TournamentConfiguration,
): ScheduledPair[][] {
  configurationSchema.parse(config);
  if (ids.length !== config.soloCapacity || new Set(ids).size !== ids.length)
    throw new DomainError(
      "Fill all configured SOLO slots with distinct entrants first.",
    );
  const ring: (string | null)[] = [...ids];
  if (ring.length % 2) ring.push(null);
  const rounds: ScheduledPair[][] = [];
  for (let r = 0; r < config.leagueRounds; r++) {
    const pairs: ScheduledPair[] = [];
    for (let i = 0; i < ring.length / 2; i++) {
      const a = ring[i],
        b = ring[ring.length - 1 - i];
      if (a === null) pairs.push({ a: b!, b: null });
      else pairs.push({ a, b });
    }
    rounds.push(pairs);
    ring.splice(1, 0, ring.pop()!);
  }
  validateLeague(ids, rounds, config);
  return rounds;
}
export function validateLeague(
  ids: string[],
  rounds: ScheduledPair[][],
  config: TournamentConfiguration,
) {
  configurationSchema.parse(config);
  if (
    ids.length !== config.soloCapacity ||
    new Set(ids).size !== ids.length ||
    rounds.length !== config.leagueRounds
  )
    throw new DomainError(
      "Schedule size does not match the tournament configuration.",
    );
  const counts = new Map(ids.map((id) => [id, 0])),
    byes = new Map(ids.map((id) => [id, 0])),
    seen = new Set<string>();
  for (const pairs of rounds) {
    const present = new Set<string>();
    for (const { a, b } of pairs) {
      if (
        !counts.has(a) ||
        present.has(a) ||
        a === b ||
        (b !== null && (!counts.has(b) || present.has(b)))
      )
        throw new DomainError(
          "Unknown, repeated or self-matched entrant in a round.",
        );
      present.add(a);
      if (b === null) {
        if (config.leagueByePolicy !== "rotating_no_points")
          throw new DomainError("Bye policy is not configured.");
        byes.set(a, byes.get(a)! + 1);
      } else {
        present.add(b);
        const key = [a, b].sort().join(":");
        if (seen.has(key)) throw new DomainError("Repeated league opponent.");
        seen.add(key);
        counts.set(a, counts.get(a)! + 1);
        counts.set(b, counts.get(b)! + 1);
      }
    }
    if (present.size !== ids.length)
      throw new DomainError(
        "Every entrant must be scheduled or explicitly receive a bye in each round.",
      );
  }
  if ([...counts.values()].some((n) => n !== config.leagueMatchesPerPlayer))
    throw new DomainError(
      "Schedule does not satisfy configured matches per player.",
    );
  if (config.soloCapacity % 2 && [...byes.values()].some((n) => n !== 1))
    throw new DomainError("Odd-count byes must rotate equally.");
  return {
    matches: seen.size,
    rounds: rounds.length,
    byes: [...byes.values()].reduce((a, b) => a + b, 0),
  };
}
export function knockoutRoundNames(size: number) {
  if (size < 2 || size & (size - 1))
    throw new DomainError("Choose a power-of-two bracket size.");
  const names: string[] = [];
  for (let n = size; n >= 2; n /= 2)
    names.push(
      n === 2
        ? "Final"
        : n === 4
          ? "Semifinals"
          : n === 8
            ? "Quarterfinals"
            : `Round of ${n}`,
    );
  return names;
}
export function seededBracketPairs(
  ids: string[],
  size: number,
  byePolicy: string,
): ScheduledPair[] {
  knockoutRoundNames(size);
  if (ids.length < 2 || ids.length > size || new Set(ids).size !== ids.length)
    throw new DomainError("Supply distinct entrants within bracket capacity.");
  if (ids.length < size && byePolicy !== "seeded_top")
    throw new DomainError("An explicit seeded bye policy is required.");
  let order = [1, 2];
  for (let n = 4; n <= size; n *= 2)
    order = order.flatMap((s) => [s, n + 1 - s]);
  const pairs: ScheduledPair[] = [];
  for (let i = 0; i < order.length; i += 2) {
    const a = ids[order[i] - 1],
      b = ids[order[i + 1] - 1];
    if (!a && !b)
      throw new DomainError(
        "Too few entrants for this bracket; select a smaller bracket.",
      );
    pairs.push({ a: a ?? b, b: a ? (b ?? null) : null });
  }
  return pairs;
}
