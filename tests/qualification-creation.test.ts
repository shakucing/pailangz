import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Actor } from "../src/lib/db";
import { createQualification, confirmRules } from "../src/lib/competition";
import { newTournamentConfiguration } from "../src/lib/tournament-config";

const mocks = vi.hoisted(() => ({ privateTx: vi.fn(), audit: vi.fn() }));
vi.mock("../src/lib/db", () => mocks);
vi.mock("../src/lib/configuration", () => ({ createStages: vi.fn() }));

const actor: Actor = {
  id: "staff",
  sessionId: "session",
  role: "MODERATOR",
  authenticatedAt: new Date(),
};
const stage = {
  id: "playoff",
  categoryId: "solo",
  key: "qualification",
  archived: false,
  published: false,
  finalized: false,
  ruleVersion: 1,
  rules: { qualificationPairing: "auto", qualificationBestOf: 3 },
  confirmedRules: [
    "qualificationBestOf",
    "qualificationPairing",
    "qualificationCarry",
  ],
};
const tx = {
  stage: {
    findUniqueOrThrow: vi.fn(),
    findFirstOrThrow: vi.fn(),
    update: vi.fn(),
  },
  rankingSnapshot: { findFirst: vi.fn() },
  category: { findUniqueOrThrow: vi.fn() },
  round: { count: vi.fn(), create: vi.fn() },
  match: { create: vi.fn() },
  bracketDependency: { create: vi.fn() },
  resultVersion: { count: vi.fn() },
};
const rankings = Array.from({ length: 32 }, (_, i) => ({
  id: `player-${i + 1}`,
}));

beforeEach(() => {
  vi.resetAllMocks();
  mocks.privateTx.mockImplementation(async (_actor, work) => work(tx));
  tx.stage.findUniqueOrThrow.mockResolvedValue(stage);
  tx.stage.findFirstOrThrow.mockResolvedValue({ id: "league" });
  tx.rankingSnapshot.findFirst.mockResolvedValue({
    id: "frozen-ranking",
    rankings,
  });
  tx.category.findUniqueOrThrow.mockResolvedValue({
    tournament: { configuration: newTournamentConfiguration },
  });
  tx.round.count.mockResolvedValue(0);
  tx.round.create.mockResolvedValue({ id: "round" });
  tx.match.create.mockImplementation(async ({ data }) => ({
    id: `match-${data.order}`,
  }));
  tx.resultVersion.count.mockResolvedValue(0);
});

