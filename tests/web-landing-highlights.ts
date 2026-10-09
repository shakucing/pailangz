import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { hash } from "bcryptjs";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { newTournamentConfiguration } from "../src/lib/tournament-config";

assert.equal(process.env.PAILANGZ_ISOLATED_WEB_TEST, "true");
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ?? "playwright"
);
const origin = process.env.NEXTAUTH_URL!;
const owner = new PrismaClient({
  adapter: new PrismaPg({
    connectionString: process.env.MIGRATION_DATABASE_URL,
    max: 1,
  }),
});
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const email = `highlights-${randomUUID()}@synthetic.invalid`,
    password = randomBytes(24).toString("base64url");
  await owner.staffUser.create({
    data: {
      name: "Highlight browser QA",
      email,
      passwordHash: await hash(password, 12),
      role: "MODERATOR",
    },
  });
  const events: { id: string; name: string }[] = [];
  for (const [format, name, status] of [
    ["SOLO", "First SOLO highlight", "DRAFT"],
    ["SOLO", "Replacement SOLO highlight", "DRAFT"],
    ["TEAM", "TEAM highlight tournament", "DRAFT"],
    ["SOLO", "Archived SOLO", "ARCHIVED"],
  ] as const) {
    events.push(
      await owner.tournament.create({
        data: {
          slug: `highlight-${randomUUID()}`,
          name,
          overview: "Synthetic highlight preview",
          status,
          configuration: { ...newTournamentConfiguration, format },
          categories: {
            create: { kind: format, capacity: format === "SOLO" ? 32 : 8 },
          },
        },
      }),
    );
  }
  const [solo, replacement, team, archived] = events;
  const context = await browser.newContext();
  await context.addCookies([
    { name: "pailangz_locale", value: "en", url: origin },
    { name: "pailangz_theme", value: "dark", url: origin },
  ]);
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error: Error) => errors.push(error.message));
  page.setDefaultTimeout(15000);
  await page.goto(`${origin}/staff`);
  await page.getByLabel("Staff email").fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole("button", { name: "Enter staff portal" }).click();
  await page.waitForURL(/\/moderator$/);

  async function saveHighlights(soloId: string | null, teamId: string | null) {
    await page.goto(`${origin}/moderator/tournaments`);
    const form = page.locator('form[data-action="landingHighlights"]');
    const soloSelect = form.getByLabel("SOLO highlight", { exact: true }),
      teamSelect = form.getByLabel("TEAM highlight", { exact: true });
    assert.equal(await soloSelect.getAttribute("multiple"), null);
    assert.equal(await teamSelect.getAttribute("multiple"), null);
    assert.equal(await soloSelect.locator('option[value=""]').count(), 1);
    assert.equal(
      await soloSelect.locator('option[value=""]').innerText(),
      "None",
    );
    assert.equal(
      await soloSelect.locator(`option[value="${team.id}"]`).count(),
      0,
    );
    assert.equal(
      await teamSelect.locator(`option[value="${solo.id}"]`).count(),
      0,
    );
    assert.equal(
      await soloSelect.locator(`option[value="${archived.id}"]`).count(),
      0,
    );
    await soloSelect.selectOption(soloId ?? "");
    await teamSelect.selectOption(teamId ?? "");
    const [response] = await Promise.all([
      page.waitForResponse(
        (response: { url(): string; request(): { method(): string } }) =>
          response.url().endsWith("/api/staff") &&
          response.request().method() === "POST",
      ),
      form
        .getByRole("button", { name: "Save landing highlights", exact: true })
        .click(),
    ]);
    assert.equal(response.status(), 200, JSON.stringify(await response.json()));
    await page.reload();
    assert.equal(await soloSelect.inputValue(), soloId ?? "");
    assert.equal(await teamSelect.inputValue(), teamId ?? "");
  }
  async function checkLanding(soloId: string | null, teamId: string | null) {
    await page.goto(origin);
    await page.waitForLoadState("networkidle");
    const centre = page.locator("#tournament-format");
    assert.equal(await centre.count(), soloId || teamId ? 1 : 0);
    assert.equal(
      await page.locator('a[href="#tournament-format"]').count(),
      soloId || teamId ? 1 : 0,
    );
    if (!soloId && !teamId) return;
    await centre.scrollIntoViewIfNeeded();
    await centre
      .getByRole("button", { name: soloId ? /^SOLO/ : /^TEAM/ })
      .waitFor();
    assert.equal(
      await centre.getByRole("button", { name: /^SOLO/ }).count(),
      soloId ? 1 : 0,
    );
    assert.equal(
      await centre.getByRole("button", { name: /^TEAM/ }).count(),
      teamId ? 1 : 0,
    );
    const selected = events.find((event) => event.id === (soloId ?? teamId))!;
    assert.ok((await centre.innerText()).includes(selected.name));
    if (soloId && teamId) {
      await centre.getByRole("button", { name: /^TEAM/ }).click();
      await centre.getByText(team.name, { exact: true }).waitFor();
      assert.ok((await centre.innerText()).includes(team.name));
    }
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1,
      ),
    );
  }
  await checkLanding(null, null);
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (const [soloId, teamId] of [
      [solo.id, null],
      [null, team.id],
      [solo.id, team.id],
      [null, null],
    ] as const) {
      await saveHighlights(soloId, teamId);
      await checkLanding(soloId, teamId);
    }
    await saveHighlights(replacement.id, team.id);
    await page
      .locator('form[data-action="landingHighlights"]')
      .screenshot({ path: `/tmp/pailangz-landing-highlights-${width}.png` });
    await checkLanding(replacement.id, team.id);
    await page
      .locator("#tournament-format")
      .screenshot({ path: `/tmp/pailangz-highlighted-events-${width}.png` });
    console.log(
      `PASS ${width}px staff controls persist SOLO only, TEAM only, both, none and replacement; landing visibility and format tabs match`,
    );
  }
  await page.goto(`${origin}/moderator/tournaments`);
  for (const data of [
    { soloId: [solo.id, replacement.id], teamId: team.id },
    { soloId: team.id, teamId: null },
  ]) {
    const status = await page.evaluate(
      async (data: unknown) =>
        (
          await fetch("/api/staff", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "landingHighlights", data }),
          })
        ).status,
      data,
    );
    assert.equal(status, 400);
  }
  await checkLanding(replacement.id, team.id);
  assert.deepEqual(errors, []);
  console.log(
    "PASS forged multiple or wrong-format selections are rejected and preserve the saved highlights",
  );
} finally {
  await browser.close();
  await owner.$disconnect();
}
