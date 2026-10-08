import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { originalConfiguration } from "../src/lib/tournament-config";
import type { EventPresentationData } from "../src/lib/event-presentation-data";

const mocks = vi.hoisted(() => ({
  queryRaw: vi.fn(),
  ensureRuntime: vi.fn(),
  publicTournament: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("../src/lib/db", () => ({
  db: { $queryRaw: mocks.queryRaw },
  ensureRuntime: mocks.ensureRuntime,
}));
vi.mock("../src/lib/public-data", () => ({
  publicTournament: mocks.publicTournament,
}));
import { eventPresentationData } from "../src/lib/event-presentation-data";

function event(): EventPresentationData {
  return {
    name: "Original event",
    slug: "pailangz-solo-team",
    status: "DRAFT",
    configuration: originalConfiguration,
    preview: true,
    participants: [{ code: "P35" }, { code: "P65" }],
    categories: ["SOLO", "TEAM"].map((kind) => ({
      kind,
      teams: [],
      stages: [
        {
          key: "knockout",
          name: "Knockout",
          format: "KNOCKOUT",
          qualificationBestOf: null,
          standings: [],
          rounds: [
            {
              number: 1,
              name: "Final",
              matches: [
                {
                  id: `${kind}-final`,
                  order: 1,
                  a: kind === "SOLO" ? "P35" : "T01 · Alpha",
                  b: kind === "SOLO" ? "P65" : "T02 · Beta",
                  bestOf: 5,
                  status: "SCHEDULED",
                  scheduledAt: null,
                  result: null,
                },
              ],
            },
          ],
        },
      ],
    })),
  };
}

describe("landing SOLO names", () => {
  beforeEach(() => {
    vi.stubEnv("DATABASE_URL", "postgresql://synthetic.invalid/test");
    vi.resetAllMocks();
  });
  afterEach(() => vi.unstubAllEnvs());

  it.each([true, false])(
    "adds approved names to preview=%s without changing TEAM labels",
    async (preview) => {
      const data = event();
      if (preview) mocks.queryRaw.mockResolvedValueOnce([{ data }]);
      else mocks.publicTournament.mockResolvedValueOnce(data);
      mocks.queryRaw.mockResolvedValueOnce([
        { code: "P35", ign: "Éagle BoB", phone: "PRIVATE_CONTACT_CANARY" },
        { code: "P65", ign: "DarkNightx" },
      ]);
      const result = await eventPresentationData(
        preview ? undefined : data.slug,
      );
      expect(result?.preview).toBe(preview);
      expect(result?.participants).toEqual([
        { code: "P35", ign: "Éagle BoB" },
        { code: "P65", ign: "DarkNightx" },
      ]);
      expect(
        result?.categories[0].stages[0].rounds[0].matches[0],
      ).toMatchObject({
        a: "P35 · Éagle BoB",
        b: "P65 · DarkNightx",
        result: null,
      });
      expect(result?.categories[1]).toEqual(data.categories[1]);
      expect(JSON.stringify(result)).not.toContain("PRIVATE_CONTACT_CANARY");
      expect(mocks.queryRaw.mock.calls.at(-1)?.[1]).toBe(data.slug);
    },
  );

  it("keeps codes for an event without approved names", async () => {
    const data = { ...event(), slug: "other-event" };
    mocks.publicTournament.mockResolvedValueOnce(data);
    mocks.queryRaw.mockResolvedValueOnce([]);
    const result = await eventPresentationData(data.slug);
    expect(result?.participants).toEqual(data.participants);
    expect(result?.categories).toEqual(data.categories);
    expect(mocks.queryRaw).toHaveBeenCalledOnce();
    expect(mocks.queryRaw.mock.calls[0][1]).toBe("other-event");
  });

  it("preserves byes and unassigned fixture sides", async () => {
    const data = event();
    data.categories[0].stages[0].rounds[0].matches[0].a = null;
    data.categories[0].stages[0].rounds[0].matches[0].b = "BYE";
    mocks.queryRaw
      .mockResolvedValueOnce([{ data }])
      .mockResolvedValueOnce([{ code: "P35", ign: "Alpha" }]);
    const result = await eventPresentationData();
    expect(result?.categories[0].stages[0].rounds[0].matches[0]).toMatchObject({
      a: null,
      b: "BYE",
    });
  });

  it("returns the empty state when the original preview is unavailable", async () => {
    mocks.queryRaw.mockResolvedValueOnce([]);
    expect(await eventPresentationData()).toBeNull();
    expect(mocks.queryRaw).toHaveBeenCalledOnce();
  });

  it("does not query without a configured database", async () => {
    vi.stubEnv("DATABASE_URL", "");
    expect(await eventPresentationData()).toBeNull();
    expect(mocks.queryRaw).not.toHaveBeenCalled();
  });
});