describe("playoff fixture creation", () => {
  it("accepts BO7 playoff rules and generates BO7 matches", async () => {
    await confirmRules(actor, {
      stageId: stage.id,
      rules: { qualificationBestOf: 7 },
      confirmedRules: ["qualificationBestOf"],
      reason: "",
    });
    tx.stage.findUniqueOrThrow.mockResolvedValue({
      ...stage,
      rules: { ...stage.rules, qualificationBestOf: 7 },
    });
    await createQualification(actor, { stageId: stage.id, reason: "" });
    expect(
      tx.match.create.mock.calls.every(([input]) => input.data.bestOf === 7),
    ).toBe(true);
  });
  it.each([2, 6, 7.5, 101])(
    "rejects invalid playoff length %s before saving",
    async (bestOf) => {
      await expect(
        confirmRules(actor, {
          stageId: stage.id,
          rules: { qualificationBestOf: bestOf },
          confirmedRules: ["qualificationBestOf"],
          reason: "",
        }),
      ).rejects.toThrow(/odd number/);
      expect(tx.stage.update).not.toHaveBeenCalled();
    },
  );
  it("accepts and confirms the automatic opponent rule", async () => {
    await confirmRules(actor, {
      stageId: stage.id,
      rules: { qualificationPairing: "auto" },
      confirmedRules: ["qualificationPairing"],
      reason: "Approve automatic pairing",
    });
    expect(tx.stage.update).toHaveBeenCalledWith({
      where: { id: stage.id },
      data: {
        rules: { qualificationPairing: "auto" },
        confirmedRules: ["qualificationPairing"],
        ruleVersion: { increment: 1 },
      },
    });
  });

  it("creates equal-match fixtures from the frozen playoff pool, ignoring submitted pairs", async () => {
    await createQualification(actor, {
      stageId: stage.id,
      pairs: [["unqualified", "tampered"]],
      reason: "Create automatic fixtures",
    });
    const matches = tx.match.create.mock.calls.map(([input]) => input.data);
    const ids = rankings.slice(4, 12).map((row) => row.id);
    expect(matches).toHaveLength(8);
    expect(matches.every((match) => match.bestOf === 3)).toBe(true);
    for (const id of ids)
      expect(
        matches.filter((match) => match.sideAId === id || match.sideBId === id),
      ).toHaveLength(2);
    expect(
      matches.every(
        (match) => ids.includes(match.sideAId) && ids.includes(match.sideBId),
      ),
    ).toBe(true);
    expect(tx.bracketDependency.create).toHaveBeenCalledTimes(8);
    expect(tx.bracketDependency.create).toHaveBeenCalledWith({
      data: { snapshotId: "frozen-ranking", matchId: "match-1" },
    });
    expect(mocks.audit).toHaveBeenCalledWith(
      tx,
      actor,
      "QUALIFICATION_CREATE",
      "STAGE",
      stage.id,
      { matches: 8, pairing: "auto" },
      "Create automatic fixtures",
    );
  });

  it("allows automatic fixture creation without a manual pairs payload", async () => {
    await expect(
      createQualification(actor, { stageId: stage.id, reason: "" }),
    ).resolves.toEqual({ id: stage.id });
  });

  it("still requires valid explicit opponents in manual mode", async () => {
    tx.stage.findUniqueOrThrow.mockResolvedValue({
      ...stage,
      rules: { ...stage.rules, qualificationPairing: "manual" },
    });
    await expect(
      createQualification(actor, { stageId: stage.id, reason: "" }),
    ).rejects.toThrow(/8 qualification series/);
    expect(tx.round.create).not.toHaveBeenCalled();
  });

  it("preserves the chosen pairings in manual mode", async () => {
    tx.stage.findUniqueOrThrow.mockResolvedValue({
      ...stage,
      rules: { ...stage.rules, qualificationPairing: "manual" },
    });
    const ids = rankings.slice(4, 12).map((row) => row.id);
    const pairs = ids.map((id, i) => [id, ids[(i + 1) % ids.length]]);
    await createQualification(actor, { stageId: stage.id, pairs, reason: "" });
    expect(
      tx.match.create.mock.calls.map(([input]) => [
        input.data.sideAId,
        input.data.sideBId,
      ]),
    ).toEqual(pairs);
  });

  it("requires confirmed rules and a current, complete frozen ranking", async () => {
    tx.stage.findUniqueOrThrow.mockResolvedValue({
      ...stage,
      confirmedRules: [],
    });
    await expect(
      createQualification(actor, { stageId: stage.id, reason: "" }),
    ).rejects.toThrow(/Confirm qualification rules/);
    tx.stage.findUniqueOrThrow.mockResolvedValue(stage);
    tx.rankingSnapshot.findFirst.mockResolvedValue(null);
    await expect(
      createQualification(actor, { stageId: stage.id, reason: "" }),
    ).rejects.toThrow(/Freeze a current league ranking/);
    tx.rankingSnapshot.findFirst.mockResolvedValue({
      id: "incomplete",
      rankings: rankings.slice(0, 5),
    });
    await expect(
      createQualification(actor, { stageId: stage.id, reason: "" }),
    ).rejects.toThrow(/missing playoff entrants/);
    expect(tx.round.create).not.toHaveBeenCalled();
  });

  it("refuses to overwrite existing playoff fixtures", async () => {
    tx.round.count.mockResolvedValue(1);
    await expect(
      createQualification(actor, { stageId: stage.id, reason: "" }),
    ).rejects.toThrow(/fixtures already exist/);
    expect(tx.round.create).not.toHaveBeenCalled();
  });
});
