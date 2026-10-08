import { describe, expect, it } from "vitest";
import {
  bracketMatchLabel,
  bracketPlacings,
  officialBracket,
  previewBracket,
  resolveBracket,
  selectBracketWinner,
  type BracketPicks,
  type BracketRound,
} from "../src/lib/interactive-bracket";
import {
  newTournamentConfiguration,
  originalConfiguration,
} from "../src/lib/tournament-config";

function pickFirstSides(rounds: BracketRound[]) {
  let picks: BracketPicks = {};
  for (const round of rounds)
    for (const match of round.matches) {
      const current = resolveBracket(rounds, picks, "picks")
        .flatMap((r) => r.matches)
        .find((m) => m.id === match.id)!;
      if (current.a && current.b)
        picks = selectBracketWinner(rounds, picks, match.id, current.a.id);
    }
  return picks;
}

describe("interactive tournament bracket", () => {
  it("reproduces the supplied 16-team pairings and all winner paths", () => {
    const rounds = previewBracket(originalConfiguration, "TEAM");
    expect(rounds[0].matches.map((m) => [m.a?.seed, m.b?.seed])).toEqual([
      [1, 16],
      [8, 9],
      [4, 13],
      [5, 12],
      [2, 15],
      [7, 10],
      [3, 14],
      [6, 11],
    ]);
    expect(
      rounds.map((round) =>
        round.matches.map((m) => bracketMatchLabel(round.size, m.order)),
      ),
    ).toEqual([
      [
        "BO16-1",
        "BO16-2",
        "BO16-3",
        "BO16-4",
        "BO16-5",
        "BO16-6",
        "BO16-7",
        "BO16-8",
      ],
      ["QF1", "QF2", "QF3", "QF4"],
      ["SF1", "SF2"],
      ["FINAL"],
    ]);
    const picks = pickFirstSides(rounds);
    const resolved = resolveBracket(rounds, picks, "picks");
    expect(resolved[1].matches.map((m) => [m.a?.seed, m.b?.seed])).toEqual([
      [1, 8],
      [4, 5],
      [2, 7],
      [3, 6],
    ]);
    expect(resolved[2].matches.map((m) => [m.a?.seed, m.b?.seed])).toEqual([
      [1, 4],
      [2, 3],
    ]);
    expect(resolved[3].matches.map((m) => [m.a?.seed, m.b?.seed])).toEqual([
      [1, 2],
    ]);
    const { champion, runnerUp } = bracketPlacings(resolved);
    expect([champion?.seed, runnerUp?.seed]).toEqual([1, 2]);
    expect(Object.keys(picks)).toHaveLength(15);
  });

  it("clears only the changed winner's descendants, including the final", () => {
    const rounds = previewBracket(originalConfiguration, "TEAM");
    const original = pickFirstSides(rounds);
    const next = selectBracketWinner(rounds, original, "TEAM-16-1", "seed-16");
    expect(next["TEAM-16-1"]).toBe("seed-16");
    for (const id of ["TEAM-8-1", "TEAM-4-1", "TEAM-2-1"])
      expect(next[id]).toBeUndefined();
    for (const id of ["TEAM-8-2", "TEAM-8-3", "TEAM-8-4", "TEAM-4-2"])
      expect(next[id]).toBe(original[id]);
    const resolved = resolveBracket(rounds, next, "picks");
    expect(resolved[1].matches[0].a?.seed).toBe(16);
    expect(resolved[2].matches[0].a).toBeNull();
    expect(bracketPlacings(resolved)).toEqual({
      champion: null,
      runnerUp: null,
    });
    expect(original["TEAM-2-1"]).toBe("seed-1");
  });

  it("supports undoing a winner and rejects unavailable or unrelated entrants", () => {
    const rounds = previewBracket(originalConfiguration, "TEAM");
    const picks = pickFirstSides(rounds);
    const next = selectBracketWinner(rounds, picks, "TEAM-16-1", "seed-1");
    expect(next["TEAM-16-1"]).toBeUndefined();
    expect(next["TEAM-8-1"]).toBeUndefined();
    expect(selectBracketWinner(rounds, {}, "TEAM-8-1", "seed-1")).toEqual({});
    expect(selectBracketWinner(rounds, {}, "TEAM-16-1", "seed-2")).toEqual({});
    expect(selectBracketWinner(rounds, picks, "missing", "seed-1")).toBe(picks);
    const invalid = resolveBracket(
      rounds,
      { "TEAM-16-1": "seed-2", "TEAM-2-1": "seed-2" },
      "picks",
    );
    expect(invalid[0].matches[0].winner).toBeNull();
    expect(bracketPlacings(invalid).champion).toBeNull();
  });

  it("honors configurable bracket sizes, series formats and explicit seeded byes", () => {
    const config = {
      ...newTournamentConfiguration,
      teamCapacity: 6,
      bracketByePolicy: "seeded_top" as const,
    };
    const rounds = previewBracket(config, "TEAM");
    expect(rounds.map((r) => [r.size, r.matches[0].bestOf])).toEqual([
      [8, 3],
      [4, 3],
      [2, 5],
    ]);
    expect(
      resolveBracket(rounds, {}, "picks")[0]
        .matches.filter((m) => m.winner)
        .map((m) => m.winner?.seed),
    ).toEqual([1, 2]);
    const picks = pickFirstSides(rounds);
    expect(Object.keys(picks)).toHaveLength(5);
    expect(
      bracketPlacings(resolveBracket(rounds, picks, "picks")).champion?.seed,
    ).toBe(1);
    expect(
      previewBracket(originalConfiguration, "SOLO").every((r) =>
        r.matches.every((m) => m.bestOf === 5),
      ),
    ).toBe(true);
  });

  it("shows only finalized official winners and interprets forfeits correctly", () => {
    const match = (
      id: string,
      order: number,
      status: string,
      outcome: string,
      a: string | null = "T01 · Alpha",
      b: string | null = "T02 · Beta",
    ) => ({
      id,
      order,
      status,
      a,
      b,
      bestOf: 3,
      scheduledAt: null,
      result: { outcome, games: [] },
    });
    const rounds = officialBracket([
      {
        number: 2,
        matches: [
          match(
            "final",
            1,
            "SCHEDULED",
            "A_WIN",
            "Awaiting entrant",
            "Menunggu peserta",
          ),
        ],
      },
      {
        number: 1,
        matches: [
          match("two", 2, "FINALIZED", "B_FORFEIT"),
          match("one", 1, "FINALIZED", "A_FORFEIT"),
        ],
      },
    ]);
    const resolved = resolveBracket(rounds, {}, "official");
    expect(resolved[0].matches.map((m) => m.winner?.label)).toEqual([
      "T02 · Beta",
      "T01 · Alpha",
    ]);
    expect(resolved[1].matches[0].a).toBeNull();
    expect(bracketPlacings(resolved).champion).toBeNull();
    for (const status of [
      "SCHEDULED",
      "RESULT_SUBMITTED",
      "DISPUTED",
      "VOIDED",
    ])
      expect(
        resolveBracket(
          officialBracket([
            { number: 1, matches: [match("one", 1, status, "A_WIN")] },
          ]),
          {},
          "official",
        )[0].matches[0].winner,
      ).toBeNull();
    for (const [outcome, winner] of [
      ["A_WIN", "T01 · Alpha"],
      ["B_WIN", "T02 · Beta"],
      ["DRAW", undefined],
    ] as const)
      expect(
        resolveBracket(
          officialBracket([
            { number: 1, matches: [match("one", 1, "FINALIZED", outcome)] },
          ]),
          {},
          "official",
        )[0].matches[0].winner?.label,
      ).toBe(winner);
    expect(
      resolveBracket(
        officialBracket([
          {
            number: 1,
            matches: [match("bye", 1, "BYE", "A_WIN", "T01 · Alpha", "BYE")],
          },
        ]),
        {},
        "official",
      )[0].matches[0].winner?.label,
    ).toBe("T01 · Alpha");
  });

  it("keeps personal predictions independent from official results", () => {
    const rounds = previewBracket(newTournamentConfiguration, "TEAM");
    rounds[0].matches[0].status = "FINALIZED";
    rounds[0].matches[0].result = { outcome: "A_WIN", games: [] };
    const picks = selectBracketWinner(
      rounds,
      {},
      rounds[0].matches[0].id,
      rounds[0].matches[0].b!.id,
    );
    expect(
      resolveBracket(rounds, picks, "official")[0].matches[0].winner?.seed,
    ).toBe(1);
    expect(
      resolveBracket(rounds, picks, "picks")[0].matches[0].winner?.seed,
    ).toBe(8);
    expect(rounds[0].matches[0].result.outcome).toBe("A_WIN");
  });
});
