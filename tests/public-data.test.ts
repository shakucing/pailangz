import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { originalConfiguration } from "../src/lib/tournament-config";

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  queryRaw: vi.fn(),
  ensureRuntime: vi.fn(),
  getLocale: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("../src/lib/db", () => ({
  db: { tournament: { findFirst: mocks.findFirst }, $queryRaw: mocks.queryRaw },
  ensureRuntime: mocks.ensureRuntime,
}));
vi.mock("../src/lib/i18n", () => ({ getLocale: mocks.getLocale }));

import { publicTournament } from "../src/lib/public-data";

describe("public tournament player privacy", () => {
  beforeEach(() => {
    vi.stubEnv("DATABASE_URL", "postgresql://synthetic.invalid/test");
    vi.clearAllMocks();
  });
  afterEach(() => vi.unstubAllEnvs());

  it.each([
    { carry: false, confirmed: true, expected: false },
    { carry: true, confirmed: true, expected: true },
    { carry: true, confirmed: false, expected: null },
    { carry: undefined, confirmed: true, expected: null },
  ])(
    "exposes only confirmed carry-forward rules: $carry / $confirmed",
    async ({ carry, confirmed, expected }) => {
      mocks.queryRaw.mockResolvedValue([]);
      mocks.getLocale.mockResolvedValue("en");
      mocks.findFirst.mockResolvedValue({
        name: "Test",
        slug: "test",
        overview: "Test",
        overviewEn: "",
        startsAt: null,
        status: "IN_PROGRESS",
        gameTitle: "Test",
        configuration: originalConfiguration,
        participants: [],
        categories: [
          {
            kind: "SOLO",
            teams: [],
            stages: [
              {
                id: "qualification",
                key: "qualification",
                name: "Qualification",
                format: "LEAGUE",
                rules: { qualificationCarry: carry },
                confirmedRules: confirmed ? ["qualificationCarry"] : [],
                rounds: [],
              },
            ],
          },
        ],
      });
      const tournament = await publicTournament("test");
      expect(tournament?.categories[0].stages[0].qualificationCarry).toBe(
        expected,
      );
    },
  );

  it.each(["ms", "en"])(
    "excludes IGNs from public data and queries in %s",
    async (locale) => {
      const privateIgn = "PRIVATE_PLAYER_IGN_CANARY";
      mocks.getLocale.mockResolvedValue(locale);
      mocks.findFirst.mockResolvedValue({
        name: "Test tournament",
        slug: "test-tournament",
        overview: "Test overview",
        overviewEn: "English overview",
        startsAt: null,
        status: "IN_PROGRESS",
        gameTitle: "Test game",
        configuration: originalConfiguration,
        participants: [
          { id: "p1", code: "P01", member: { displayIgn: privateIgn } },
          { id: "p2", code: "P02", member: { displayIgn: `${privateIgn}_2` } },
        ],
        categories: [
          {
            kind: "SOLO",
            teams: [],
            stages: [
              {
                id: "league",
                key: "league",
                name: "League",
                format: "LEAGUE",
                rules: {},
                confirmedRules: [],
                rounds: [
                  {
                    name: "Round 1",
                    number: 1,
                    matches: [
                      {
                        id: "match1",
                        order: 1,
                        sideAId: "p1",
                        sideBId: "p2",
                        sideKind: "SOLO",
                        bestOf: 3,
                        status: "FINALIZED",
                        scheduledAt: null,
                        currentResult: {
                          outcome: "A_WIN",
                          status: "ACCEPTED",
                          games: [
                            { number: 1, scoreA: 1, scoreB: 0 },
                            { number: 2, scoreA: 1, scoreB: 0 },
                          ],
                        },
                      },
                    ],
                  },
                ],
              },
            ],
          },
          {
            kind: "TEAM",
            teams: [
              {
                id: "team1",
                code: "T01",
                name: "Team Alpha",
                _count: { memberships: 4 },
                memberships: [{ member: { displayIgn: privateIgn } }],
              },
              {
                id: "team2",
                code: "T02",
                name: "Team Beta",
                _count: { memberships: 4 },
                memberships: [{ member: { displayIgn: privateIgn } }],
              },
            ],
            stages: [
              {
                id: "team-knockout",
                key: "knockout",
                name: "Knockout",
                format: "KNOCKOUT",
                rules: {},
                confirmedRules: [],
                rounds: [
                  {
                    name: "Round 1",
                    number: 1,
                    matches: [
                      {
                        id: "team-match",
                        order: 1,
                        sideAId: "team1",
                        sideBId: "team2",
                        sideKind: "TEAM",
                        bestOf: 3,
                        status: "FINALIZED",
                        scheduledAt: null,
                        currentResult: {
                          outcome: "A_WIN",
                          status: "ACCEPTED",
                          games: [
                            { number: 1, scoreA: 1, scoreB: 0 },
                            { number: 2, scoreA: 1, scoreB: 0 },
                          ],
                        },
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      });
      mocks.queryRaw.mockResolvedValue([
        {
          stageId: "league",
          stale: false,
          rankings: [
            { id: "p1", ign: privateIgn, rank: 1, points: 3 },
            { id: "p2", ign: `${privateIgn}_2`, rank: 2, points: 0 },
          ],
        },
      ]);

      const tournament = await publicTournament("test-tournament");
      expect(JSON.stringify(tournament)).not.toContain(privateIgn);
      expect(tournament?.participants).toEqual([
        { code: "P01" },
        { code: "P02" },
      ]);
      expect(tournament?.categories[1].teams).toEqual([
        { code: "T01", name: "Team Alpha", playerCount: 4 },
        { code: "T02", name: "Team Beta", playerCount: 4 },
      ]);
      expect(
        tournament?.categories[1].stages[0].rounds[0].matches[0],
      ).toMatchObject({
        a: "T01 · Team Alpha",
        b: "T02 · Team Beta",
      });
      const stage = tournament!.categories[0].stages[0];
      expect(stage.rankingsFinalized).toBe(true);
      expect(stage.rankingsStale).toBe(false);
      expect(stage.rounds[0].matches[0]).toMatchObject({ a: "P01", b: "P02" });
      expect(stage.standings[0]).toMatchObject({
        code: "P01",
        wins: 1,
        points: 3,
        rank: 1,
      });
      expect(stage.standings[0]).not.toHaveProperty("ign");
      expect(stage.standings[0]).not.toHaveProperty("id");
      const query = mocks.findFirst.mock.calls[0][0];
      expect(query.select.participants.select).toEqual({
        id: true,
        code: true,
      });
      expect(query.select.categories.select.teams.select).not.toHaveProperty(
        "memberships",
      );
      expect(JSON.stringify(query.select)).not.toContain("displayIgn");
      expect(query.where).toMatchObject({
        published: true,
        status: { notIn: ["DRAFT", "ARCHIVED"] },
      });
    },
  );
});
