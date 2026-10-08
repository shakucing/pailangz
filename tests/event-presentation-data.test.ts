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
    vi.stubEnv("APP_ENV", "production");
    vi.stubEnv("DATABASE_ENV", "production");
    vi.stubEnv("LOCAL_PGLITE", "false");
    vi.stubEnv("VERCEL", "");
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

  it("shows accepted synthetic local scores and calculates standings including draws", async () => {
    vi.stubEnv("APP_ENV", "development");
    vi.stubEnv("DATABASE_ENV", "development");
    vi.stubEnv("LOCAL_PGLITE", "true");
    const data = event();
    const stage = data.categories[0].stages[0];
    stage.key = "league";
    stage.format = "LEAGUE";
    stage.rounds[0].matches.push({
      ...stage.rounds[0].matches[0],
      id: "unseeded-match",
      order: 2,
    });
    const games = [
      { number: 1, scoreA: 15, scoreB: 10 },
      { number: 2, scoreA: 10, scoreB: 15 },
    ];
    mocks.queryRaw
      .mockResolvedValueOnce([{ data }])
      .mockResolvedValueOnce([
        {
          id: "SOLO-final",
          a: "P35",
          b: "P65",
          rules: { seriesPoints: true, drawPolicy: "moderated_draw" },
          confirmedRules: ["seriesPoints", "drawPolicy"],
          result: { outcome: "DRAW", games },
        },
      ])
      .mockResolvedValueOnce([{ code: "P35", ign: "Alpha" }]);
    const result = await eventPresentationData();
    expect(result).toMatchObject({ preview: true, testResults: true });
    const league = result!.categories[0].stages[0];
    expect(league.rounds[0].matches[0]).toMatchObject({
      a: "P35 · Alpha",
      status: "FINALIZED",
      result: { outcome: "DRAW", games },
    });
    expect(league.rounds[0].matches[1]).toMatchObject({
      status: "SCHEDULED",
      result: null,
    });
    expect(league.standings).toEqual([
      {
        code: "P35",
        rank: null,
        played: 1,
        wins: 0,
        draws: 1,
        losses: 0,
        points: 1,
      },
      {
        code: "P65",
        rank: null,
        played: 1,
        wins: 0,
        draws: 1,
        losses: 0,
        points: 1,
      },
    ]);
    expect(result?.categories[1]).toEqual(data.categories[1]);
    const sql = mocks.queryRaw.mock.calls[1][0].join("");
    expect(sql).toContain("SYNTHETIC_LOCAL_SIX_ROUND_SCORES");
    expect(sql).toContain("rv.status = 'ACCEPTED'");
    expect(sql).toContain("m.status = 'FINALIZED'");
  });

  it.each([
    ["production", "development", "true", ""],
    ["preview", "development", "true", ""],
    ["development", "production", "true", ""],
    ["development", "development", "false", ""],
    ["development", "development", "true", "1"],
  ])(
    "keeps draft results hidden for app=%s database=%s local=%s vercel=%s",
    async (app, database, local, vercel) => {
      vi.stubEnv("APP_ENV", app);
      vi.stubEnv("DATABASE_ENV", database);
      vi.stubEnv("LOCAL_PGLITE", local);
      vi.stubEnv("VERCEL", vercel);
      mocks.queryRaw
        .mockResolvedValueOnce([{ data: event() }])
        .mockResolvedValueOnce([]);
      const result = await eventPresentationData();
      expect(result?.testResults).toBeUndefined();
      expect(
        result?.categories[0].stages[0].rounds[0].matches[0].result,
      ).toBeNull();
      expect(mocks.queryRaw).toHaveBeenCalledTimes(2);
    },
  );

  it("keeps the schedule preview when no synthetic results exist locally", async () => {
    vi.stubEnv("APP_ENV", "development");
    vi.stubEnv("DATABASE_ENV", "development");
    vi.stubEnv("LOCAL_PGLITE", "true");
    mocks.queryRaw
      .mockResolvedValueOnce([{ data: event() }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    const result = await eventPresentationData();
    expect(result?.testResults).toBeUndefined();
    expect(
      result?.categories[0].stages[0].rounds[0].matches[0].result,
    ).toBeNull();
  });
});
