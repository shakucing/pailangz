import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { originalConfiguration } from "../src/lib/tournament-config";
import { LocaleProvider } from "../src/components/locale-context";

const mocks = vi.hoisted(() => ({
  tournament: vi.fn(),
  names: vi.fn(),
  locale: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("../src/lib/public-data", () => ({
  publicTournament: mocks.tournament,
  dateText: () => "1 November 2026",
}));
vi.mock("../src/lib/public-player-names", () => ({
  publicPlayerNames: mocks.names,
}));
vi.mock("../src/lib/i18n", () => ({
  getLocale: mocks.locale,
  translate: (locale: string, ms: string, en: string) =>
    locale === "en" ? en : ms,
}));
vi.mock("../src/components/navigation-link", () => ({
  NavigationLink: ({ children, ...props }: { children: ReactNode }) =>
    createElement("a", props, children),
}));
// This static renderer has no App Router; polling is covered in web-live-results.
vi.mock("../src/components/live-results-refresh", () => ({
  LiveResultsRefresh: () => null,
}));
import Tournament from "../src/app/tournaments/[slug]/[[...view]]/page";

function event() {
  const match = {
    id: "league-match",
    order: 1,
    a: "P01",
    b: "P02",
    bestOf: 3,
    status: "FINALIZED",
    scheduledAt: null,
    result: {
      outcome: "A_WIN",
      games: [
        { number: 1, scoreA: 15, scoreB: 3 },
        { number: 2, scoreA: 15, scoreB: 4 },
      ],
    },
  };
  const league = {
    key: "league",
    name: "League",
    format: "LEAGUE",
    qualificationBestOf: null,
    rankingsFinalized: true,
    rankingsStale: false,
    standings: ["P01", "P02"].map((code, index) => ({
      code,
      rank: index + 1,
      played: 1,
      wins: index === 0 ? 1 : 0,
      draws: 0,
      losses: index === 1 ? 1 : 0,
      points: index === 0 ? 3 : 0,
      gameWins: index === 0 ? 2 : 0,
      gameLosses: index === 1 ? 2 : 0,
      differential: index === 0 ? 2 : -2,
    })),
    rounds: [{ name: "Round 1", number: 1, matches: [match] }],
  };
  return {
    slug: "public-solo",
    name: "Public SOLO tournament",
    overview: "Published event",
    status: "IN_PROGRESS",
    startsAt: null,
    configuration: { ...originalConfiguration, format: "SOLO" },
    participants: [{ code: "P01" }, { code: "P02" }],
    categories: [
      {
        kind: "SOLO",
        teams: [],
        stages: [
          league,
          {
            ...league,
            key: "knockout",
            name: "Knockout",
            format: "KNOCKOUT",
            standings: [],
            rounds: [
              {
                name: "Final",
                number: 1,
                matches: [{ ...match, id: "final" }],
              },
            ],
          },
        ],
      },
    ],
  };
}

async function render(section: string, locale: "ms" | "en" = "en") {
  mocks.locale.mockResolvedValue(locale);
  const page = await Tournament({
    params: Promise.resolve({
      slug: "public-solo",
      view: section === "overview" ? undefined : [section],
    }),
  });
  return renderToStaticMarkup(
    createElement(LocaleProvider, { locale, children: page }),
  );
}

describe("published tournament players and tabs", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.tournament.mockResolvedValue(event());
    mocks.names.mockResolvedValue([
      { code: "P01", ign: "Éagle BoB" },
      { code: "P02", ign: "DarkNightx" },
      { code: "P99", ign: "UNAPPROVED_NAME_CANARY" },
    ]);
  });

  it.each(["overview", "standings", "fixtures", "brackets"])(
    "shows clickable approved IGNs and omits Teams on the SOLO %s tab",
    async (section) => {
      for (const locale of ["en", "ms"] as const) {
        const html = await render(section, locale);
        expect(html).not.toContain('href="/tournaments/public-solo/teams"');
        expect(html).toMatch(
          /<button[^>]*aria-haspopup="dialog"[^>]*>P01 · Éagle BoB<\/button>/,
        );
        expect(html).toMatch(
          /<button[^>]*aria-haspopup="dialog"[^>]*>P02 · DarkNightx<\/button>/,
        );
        expect(html).not.toContain("UNAPPROVED_NAME_CANARY");
        expect(html).not.toMatch(/<button[^>]*>[^<]*<button/);
      }
    },
  );

  it("retains Teams for TEAM and legacy combined tournaments", async () => {
    for (const format of ["TEAM", undefined]) {
      const data = event();
      mocks.tournament.mockResolvedValue({
        ...data,
        configuration: { ...data.configuration, format },
        categories: [
          ...data.categories,
          { kind: "TEAM", teams: [], stages: [] },
        ],
      });
      expect(await render("overview")).toContain(
        'href="/tournaments/public-solo/teams"',
      );
    }
  });

  it("keeps participant codes clickable when a public IGN is unavailable", async () => {
    mocks.names.mockResolvedValue([]);
    const html = await render("overview");
    expect(html).toMatch(
      /<button[^>]*aria-haspopup="dialog"[^>]*>P01<\/button>/,
    );
    expect(html).not.toContain("Éagle BoB");
  });
});
