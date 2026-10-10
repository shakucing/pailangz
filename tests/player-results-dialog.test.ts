import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PlayerResultsDialog } from "../src/components/player-results-dialog";
import { LocaleProvider } from "../src/components/locale-context";
import type { EventStage } from "../src/lib/event-presentation-data";

function render(carry: boolean | null, locale: "ms" | "en" = "en") {
  const stages: EventStage[] = ["league", "qualification", "knockout"].map(
    (key) => ({
      key,
      name: key,
      format: key === "knockout" ? "KNOCKOUT" : "LEAGUE",
      qualificationBestOf: null,
      qualificationCarry: key === "qualification" ? carry : null,
      standings: [],
      rounds: [
        {
          number: 1,
          name: "Round 1",
          matches: [
            {
              id: key,
              order: 1,
              a: "P01 · Alpha",
              b: "P02 · Beta",
              bestOf: 3,
              status: "FINALIZED",
              scheduledAt: null,
              result: {
                outcome: "A_WIN",
                games: [
                  { number: 1, scoreA: 1, scoreB: 0 },
                  { number: 2, scoreA: 1, scoreB: 0 },
                ],
              },
            },
          ],
        },
      ],
    }),
  );
  return renderToStaticMarkup(
    createElement(LocaleProvider, {
      locale,
      children: createElement(PlayerResultsDialog, {
        player: { code: "P01", ign: "Alpha" },
        stages,
        onClose() {},
      }),
    }),
  );
}

describe("player results dialog sections", () => {
  it("shows separate summaries and point labels when qualification starts from zero", () => {
    const html = render(false);
    expect(
      [...html.matchAll(/<section aria-label="([^"]+)"/g)].map((m) => m[1]),
    ).toEqual(["League", "Qualification", "Knockout"]);
    expect(html).toContain("Qualification starts from zero.");
    expect(html).toContain("Total league points</dt><dd>3</dd>");
    expect(html).toContain("Total qualification points</dt><dd>3</dd>");
    expect(html).toContain("+3 league points");
    expect(html).toContain("+3 qualification points");
    expect(html.match(/<dt>Played<\/dt><dd>1<\/dd>/g)).toHaveLength(3);
  });

  it("shows one combined summary for carried points and keeps knockout separate", () => {
    const html = render(true);
    expect(
      [...html.matchAll(/<section aria-label="([^"]+)"/g)].map((m) => m[1]),
    ).toEqual(["League &amp; Qualification", "Knockout"]);
    expect(html).toContain("League points carry forward into qualification.");
    expect(html).toContain("Total points</dt><dd>6</dd>");
    expect(html).toContain("Played</dt><dd>2</dd>");
    expect(html).toContain("Wins</dt><dd>2</dd>");
  });

  it("explains an unconfirmed rule without assuming points reset", () => {
    const html = render(null);
    expect(html).toContain("carry-forward rule is awaiting confirmation");
    expect(html).not.toContain("Qualification starts from zero");
    expect(html).not.toContain("League &amp; Qualification");
  });

  it("localizes both separate and combined sections in Malay", () => {
    const separate = render(false, "ms");
    expect(separate).toContain('aria-label="Liga"');
    expect(separate).toContain('aria-label="Kelayakan"');
    expect(separate).toContain("Kelayakan bermula dari sifar.");
    expect(separate).toContain("Jumlah mata kelayakan</dt><dd>3</dd>");
    const combined = render(true, "ms");
    expect(combined).toContain('aria-label="Liga &amp; Kelayakan"');
    expect(combined).toContain("Jumlah mata</dt><dd>6</dd>");
  });
});
