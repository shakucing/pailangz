import { describe, expect, it } from "vitest";
import { generateQualificationPairs } from "../src/lib/qualification-pairing";

const players = (size: number) =>
  Array.from({ length: size }, (_, i) => `player-${i + 1}`);

describe("automatic playoff opponents", () => {
  it("balances every feasible even and odd pool without repeat opponents", () => {
    for (let size = 2; size <= 32; size++) {
      const ids = players(size);
      for (let quota = 1; quota < size; quota++) {
        if ((size * quota) % 2) continue;
        const pairs = generateQualificationPairs(ids, quota);
        expect(pairs).toHaveLength((size * quota) / 2);
        expect(
          new Set(pairs.map((pair) => [...pair].sort().join(":"))).size,
        ).toBe(pairs.length);
        expect(
          pairs.every(
            ([a, b]) => a !== b && ids.includes(a) && ids.includes(b),
          ),
        ).toBe(true);
        const counts = new Map(ids.map((id) => [id, 0]));
        for (const pair of pairs)
          for (const id of pair) counts.set(id, counts.get(id)! + 1);
        expect([...counts.values()].every((count) => count === quota)).toBe(
          true,
        );
      }
    }
  });

  it("uses the supplied ranking consistently for an eight-player, two-match playoff", () => {
    const ids = players(8);
    const pairs = generateQualificationPairs(ids, 2);
    expect(pairs.slice(0, 4)).toEqual([
      [ids[0], ids[7]],
      [ids[1], ids[6]],
      [ids[2], ids[5]],
      [ids[3], ids[4]],
    ]);
    expect(generateQualificationPairs(ids, 2)).toEqual(pairs);
    expect(generateQualificationPairs([...ids].reverse(), 2)).not.toEqual(
      pairs,
    );
  });

  it("supports the maximum configured playoff pool and match quota", () => {
    const pairs = generateQualificationPairs(players(256), 255);
    expect(pairs).toHaveLength(32640);
    expect(new Set(pairs.map((pair) => [...pair].sort().join(":"))).size).toBe(
      pairs.length,
    );
  });

  it("rejects incomplete pools, duplicate entrants and impossible quotas", () => {
    for (const [ids, quota] of [
      [[], 1],
      [["a"], 1],
      [["a", "a"], 1],
      [players(3), 1],
      [players(4), 4],
      [players(4), 0],
      [players(4), 1.5],
    ] as [string[], number][])
      expect(() => generateQualificationPairs(ids, quota)).toThrow(
        /Auto assignment/,
      );
  });
});
