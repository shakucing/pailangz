import { describe, expect, it } from "vitest";
import { readScoreEntry } from "../src/lib/score-entry";
import { validateSeries } from "../src/lib/domain";
const win = { scoreA: "3", scoreB: "0" };
const loss = { scoreA: "0", scoreB: "3" };
const blank = { scoreA: "", scoreB: "" };
const rules = { seriesPoints: true, drawPolicy: "no_draws" };
const confirmed = ["seriesPoints", "drawPolicy"];
describe("staff score entry", () => {
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
