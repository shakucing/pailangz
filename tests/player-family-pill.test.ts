import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PlayerFamilyPill } from "../src/components/player-family-pill";
import {
  TournamentPlayerName,
  TournamentPlayerResults,
} from "../src/components/tournament-player-results";

describe("tournament player family pills", () => {
  it.each(["Pailangz", "Null", "Night Owls"])(
    "shows %s beside the original player button",
    (familyLabel) => {
      const html = renderToStaticMarkup(
        createElement(TournamentPlayerResults, {
          participants: [{ code: "P01", ign: "Alpha", familyLabel }],
          stages: [],
          children: createElement(TournamentPlayerName, {
            value: "P01 · Alpha · 3 pts",
          }),
        }),
      );
      expect(html).toContain('aria-haspopup="dialog">P01 · Alpha</button>');
      expect(html).toContain(`data-family-label="${familyLabel}"`);
      expect(html).toContain(" · 3 pts");
    },
  );
  it("keeps labels as text and avoids claiming membership when the public label is absent", () => {
    expect(renderToStaticMarkup(createElement(PlayerFamilyPill, {}))).toBe("");
    const html = renderToStaticMarkup(
      createElement(PlayerFamilyPill, {
        label: '<script>alert("test")</script>',
      }),
    );
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});
