import { describe, expect, it } from "vitest";
import {
  originalConfiguration,
  newTournamentConfiguration,
  configuration,
} from "../src/lib/tournament-config";
import {
  progressionRounds,
  qualificationRange,
  configuredByes,
} from "../src/lib/tournament-presentation";

describe("tournament presentation follows configuration", () => {
  it("shows the original league qualification range and BO5 SOLO progression", () => {
    expect(qualificationRange(originalConfiguration)).toEqual({
      from: 9,
      to: 24,
    });
    expect(
      progressionRounds(originalConfiguration, "SOLO").map((r) => [
        r.size,
        r.bestOf,
      ]),
    ).toEqual([
      [16, 5],
      [8, 5],
      [4, 5],
      [2, 5],
    ]);
  });
  it("starts eight teams at quarterfinals and uses BO5 only in the final", () => {
    expect(
      progressionRounds(newTournamentConfiguration, "TEAM").map((r) => [
        r.size,
        r.bestOf,
        r.matches,
      ]),
    ).toEqual([
      [8, 3, 4],
      [4, 3, 2],
      [2, 5, 1],
    ]);
    expect(qualificationRange(newTournamentConfiguration)).toEqual({
      from: 5,
      to: 12,
    });
  });
  it("omits the playoff range when every qualifier enters directly", () => {
    const c = configuration({
      ...newTournamentConfiguration,
      directSlots: 8,
      playoffSlots: 0,
      playoffEntrants: 0,
    });
    expect(qualificationRange(c)).toBeNull();
    expect(configuredByes(c, "SOLO")).toBe(0);
  });
  it("starts the playoff range at rank one when there are no direct slots", () => {
    const c = configuration({
      ...newTournamentConfiguration,
      directSlots: 0,
      playoffSlots: 8,
    });
    expect(qualificationRange(c)).toEqual({ from: 1, to: 8 });
  });
  it("reports configured byes without creating extra entrants or played results", () => {
    const c = configuration({
      ...newTournamentConfiguration,
      directSlots: 2,
      teamCapacity: 6,
      bracketByePolicy: "seeded_top",
    });
    expect(configuredByes(c, "SOLO")).toBe(2);
    expect(configuredByes(c, "TEAM")).toBe(2);
    expect(progressionRounds(c, "SOLO")[0].size).toBe(8);
  });
});
