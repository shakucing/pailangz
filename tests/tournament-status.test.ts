import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Actor } from "../src/lib/db";
import { saveTournament } from "../src/lib/competition";
import { newTournamentConfiguration } from "../src/lib/tournament-config";

const mocks = vi.hoisted(() => ({
  privateTx: vi.fn(),
  audit: vi.fn(),
  createStages: vi.fn(),
}));
vi.mock("../src/lib/db", () => ({
  privateTx: mocks.privateTx,
  audit: mocks.audit,
}));
vi.mock("../src/lib/configuration", () => ({
  createStages: mocks.createStages,
}));

const actor: Actor = {
  id: "staff",
  sessionId: "session",
  role: "MODERATOR",
  authenticatedAt: new Date(),
};
const id = "ab95ec7e-5bb8-4e6b-a4d3-676fd1cda63f";
const statuses = [
  "DRAFT",
  "REGISTRATION_OPEN",
  "REGISTRATION_CLOSED",
  "IN_PROGRESS",
  "COMPLETED",
  "ARCHIVED",
];
const tx = {
  tournament: { findUniqueOrThrow: vi.fn(), update: vi.fn(), create: vi.fn() },
  stage: { updateMany: vi.fn() },
};
const input = {
  id,
  name: "Synthetic tournament",
  overview: "Status corrections",
  reason: "Correct tournament status",
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.privateTx.mockImplementation(async (_actor, work) => work(tx));
  tx.tournament.findUniqueOrThrow.mockResolvedValue({
    id,
    slug: "synthetic",
    status: "REGISTRATION_CLOSED",
    published: true,
  });
  tx.tournament.update.mockResolvedValue({ id });
});

describe("staff tournament status corrections", () => {
  it("allows all 36 valid status selections on an existing event", async () => {
    for (const from of statuses) {
      tx.tournament.findUniqueOrThrow.mockResolvedValue({
        id,
        slug: "synthetic",
        status: from,
      });
      for (const status of statuses) {
        await expect(
          saveTournament(actor, { ...input, status }),
        ).resolves.toEqual({ id });
        expect(tx.tournament.update).toHaveBeenLastCalledWith({
          where: { id },
          data: expect.objectContaining({ status }),
        });
      }
    }
    expect(mocks.createStages).not.toHaveBeenCalled();
  });

  it("records before and after status when reopening registration", async () => {
    await saveTournament(actor, { ...input, status: "REGISTRATION_OPEN" });
    expect(mocks.audit).toHaveBeenCalledWith(
      tx,
      actor,
      "TOURNAMENT_UPDATE",
      "TOURNAMENT",
      id,
      expect.objectContaining({
        beforeStatus: "REGISTRATION_CLOSED",
        afterStatus: "REGISTRATION_OPEN",
      }),
      input.reason,
    );
    expect(tx.stage.updateMany).not.toHaveBeenCalled();
    expect(tx.tournament.update.mock.calls[0][0].data).not.toHaveProperty(
      "published",
    );
  });

  it.each(["DRAFT", "ARCHIVED"])(
    "unpublishes the event and active stages when selecting %s",
    async (status) => {
      await saveTournament(actor, { ...input, status });
      expect(tx.tournament.update).toHaveBeenCalledWith({
        where: { id },
        data: expect.objectContaining({ status, published: false }),
      });
      expect(tx.stage.updateMany).toHaveBeenCalledWith({
        where: { category: { tournamentId: id }, archived: false },
        data: { published: false },
      });
    },
  );

  it("does not publish an archived event merely by reopening it", async () => {
    tx.tournament.findUniqueOrThrow.mockResolvedValue({
      id,
      slug: "synthetic",
      status: "ARCHIVED",
      published: false,
    });
    await saveTournament(actor, { ...input, status: "REGISTRATION_OPEN" });
    expect(tx.tournament.update.mock.calls[0][0].data).not.toHaveProperty(
      "published",
    );
  });

  it("rejects unknown status values and still creates new events only as drafts", async () => {
    await expect(
      saveTournament(actor, { ...input, status: "UNKNOWN" }),
    ).rejects.toThrow();
    const { id: _id, ...creation } = input;
    await expect(
      saveTournament(actor, {
        ...creation,
        status: "IN_PROGRESS",
        configuration: newTournamentConfiguration,
      }),
    ).rejects.toThrow(/Create a draft/);
    expect(tx.tournament.update).not.toHaveBeenCalled();
    expect(tx.tournament.create).not.toHaveBeenCalled();
  });
});
