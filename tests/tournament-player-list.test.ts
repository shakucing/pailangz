import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { TournamentPlayerList } from "../src/components/tournament-player-list";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

function entrant(number: number, eligible = true) {
  return {
    id: `entrant-${number}`,
    code: `P${String(number).padStart(2, "0")}`,
    eligible,
    member: {
      displayIgn: `Player ${number}`,
      verified: true,
      archived: false,
    },
  };
}

describe("tournament player list", () => {
  it("shows all 32 saved entrants with names and codes in participant order", () => {
    const html = renderToStaticMarkup(
      createElement(TournamentPlayerList, {
        tournamentId: "test-tournament",
        participants: Array.from({ length: 32 }, (_, i) => entrant(32 - i)),
        capacity: 32,
        mappingConfirmed: true,
        published: false,
      }),
    );
    expect(html).toContain("Assigned players · 32 of 32");
    expect(html).toContain("Player list confirmed.");
    for (let number = 1; number <= 32; number++) {
      expect(html).toContain(`<strong>Player ${number}</strong>`);
      expect(html).toContain(`<td>P${String(number).padStart(2, "0")}</td>`);
    }
    expect(html.indexOf("<td>P02</td>")).toBeLessThan(
      html.indexOf("<td>P10</td>"),
    );
    expect(html.match(/>Eligible<\/span>/g)).toHaveLength(32);
    expect(html).toContain('aria-label="Select all assigned players"');
    expect(html.match(/aria-label="Select P\d+ · Player \d+"/g)).toHaveLength(
      32,
    );
    expect(html).toContain("Mark eligible");
    expect(html).toContain("Mark ineligible");
  });

  it("distinguishes pending eligibility and inactive members from eligible players", () => {
    const inactive = entrant(3);
    inactive.member.archived = true;
    const html = renderToStaticMarkup(
      createElement(TournamentPlayerList, {
        tournamentId: "test-tournament",
        participants: [entrant(1), entrant(2, false), inactive],
        capacity: 32,
        mappingConfirmed: false,
        published: false,
      }),
    );
    expect(html).toContain("Player list awaiting confirmation.");
    expect(html.match(/>Eligible<\/span>/g)).toHaveLength(1);
    expect(html.match(/>Needs confirmation<\/span>/g)).toHaveLength(2);
    expect(html).toContain("Member needs review");
  });

  it("explains an empty roster and prevents eligibility edits while published", () => {
    const empty = renderToStaticMarkup(
      createElement(TournamentPlayerList, {
        tournamentId: "test-tournament",
        participants: [],
        capacity: 32,
        mappingConfirmed: false,
        published: false,
      }),
    );
    expect(empty).toContain("Assigned players · 0 of 32");
    expect(empty).toContain("No players have been assigned yet.");
    const published = renderToStaticMarkup(
      createElement(TournamentPlayerList, {
        tournamentId: "test-tournament",
        participants: [entrant(1)],
        capacity: 32,
        mappingConfirmed: true,
        published: true,
      }),
    );
    expect(published).toMatch(
      /<button[^>]*disabled=""[^>]*>Edit eligibility<\/button>/,
    );
    expect(published).toContain(
      "Unpublish the tournament before changing eligibility.",
    );
    expect(published).toMatch(
      /aria-label="Select all assigned players"[^>]*disabled=""/,
    );
  });
});
