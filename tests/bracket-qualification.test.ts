import { describe, expect, it } from "vitest";
import { bracketQualification } from "../src/lib/bracket-qualification";
import { newTournamentConfiguration as config } from "../src/lib/tournament-config";
import type { EventStage } from "../src/lib/event-presentation-data";

function stage(key: string, count: number, offset = 0): EventStage {
  return {
    key,
    name: key,
    format: "LEAGUE",
    qualificationBestOf: null,
    rankingsFinalized: true,
    standings: Array.from({ length: count }, (_, i) => ({
      code: `P${offset + i + 1}`,
      rank: i + 1,
      played: 6,
      wins: 3,
      draws: 0,
      losses: 3,
      points: 9,
    })),
    rounds: [],
  };
}

describe("qualification routes into the SOLO bracket", () => {
  it("keeps live and tied standings out of confirmed qualifier slots", () => {
    const league = stage("league", 32);
    league.rankingsFinalized = false;
    league.standings[0].rank = null;
    const result = bracketQualification(config, [
      league,
      stage("qualification", 8, 4),
    ]);
    expect(result.league?.standings).toHaveLength(32);
    expect(result.direct).toEqual([]);
    expect(result.pool).toEqual([]);
    expect(result.playoff).toEqual([]);
    expect(result.origins.size).toBe(0);
  });

  it("uses saved ranks rather than array order, and records each qualifying route", () => {
    const league = stage("league", 32);
    league.standings.reverse();
    const qualification = stage("qualification", 8, 4);
    qualification.standings.reverse();
    const result = bracketQualification(config, [league, qualification]);
    expect(result.direct.map((r) => r?.code)).toEqual(["P1", "P2", "P3", "P4"]);
    expect(result.pool.map((r) => r?.code)).toEqual([
      "P5",
      "P6",
      "P7",
      "P8",
      "P9",
      "P10",
      "P11",
      "P12",
    ]);
    expect(result.playoff.map((r) => r?.code)).toEqual([
      "P5",
      "P6",
      "P7",
      "P8",
    ]);
    expect(result.origins.get("P1")).toEqual({ stage: "league", rank: 1 });
    expect(result.origins.get("P5")).toEqual({
      stage: "qualification",
      rank: 1,
    });
    expect(result.origins.has("P9")).toBe(false);
  });

  it("shows the finalized league pool while qualification is still pending", () => {
    const result = bracketQualification(config, [stage("league", 32)]);
    expect(result.direct).toHaveLength(4);
    expect(result.pool).toHaveLength(8);
    expect(result.playoff).toEqual([]);
  });

  it.each(["league", "qualification"])(
    "withdraws qualifiers when %s rankings become stale",
    (key) => {
      const stages = [stage("league", 32), stage("qualification", 8, 4)];
      stages.find((s) => s.key === key)!.rankingsStale = true;
      const result = bracketQualification(config, stages);
      expect(result.playoff).toEqual([]);
      expect(result.direct).toHaveLength(key === "league" ? 0 : 4);
    },
  );

  it("supports direct-only tournaments and an unavailable league", () => {
    const directOnly = {
      ...config,
      directSlots: 8,
      playoffSlots: 0,
      playoffEntrants: 0,
    };
    expect(
      bracketQualification(directOnly, [stage("league", 32)]).direct,
    ).toHaveLength(8);
    expect(bracketQualification(directOnly).origins.size).toBe(0);
  });
});
