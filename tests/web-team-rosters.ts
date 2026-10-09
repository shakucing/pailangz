import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { hash } from "bcryptjs";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { encrypt } from "../src/lib/crypto";
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
  const email = `rosters-${randomUUID()}@synthetic.invalid`,
    password = randomBytes(24).toString("base64url");
  await owner.staffUser.create({
    data: {
      name: "Roster browser moderator",
      email,
      passwordHash: await hash(password, 12),
      role: "MODERATOR",
    },
  });
  const event = await owner.tournament.create({
    data: {
      slug: `rosters-${randomUUID()}`,
      name: "Configurable TEAM rosters",
      overview: "Roster policy browser check",
      status: "REGISTRATION_OPEN",
      registrationEnabled: true,
      configuration: { ...newTournamentConfiguration, format: "TEAM" },
      categories: {
        create: {
          kind: "TEAM",
          capacity: 8,
          stages: {
            create: {
              key: "knockout",
              name: "TEAM · Knockout",
              format: "KNOCKOUT",
              bestOf: 5,
              rules: { seriesPoints: true },
            },
          },
        },
      },
    },
    include: { categories: true },
  });
  const team = await owner.team.create({
    data: { categoryId: event.categories[0].id, name: "Assigned team" },
  });
  const memberId = randomUUID(),
    ign = `Roster entrant ${randomUUID()}`,
    tiktokId = "private_roster_test";
  await owner.member.create({
    data: {
      id: memberId,
      displayIgn: ign,
      canonicalIgn: ign.toLowerCase(),
      verified: true,
      privateData: {
        create: {
          originalIgn: ign,
          registrationEncrypted: encrypt(
            JSON.stringify({ "Tiktok ID": tiktokId }),
            `member:${memberId}`,
          ),
        },
      },
    },
  });
  const staff = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  const publicContext = await browser.newContext();
  await staff.addCookies([
    { name: "pailangz_locale", value: "en", url: origin },
  ]);
  const page = await staff.newPage(),
    publicPage = await publicContext.newPage();
  const errors: string[] = [];
  for (const tab of [page, publicPage]) {
    tab.setDefaultTimeout(15000);
    tab.on("pageerror", (error: Error) => errors.push(error.message));
  }
  await page.goto(`${origin}/staff`);
  await page.getByLabel("Staff email").fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole("button", { name: "Enter staff portal" }).click();
  await page.waitForURL(/\/moderator$/);
  for (const mode of ["STAFF", "PLAYER", "STAFF"] as const) {
    await page.goto(`${origin}/moderator/tournaments?id=${event.id}`);
    await page
      .getByRole("button", { name: "Edit overview & schedule", exact: true })
      .click();
    const dialog = page.getByRole("dialog");
    await dialog
      .getByLabel("Team roster management", { exact: true })
      .selectOption(mode);
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    await dialog.getByText("Saved.", { exact: true }).waitFor();
    await dialog
      .getByRole("button", { name: "Close dialog", exact: true })
      .click();
    assert.equal(
      (await owner.tournament.findUniqueOrThrow({ where: { id: event.id } }))
        .teamRosterManagement,
      mode,
    );
    await page
      .locator("#tournament-registration-links")
      .getByText(
        mode === "STAFF"
          ? "Players register individually; staff create teams and assign rosters in Players & teams."
          : "Approved players can create teams and team owners review join requests.",
        { exact: false },
      )
      .waitFor();
    await page
      .getByRole("button", { name: "Edit overview & schedule", exact: true })
      .click();
    assert.equal(
      await page
        .getByLabel("Team roster management", { exact: true })
        .inputValue(),
      mode,
    );
    await page
      .getByRole("button", { name: "Close dialog", exact: true })
      .click();
    for (const [locale, width] of [
      ["en", 1280],
      ["en", 390],
      ["ms", 390],
    ] as const) {
      await publicContext.addCookies([
        { name: "pailangz_locale", value: locale, url: origin },
      ]);
      await publicPage.setViewportSize({ width, height: 900 });
      await publicPage.goto(`${origin}/participate/${event.slug}`);
      assert.equal(
        await publicPage.locator('form[action="/api/participation"]').count(),
        1,
      );
      if (mode === "STAFF")
        await publicPage
          .getByText(
            locale === "en"
              ? "Register as an individual player. Staff will form teams and assign players after registration."
              : "Daftar sebagai pemain individu. Pihak staf akan membentuk pasukan dan menetapkan pemain selepas pendaftaran.",
            { exact: true },
          )
          .waitFor();
      await publicPage.locator('input[name="ign"]').fill(ign);
      await publicPage.locator('input[name="tiktokId"]').fill(tiktokId);
      await publicPage
        .getByRole("button", {
          name: locale === "en" ? "Confirm participation" : "Sahkan penyertaan",
        })
        .click();
      await publicPage
        .getByRole("heading", {
          name:
            locale === "en"
              ? "Participation approved."
              : "Penyertaan diluluskan.",
        })
        .waitFor();
      const success = await publicPage
        .locator('[aria-live="polite"]')
        .innerText();
      assert.ok(
        success.includes(
          mode === "STAFF"
            ? locale === "en"
              ? "Staff will assign you to a team."
              : "Pihak staf akan menetapkan anda ke pasukan."
            : locale === "en"
              ? "You can now register a team or apply to join one."
              : "Anda boleh daftar pasukan atau mohon sertai pasukan.",
        ),
      );
      assert.ok(
        await publicPage.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth + 1,
        ),
      );
      await publicPage.screenshot({
        path: `/tmp/pailangz-roster-${mode.toLowerCase()}-${locale}-${width}.png`,
      });
      await publicPage.goto(`${origin}/tournaments/${event.slug}/teams`);
      assert.equal(
        await publicPage
          .getByRole("link", {
            name: locale === "en" ? "Register a team" : "Daftar pasukan",
            exact: true,
          })
          .count(),
        mode === "PLAYER" ? 1 : 0,
      );
      await publicPage.goto(
        `${origin}/tournaments/${event.slug}/teams/${team.slug}`,
      );
      assert.equal(
        await publicPage.locator('input[name="tiktokId"]').count(),
        mode === "PLAYER" ? 1 : 0,
      );
      if (mode === "STAFF")
        await publicPage
          .getByRole("heading", {
            name: locale === "en" ? "Team assignments" : "Penetapan pasukan",
          })
          .waitFor();
      await publicPage.goto(`${origin}/tournaments/${event.slug}/teams/new`);
      await publicPage.waitForURL(
        mode === "STAFF"
          ? `${origin}/participate/${event.slug}`
          : `${origin}/tournaments/${event.slug}/teams/new`,
      );
      assert.equal(
        new URL(publicPage.url()).pathname,
        mode === "STAFF"
          ? `/participate/${event.slug}`
          : `/tournaments/${event.slug}/teams/new`,
      );
    }
    console.log(
      `PASS moderator saves ${mode} roster management; individual entry, confirmation and team pages follow it in EN/BM on desktop/mobile`,
    );
  }
  assert.equal(
    await owner.participant.count({
      where: { tournamentId: event.id, memberId },
    }),
    1,
  );
  assert.equal(
    await owner.teamMembership.count({
      where: { memberId, categoryId: event.categories[0].id, active: true },
    }),
    0,
  );
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
  await owner.$disconnect();
}
