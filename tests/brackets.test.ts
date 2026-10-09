import { describe, expect, it, vi } from "vitest";
import { persistBracket } from "../src/lib/brackets";
import { newTournamentConfiguration } from "../src/lib/tournament-config";
import type { Tx } from "../src/lib/db";

describe("persisted knockout series lengths", () => {
  it.each(["SOLO", "TEAM"] as const)(
    "stores BO5 rounds and a BO7 %s final",
    async (kind) => {
      const match = { create: vi.fn().mockResolvedValue({ id: "match" }) };
      const tx = {
        round: {
          create: vi
            .fn()
            .mockImplementation(async ({ data }) => ({
              id: `round-${data.number}`,
            })),
        },
        match,
        bracketDependency: { create: vi.fn() },
      };
      const config = {
        ...newTournamentConfiguration,
        soloKnockoutBestOf: 5,
        soloFinalBestOf: 7,
        teamKnockoutBestOf: 5,
        teamFinalBestOf: 7,
      };
      const pairs = Array.from({ length: 4 }, (_, i) => ({
        a: `a-${i}`,
        b: `b-${i}`,
      }));
      await persistBracket(
        tx as unknown as Tx,
        "knockout",
        8,
        pairs,
        kind,
        config,
      );
      expect(
        match.create.mock.calls.map(([input]) => [
          input.data.roundId,
          input.data.bestOf,
        ]),
      ).toEqual([
        ["round-1", 5],
        ["round-1", 5],
        ["round-1", 5],
        ["round-1", 5],
        ["round-2", 5],
        ["round-2", 5],
        ["round-3", 7],
      ]);
    },
  );
  it("uses the final length for a bracket with only a final", async () => {
    const tx = {
      round: { create: vi.fn().mockResolvedValue({ id: "final" }) },
      match: { create: vi.fn().mockResolvedValue({ id: "match" }) },
      bracketDependency: { create: vi.fn() },
    };
    await persistBracket(
      tx as unknown as Tx,
      "knockout",
      2,
      [{ a: "a", b: "b" }],
      "SOLO",
      {
        ...newTournamentConfiguration,
        soloKnockoutBestOf: 5,
        soloFinalBestOf: 7,
      },
    );
    expect(tx.match.create.mock.calls[0][0].data.bestOf).toBe(7);
  });
});
