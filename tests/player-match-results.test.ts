import { describe, expect, it } from "vitest";
import { playerMatchResults } from "../src/lib/player-match-results";
import type {
  EventMatch,
  EventStage,
} from "../src/lib/event-presentation-data";

const match: EventMatch = {
  id: "match-1",
  order: 1,
  a: "P01 · Alpha",
  b: "P02 · Beta",
  bestOf: 3,
  status: "FINALIZED",
  scheduledAt: null,
  result: {
    outcome: "A_WIN",
    games: [
      { number: 1, scoreA: 20, scoreB: 10 },
      { number: 2, scoreA: 18, scoreB: 8 },
    ],
  },
};
function stage(matches: EventMatch[], key = "league", round = 1): EventStage {
  return {
    key,
    name: key,
    format: "LEAGUE",
    qualificationBestOf: null,
    standings: [],
    rounds: [{ number: round, name: `Round ${round}`, matches }],
  };
}

describe("player match results", () => {
  it("shows only the selected player and orients scores to that player's side", () => {
    const stages = [
      stage([
        match,
        { ...match, id: "other", a: "P03 · Gamma", b: "P04 · Delta" },
      ]),
    ];
    expect(playerMatchResults(stages, "P01")).toHaveLength(1);
    expect(playerMatchResults(stages, "P01")[0]).toMatchObject({
      opponent: "P02 · Beta",
      outcome: "win",
      wins: 2,
      losses: 0,
      points: 3,
    });
    expect(playerMatchResults(stages, "P02")[0]).toMatchObject({
      opponent: "P01 · Alpha",
      outcome: "loss",
      wins: 0,
      losses: 2,
      points: 0,
      games: [
        { number: 1, scoreFor: 10, scoreAgainst: 20 },
        { number: 2, scoreFor: 8, scoreAgainst: 18 },
      ],
    });
    expect(
      playerMatchResults(
        [stage([{ ...match, a: "P010 · Different player" }])],
        "P01",
      ),
    ).toEqual([]);
  });

  it("handles draws and forfeits without fabricating game scores", () => {
    const draw = {
      ...match,
      result: {
        outcome: "DRAW",
        games: [match.result!.games[0], { number: 2, scoreA: 9, scoreB: 15 }],
      },
    };
    expect(playerMatchResults([stage([draw])], "P02")[0]).toMatchObject({
      outcome: "draw",
      wins: 1,
      losses: 1,
      points: 1,
    });
    const forfeit = { ...match, result: { outcome: "A_FORFEIT", games: [] } };
    expect(playerMatchResults([stage([forfeit])], "P02")[0]).toMatchObject({
      outcome: "win",
      points: 3,
      forfeit: true,
      games: [],
    });
    expect(playerMatchResults([stage([forfeit])], "P01")[0]).toMatchObject({
      outcome: "loss",
      points: 0,
      forfeit: true,
      games: [],
    });
  });

  it.each(["SCHEDULED", "RESULT_SUBMITTED", "DISPUTED", "VOIDED", "BYE"])(
    "does not show scores or award points for %s matches",
    (status) => {
      expect(
        playerMatchResults([stage([{ ...match, status }])], "P01")[0],
      ).toMatchObject({ status, outcome: null, games: [], points: null });
    },
  );

  it("orders all stages and rounds and awards league points only", () => {
    const league = stage([{ ...match, id: "round-6" }], "league", 6);
    league.rounds.push(stage([match]).rounds[0]);
    const stages = [
      stage([{ ...match, id: "knockout" }], "knockout"),
      league,
      stage([{ ...match, id: "qualification" }], "qualification"),
    ];
    const results = playerMatchResults(stages, "P01");
    expect(results.map((r) => r.id)).toEqual([
      "match-1",
      "round-6",
      "qualification",
      "knockout",
    ]);
    expect(results.map((r) => r.points)).toEqual([3, 3, null, null]);
  });
});
