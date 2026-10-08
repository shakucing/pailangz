import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Tx } from "../src/lib/db";
import { staffParticipation } from "../src/lib/staff-participation";
import { renderParticipation } from "../src/components/participation-workspace";

vi.mock("../src/lib/staff-participation", () => ({
  staffParticipation: vi.fn(),
}));
vi.mock("../src/lib/public-data", () => ({
  operationalTime: (value: Date) => value.toISOString(),
}));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) =>
    createElement("a", { href }, children),
}));
vi.mock("../src/components/operations-sections", () => ({
  SectionPages: ({ total }: { total: number }) =>
    createElement("nav", null, `${total} records`),
}));

function row(number: number) {
  return {
    id: `entry-${number}`,
    tournamentId: "tournament",
    tournamentName: "Draft tournament",
    memberId: `member-${number}`,
    receivedAt: number <= 2 ? new Date("2030-01-01T00:00:00Z") : null,
    member: {
      id: `member-${number}`,
      displayIgn: `Player ${number}`,
      verified: true,
      archived: false,
      participants: [
        {
          tournamentId: "tournament",
          code: `P${String(number).padStart(2, "0")}`,
          eligible: true,
          withdrawn: false,
        },
      ],
      memberships: [] as {
        category: { tournamentId: string };
        team: { name: string };
      }[],
    },
  };
}
beforeEach(() => vi.clearAllMocks());

describe("participation workspace", () => {
  it("renders all 32 entrants while distinguishing two player signups from 30 staff assignments", async () => {
    vi.mocked(staffParticipation).mockResolvedValue({
      rows: Array.from({ length: 32 }, (_, i) => row(i + 1)),
      total: 32,
    });
    const html = renderToStaticMarkup(
      await renderParticipation({} as Tx, {}, "/moderator"),
    );
    expect(html).toContain("32 records");
    expect(html.match(/<strong>Player \d+<\/strong>/g)).toHaveLength(32);
    expect(html.match(/<td>Player signup<\/td>/g)).toHaveLength(2);
    expect(html.match(/<td>Staff assignment<\/td>/g)).toHaveLength(30);
    expect(html.match(/<td>—<\/td>/g)).toHaveLength(30);
    expect(html).toContain('href="/moderator/tournaments?id=tournament"');
  });
  it("shows awaiting slots, withdrawals and team assignments for the correct tournament", async () => {
    const signup = row(1),
      withdrawn = row(3);
    signup.member.participants = [];
    withdrawn.member.participants[0].withdrawn = true;
    withdrawn.member.participants[0].eligible = false;
    withdrawn.member.memberships = [
      {
        category: { tournamentId: "other" },
        team: { name: "Other event team" },
      },
      {
        category: { tournamentId: "tournament" },
        team: { name: "Correct roster" },
      },
    ];
    vi.mocked(staffParticipation).mockResolvedValue({
      rows: [signup, withdrawn],
      total: 2,
    });
    const html = renderToStaticMarkup(
      await renderParticipation({} as Tx, {}, "/admin"),
    );
    expect(html).toContain("Awaiting slot");
    expect(html).toContain("P03 · Withdrawn");
    expect(html).toContain("Correct roster");
    expect(html).not.toContain("Other event team");
  });
  it("uses the filtered total and normalizes the page and search before loading records", async () => {
    vi.mocked(staffParticipation).mockResolvedValue({ rows: [], total: 0 });
    const tx = {} as Tx;
    const html = renderToStaticMarkup(
      await renderParticipation(
        tx,
        { q: "x".repeat(120), page: "1.5" },
        "/admin",
      ),
    );
    expect(staffParticipation).toHaveBeenCalledWith(tx, {
      search: "x".repeat(100),
      page: 1,
    });
    expect(html).toContain("No tournament players or signups found.");
    expect(html).toContain("0 records");
  });
});
