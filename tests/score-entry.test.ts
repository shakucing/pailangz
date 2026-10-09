import { describe, expect, it } from "vitest";
import {
  readScoreEntry,
  readGameWinners,
  selectGameWinner,
  winnerDrafts,
  type GameWinner,
} from "../src/lib/score-entry";
import { validateSeries } from "../src/lib/domain";
const win = { scoreA: "3", scoreB: "0" };
const loss = { scoreA: "0", scoreB: "3" };
const blank = { scoreA: "", scoreB: "" };
const rules = { seriesPoints: true, drawPolicy: "no_draws" };
const confirmed = ["seriesPoints", "drawPolicy"];
describe("staff game winner selection", () => {
  function picks(winners: GameWinner[], bestOf = 3) {
    return winners.reduce(
      (drafts, winner, index) =>
        selectGameWinner(drafts, index, winner, bestOf),
      winnerDrafts([], bestOf),
    );
  }
  it("starts with no result and derives either BO3 winner from game picks", () => {
    expect(readGameWinners(winnerDrafts([], 3), 3)).toMatchObject({
      games: [],
      outcome: null,
    });
    expect(readGameWinners(picks(["A", "B"]), 3).outcome).toBeNull();
    for (const [winners, outcome] of [
      [["A", "B", "A"], "A_WIN"],
      [["B", "B"], "B_WIN"],
    ] as const) {
      const entry = readGameWinners(picks([...winners]), 3);
      expect(entry.outcome).toBe(outcome);
      expect(() =>
        validateSeries(3, entry.games, outcome, rules, confirmed),
      ).not.toThrow();
    }
  });
  it("requires three wins in BO5 and allows a five-game series", () => {
    expect(readGameWinners(picks(["A", "A"], 5), 5).outcome).toBeNull();
    const entry = readGameWinners(picks(["A", "B", "B", "A", "B"], 5), 5);
    expect(entry).toMatchObject({ winsA: 2, winsB: 3, outcome: "B_WIN" });
    expect(
      validateSeries(5, entry.games, entry.outcome!, rules, confirmed),
    ).toEqual({ a: 2, b: 3 });
  });
  it("removes later games when a correction decides the series earlier", () => {
    const corrected = selectGameWinner(picks(["A", "B", "A"]), 1, "A", 3);
    expect(corrected.map((draft) => draft.winner)).toEqual(["A", "A", null]);
    expect(readGameWinners(corrected, 3).games).toHaveLength(2);
    const reopened = selectGameWinner(corrected, 0, "B", 3);
    expect(readGameWinners(reopened, 3).outcome).toBeNull();
    expect(
      readGameWinners(selectGameWinner(reopened, 2, "B", 3), 3).outcome,
    ).toBe("B_WIN");
  });
  it("supports BO7, including corrections that end the series at four wins", () => {
    const drafts = picks(["A", "B", "A", "B", "A", "B", "B"], 7);
    expect(readGameWinners(drafts, 7)).toMatchObject({
      winsA: 3,
      winsB: 4,
      needed: 4,
      outcome: "B_WIN",
    });
    expect(readGameWinners(drafts.slice(0, 6), 7).outcome).toBeNull();
    const corrected = selectGameWinner(drafts, 3, "A", 7);
    expect(corrected.map((draft) => draft.winner)).toEqual([
      "A",
      "B",
      "A",
      "A",
      "A",
      null,
      null,
    ]);
    expect(readGameWinners(corrected, 7)).toMatchObject({
      winsA: 4,
      winsB: 1,
      outcome: "A_WIN",
    });
  });
  it("clears the selected game and later games and prevents gaps", () => {
    const cleared = selectGameWinner(picks(["A", "B", "A"]), 1, null, 3);
    expect(cleared.map((draft) => draft.winner)).toEqual(["A", null, null]);
    expect(readGameWinners(cleared, 3)).toMatchObject({
      winsA: 1,
      winsB: 0,
      outcome: null,
    });
    expect(
      selectGameWinner(winnerDrafts([], 3), 1, "A", 3).every(
        (draft) => !draft.winner,
      ),
    ).toBe(true);
  });
  it("preserves historical scores for unchanged picks while storing new picks as win markers", () => {
    const games = [
      { scoreA: 20, scoreB: 8 },
      { scoreA: 18, scoreB: 9 },
    ];
    const drafts = winnerDrafts(games, 3);
    expect(drafts.map((draft) => draft.winner)).toEqual(["A", "A", null]);
    expect(readGameWinners(drafts, 3).games).toEqual(games);
    expect(
      readGameWinners(selectGameWinner(drafts, 1, "B", 3), 3).games,
    ).toEqual([games[0], { scoreA: 0, scoreB: 1 }]);
  });
  it("supports partial games before configured draws and forfeits", () => {
    const entry = readGameWinners(picks(["A", "B"]), 3);
    expect(
      validateSeries(
        3,
        entry.games,
        "DRAW",
        { ...rules, drawPolicy: "moderated_draw" },
        confirmed,
      ),
    ).toEqual({ a: 1, b: 1 });
    expect(
      validateSeries(
        3,
        entry.games,
        "A_FORFEIT",
        { ...rules, specialOutcomes: "forfeit" },
        [...confirmed, "specialOutcomes"],
      ),
    ).toEqual({ a: 1, b: 1 });
  });
});
describe("staff score entry", () => {
  it.each([0, 2, 6, -1, 7.5, 101])(
    "rejects invalid series length %s",
    (bestOf) => {
      expect(() => readScoreEntry([], bestOf)).toThrow(/odd number/);
    },
  );
  it("keeps blank scores distinct from zero and omits unused trailing games", () => {
    expect(readScoreEntry([blank, blank], 3).games).toEqual([]);
    const entry = readScoreEntry([win, win, blank], 3);
    expect(entry.games).toEqual([
      { scoreA: 3, scoreB: 0 },
      { scoreA: 3, scoreB: 0 },
    ]);
    expect(entry.outcome).toBe("A_WIN");
    expect(
      validateSeries(3, entry.games, entry.outcome!, rules, confirmed),
    ).toEqual({ a: 2, b: 0 });
  });
  it("derives either winner for a deciding BO3 game", () => {
    expect(readScoreEntry([win, loss], 3).outcome).toBeNull();
    for (const [decider, outcome] of [
      [win, "A_WIN"],
      [loss, "B_WIN"],
    ] as const) {
      const entry = readScoreEntry([win, loss, decider], 3);
      expect(entry.outcome).toBe(outcome);
      expect(() =>
        validateSeries(3, entry.games, outcome, rules, confirmed),
      ).not.toThrow();
    }
  });
  it("requires three wins in BO5 and permits all five games", () => {
    expect(readScoreEntry([win, win], 5).outcome).toBeNull();
    const entry = readScoreEntry([loss, win, loss, win, loss], 5);
    expect(entry).toMatchObject({
      winsA: 2,
      winsB: 3,
      outcome: "B_WIN",
      needed: 3,
    });
    expect(
      validateSeries(5, entry.games, entry.outcome!, rules, confirmed),
    ).toEqual({ a: 2, b: 3 });
  });
  it("identifies missing pairs and gaps by game number", () => {
    expect(() => readScoreEntry([{ scoreA: "0", scoreB: "" }], 3)).toThrow(
      /both players.*Game 1/,
    );
    expect(() => readScoreEntry([blank, win], 3)).toThrow(
      /Game 1 before Game 2/,
    );
  });
  it("rejects ties, decimals, negative and excessive scores", () => {
    for (const score of ["-1", "1.5", "100001", "Infinity", "oops"])
      expect(() => readScoreEntry([{ scoreA: score, scoreB: "0" }], 3)).toThrow(
        /whole numbers/,
      );
    expect(() => readScoreEntry([{ scoreA: "0", scoreB: "0" }], 3)).toThrow(
      /Game 1 is tied/,
    );
  });
  it("prevents entered games after the series is decided", () => {
    expect(() => readScoreEntry([win, win, loss], 3)).toThrow(/Remove Game 3/);
    expect(() => readScoreEntry([loss, loss, loss, win], 5)).toThrow(
      /Remove Game 4/,
    );
  });
});
