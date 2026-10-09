import { describe, it, expect } from "vitest";
import {
  configuration,
  generateLeague,
  validateLeague,
  knockoutRoundNames,
  seededBracketPairs,
  newTournamentConfiguration,
  originalConfiguration,
} from "../src/lib/tournament-config";
const ids = (n: number) =>
  Array.from({ length: n }, (_, i) => `player-${i + 1}`);
describe("configurable schedules and brackets", () => {
  it("keeps the previous series lengths for configurations saved before this setting", () => {
    const legacy = { ...newTournamentConfiguration } as Record<string, unknown>;
    for (const key of [
      "leagueBestOf",
      "soloKnockoutBestOf",
      "soloFinalBestOf",
      "teamKnockoutBestOf",
      "teamFinalBestOf",
    ])
      delete legacy[key];
    expect(configuration(legacy)).toEqual(newTournamentConfiguration);
  });
  it.each([
    "leagueBestOf",
    "soloKnockoutBestOf",
    "soloFinalBestOf",
    "teamKnockoutBestOf",
    "teamFinalBestOf",
  ])(
    "accepts odd %s lengths and rejects even, fractional and out-of-range values",
    (key) => {
      for (const n of [1, 3, 5, 7, 9, 99])
        expect(
          configuration({ ...newTournamentConfiguration, [key]: n }),
        ).toHaveProperty(key, n);
      for (const n of [0, -1, 2, 6, 7.5, 101])
        expect(() =>
          configuration({ ...newTournamentConfiguration, [key]: n }),
        ).toThrow(/odd number/);
    },
  );
  it("generates 96 distinct series for 32 players over six rounds", () => {
    const players = ids(32),
      rounds = generateLeague(players, newTournamentConfiguration);
    expect(rounds.every((r) => r.length === 16)).toBe(true);
    expect(validateLeague(players, rounds, newTournamentConfiguration)).toEqual(
      { matches: 96, rounds: 6, byes: 0 },
    );
  });
  it("does not reuse the original supplied schedule for new sizes", () => {
    expect(() =>
      validateLeague(
        ids(32),
        generateLeague(ids(64), originalConfiguration),
        newTournamentConfiguration,
      ),
    ).toThrow();
  });
  it("generates rounds for multiple even capacities", () => {
    for (const n of [2, 4, 8, 16, 48, 128, 256]) {
      const config = configuration({
        ...newTournamentConfiguration,
        soloCapacity: n,
        leagueRounds: Math.min(6, n - 1),
        leagueMatchesPerPlayer: Math.min(6, n - 1),
        directSlots: 2,
        playoffSlots: 0,
        playoffEntrants: 0,
        soloBracketSize: 2,
      });
      expect(
        validateLeague(ids(n), generateLeague(ids(n), config), config).matches,
      ).toBe((n * config.leagueMatchesPerPlayer) / 2);
    }
  });
  it("rejects impossible non-repeating opponents and match quotas", () => {
    expect(() =>
      configuration({
        ...newTournamentConfiguration,
        leagueMatchesPerPlayer: 32,
        leagueRounds: 32,
      }),
    ).toThrow(/Non-repeating/);
    expect(() =>
      configuration({ ...newTournamentConfiguration, leagueRounds: 5 }),
    ).toThrow(/one match/);
  });
  it("rejects duplicates or missing entrants and repeated pairs", () => {
    expect(() =>
      generateLeague([...ids(31), "player-1"], newTournamentConfiguration),
    ).toThrow();
    const rounds = generateLeague(ids(32), newTournamentConfiguration);
    rounds[1] = rounds[0];
    expect(() =>
      validateLeague(ids(32), rounds, newTournamentConfiguration),
    ).toThrow(/Repeated/);
    expect(() => generateLeague(ids(31), newTournamentConfiguration)).toThrow();
  });
  it("requires an explicit policy for odd counts", () => {
    expect(() =>
      configuration({
        ...newTournamentConfiguration,
        soloCapacity: 33,
        leagueRounds: 33,
        leagueMatchesPerPlayer: 32,
      }),
    ).toThrow(/Odd/);
  });
  it("balances odd-count byes without inventing played matches", () => {
    const config = configuration({
      ...newTournamentConfiguration,
      soloCapacity: 5,
      leagueRounds: 5,
      leagueMatchesPerPlayer: 4,
      leagueByePolicy: "rotating_no_points",
      directSlots: 4,
      playoffSlots: 0,
      playoffEntrants: 0,
      soloBracketSize: 4,
    });
    expect(
      validateLeague(ids(5), generateLeague(ids(5), config), config),
    ).toEqual({ matches: 10, rounds: 5, byes: 5 });
    expect(() =>
      configuration({ ...config, leagueRounds: 3, leagueMatchesPerPlayer: 2 }),
    ).toThrow(/complete cycle/);
  });
  it("validates qualification slots and incomplete bracket policies", () => {
    expect(() =>
      configuration({ ...newTournamentConfiguration, directSlots: 5 }),
    ).toThrow(/slots/);
    expect(() =>
      configuration({
        ...newTournamentConfiguration,
        format: "TEAM",
        teamCapacity: 6,
      }),
    ).toThrow(/explicit/);
    expect(() =>
      configuration({ ...newTournamentConfiguration, soloBracketSize: 12 }),
    ).toThrow(/power/);
    expect(() =>
      configuration({
        ...newTournamentConfiguration,
        playoffEntrants: 3,
        playoffSlots: 2,
        qualificationMatchesPerPlayer: 1,
        directSlots: 4,
        bracketByePolicy: "seeded_top",
      }),
    ).toThrow(/impossible/);
  });
  it("starts an eight-team bracket at quarterfinals", () => {
    expect(knockoutRoundNames(8)).toEqual([
      "Quarterfinals",
      "Semifinals",
      "Final",
    ]);
    expect(knockoutRoundNames(32)[0]).toBe("Round of 32");
  });
  it("assigns incomplete bracket byes to explicit top seeds", () => {
    const players = ids(6),
      pairs = seededBracketPairs(players, 8, "seeded_top");
    expect(
      pairs
        .filter((p) => p.b === null)
        .map((p) => p.a)
        .sort(),
    ).toEqual(players.slice(0, 2));
    expect(pairs.flatMap((p) => (p.b ? [p.a, p.b] : [p.a])).sort()).toEqual(
      players.sort(),
    );
    expect(() => seededBracketPairs(players, 8, "none")).toThrow(/explicit/);
    expect(() => seededBracketPairs(ids(3), 8, "seeded_top")).toThrow(
      /Too few/,
    );
  });
});

describe("independent tournament formats", () => {
  it("does not require TEAM bracket policies for SOLO", () => {
    expect(
      configuration({ ...newTournamentConfiguration, teamCapacity: 6 }).format,
    ).toBe("SOLO");
  });
  it("does not require a valid SOLO league or qualification route for TEAM", () => {
    expect(
      configuration({
        ...newTournamentConfiguration,
        format: "TEAM",
        soloCapacity: 3,
        leagueRounds: 6,
        directSlots: 100,
      }).format,
    ).toBe("TEAM");
  });
  it("rejects unknown formats", () => {
    expect(() =>
      configuration({ ...newTournamentConfiguration, format: "MIXED" }),
    ).toThrow();
  });
});
