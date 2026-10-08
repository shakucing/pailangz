import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { newTournamentConfiguration } from "../src/lib/tournament-config";

export async function checkModeratorSetupHttp(
  origin: string,
  cookie: string,
  check: (name: string, fn: () => Promise<void>) => Promise<void>,
) {
  const post = (action: string, data: Record<string, unknown>) =>
    fetch(`${origin}/api/staff`, {
      method: "POST",
      headers: {
        Cookie: cookie,
        Origin: origin,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ action, data }),
    });
  await check(
    "moderator creates an event with private fixtures and configurable public signup over HTTP",
    async () => {
      const slug = `http-setup-${randomUUID()}`;
      const fields = {
        name: "Independent moderator event",
        slug,
        overview: "Shared registration details",
        overviewEn: "English registration details",
        status: "DRAFT",
        configuration: { ...newTournamentConfiguration, soloCapacity: 34 },
        registrationEnabled: true,
      };
      const response = await post("tournament", fields);
      assert.equal(response.status, 200);
      const { id } = await response.json();
      const workspace = await fetch(
        `${origin}/moderator/tournaments?id=${id}`,
        { headers: { Cookie: `${cookie}; pailangz_locale=en` } },
      );
      assert.equal(workspace.status, 200);
      const html = await workspace.text();
      for (const label of [
        "Edit tournament rules",
        "Confirm player list",
        "Publish tournament",
        "Withdraw or replace a player",
        `/participate/${slug}`,
      ])
        assert.ok(html.includes(label), label);
      for (const locale of ["en", "ms"]) {
        const signup = await fetch(`${origin}/participate/${slug}`, {
          headers: { Cookie: `pailangz_locale=${locale}` },
        });
        assert.equal(signup.status, 200);
        const page = await signup.text();
        assert.ok(page.includes('action="/api/participation"'));
        assert.ok(
          page.includes(
            locale === "en"
              ? "Limited to 34 players"
              : "Terhad kepada 34 pemain",
          ),
        );
        assert.ok(page.includes("Independent moderator event"));
      }
      assert.equal(
        (await fetch(`${origin}/tournaments/${slug}/teams`)).status,
        200,
      );
      assert.equal(
        (await fetch(`${origin}/api/tournaments/${slug}`)).status,
        404,
      );
      const blocked = await post("publish", { id, published: true });
      assert.equal(
        blocked.status,
        400,
        "Readiness still protects publication for moderators",
      );
      assert.equal(
        (
          await post("tournament", {
            ...fields,
            id,
            registrationEnabled: false,
          })
        ).status,
        200,
      );
      const closed = await (
        await fetch(`${origin}/participate/${slug}`, {
          headers: { Cookie: "pailangz_locale=en" },
        })
      ).text();
      assert.ok(closed.includes("Registration closed"));
      assert.ok(!closed.includes('action="/api/participation"'));
      // Next streams the layout before notFound(), so inspect the rendered boundary.
      const unavailable = await (
        await fetch(`${origin}/tournaments/${slug}/teams`, {
          headers: { Cookie: "pailangz_locale=en" },
        })
      ).text();
      assert.ok(unavailable.includes("This page is not available yet."));
      assert.ok(!unavailable.includes("Independent moderator event"));
    },
  );
}
