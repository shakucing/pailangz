import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { hash } from "bcryptjs";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { newTournamentConfiguration } from "../src/lib/tournament-config";

// Run with web-isolated.ts --live-results; never use real tournament records.
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
  const tournament = await owner.tournament.create({
    data: {
      name: "Live results QA cup",
      slug: `live-${randomUUID()}`,
      overview: "Synthetic live results regression",
      published: true,
      status: "IN_PROGRESS",
      configuration: newTournamentConfiguration,
    },
  });
  const players: {
    id: string;
    code: string;
    member: { displayIgn: string };
  }[] = [];
  for (const code of ["P01", "P02"]) {
    const member = await owner.member.create({
      data: {
        displayIgn: `Live ${code}`,
        canonicalIgn: `live-${randomUUID()}`,
        verified: true,
      },
    });
    players.push(
      await owner.participant.create({
        data: {
          tournamentId: tournament.id,
          memberId: member.id,
          code,
          eligible: true,
          provisional: false,
        },
        include: { member: true },
      }),
    );
  }
  const category = await owner.category.create({
    data: { tournamentId: tournament.id, kind: "SOLO", capacity: 32 },
  });
  const stage = await owner.stage.create({
    data: {
      categoryId: category.id,
      key: "league",
      name: "Live league",
      format: "LEAGUE",
      bestOf: 3,
      published: true,
      rules: { seriesPoints: true, drawPolicy: "no_draw" },
      confirmedRules: ["seriesPoints", "drawPolicy"],
    },
  });
  for (const number of [1, 2]) {
    await owner.round.create({
      data: {
        stageId: stage.id,
        number,
        name: `Round ${number}`,
        matches: {
          create: {
            order: 1,
            sideAId: players[0].id,
            sideBId: players[1].id,
            bestOf: 3,
          },
        },
      },
    });
  }
  const match = await owner.match.findFirstOrThrow({
    where: { round: { stageId: stage.id, number: 2 } },
  });
  await owner.landingHighlight.upsert({
    where: { format: "SOLO" },
    create: { format: "SOLO", tournamentId: tournament.id },
    update: { tournamentId: tournament.id },
  });
  const name = (id: string) => {
    const p = players.find((p) => p.id === id)!;
    return `${p.code} · ${p.member.displayIgn}`;
  };
  const sideA = name(match.sideAId!),
    sideB = name(match.sideBId!);
  const errors: string[] = [];
  async function newPage(role?: "ADMIN" | "MODERATOR") {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
    });
    await context.addCookies([
      { name: "pailangz_locale", value: "en", url: origin },
    ]);
    const page = await context.newPage();
    page.setDefaultTimeout(25000);
    page.on("pageerror", (error: Error) => errors.push(error.message));
    if (role) {
      const email = `live-${randomUUID()}@synthetic.invalid`;
      const password = randomBytes(24).toString("base64url");
      await owner.staffUser.create({
        data: {
          name: "Live results QA",
          email,
          role,
          passwordHash: await hash(password, 12),
        },
      });
      await page.goto(`${origin}/staff`);
      await page.getByLabel("Staff email").fill(email);
      await page.locator('input[name="password"]').fill(password);
      await page.getByRole("button", { name: "Enter staff portal" }).click();
      await page.waitForURL(new RegExp(`/${role.toLowerCase()}$`));
      await page.goto(
        `${origin}/${role.toLowerCase()}/matches?stageId=${stage.id}&round=2&standings=true`,
      );
    } else {
      await page.goto(origin);
      await page.getByRole("button", { name: "Round 2", exact: true }).click();
    }
    return page;
  }
  const landing = await newPage();
  const observer = await newPage("MODERATOR");
  const writer = await newPage("ADMIN");
  const pages = [landing, observer, writer];
  let documentRequests = 0;
  for (const page of pages) {
    page.on("request", (request: { resourceType(): string }) => {
      if (request.resourceType() === "document") documentRequests++;
    });
  }
  const landingRow = landing.locator("#tournament-format tbody tr").first();
  const observerCard = observer.locator("article.panel").first();
  const writerCard = writer.locator("article.panel").first();
  const originalUrl = observer.url();
  const scrollY = await landing.evaluate(() => window.scrollY);

  async function save(winner: string, correction = false) {
    await writerCard
      .getByRole("button", { name: "Enter / correct result", exact: true })
      .click();
    const dialog = writer.getByRole("dialog", {
      name: "Enter / correct result",
      exact: true,
    });
    for (const number of [1, 2])
      await dialog
        .getByRole("button", {
          name: `Pick ${winner} as winner of Game ${number}`,
          exact: true,
        })
        .click();
    if (correction)
      await dialog
        .getByLabel("Reason for forfeit / correction")
        .fill("Corrected after checking the score.");
    await dialog
      .getByRole("button", { name: "Save & confirm", exact: true })
      .click();
    await dialog
      .getByText("Result saved and confirmed.", { exact: true })
      .waitFor();
    await dialog
      .getByRole("button", { name: "Close dialog", exact: true })
      .click();
  }

  await save(sideA);
  await landingRow.getByText("2–0", { exact: true }).waitFor();
  await observerCard.getByText("Result confirmed", { exact: false }).waitFor();
  await observerCard
    .getByText(`Game 1: ${sideA} wins`, { exact: false })
    .waitFor();
  assert.equal(
    await landing
      .getByRole("button", { name: "Round 2", exact: true })
      .getAttribute("aria-pressed"),
    "true",
  );
  assert.equal(observer.url(), originalUrl);
  assert.ok(
    Math.abs((await landing.evaluate(() => window.scrollY)) - scrollY) < 5,
  );
  assert.equal(documentRequests, 0);
  console.log(
    "PASS confirmed results arrive on the landing page and another staff tab without navigation; round, filters and scroll remain intact",
  );

  await observerCard
    .getByRole("button", { name: "Enter / correct result", exact: true })
    .click();
  const editor = observer.getByRole("dialog", {
    name: "Enter / correct result",
    exact: true,
  });
  const draft = editor.getByLabel("Reason for forfeit / correction");
  await draft.fill("Unfinished staff note");
  // Move focus away from the textarea: the entire editor must stay protected.
  await editor.getByRole("heading").click();
  await save(sideB, true);
  await landingRow.getByText("0–2", { exact: true }).waitFor();
  await observer.waitForTimeout(11000);
  assert.equal(await draft.inputValue(), "Unfinished staff note");
  assert.ok((await observerCard.innerText()).includes(`Game 1: ${sideA} wins`));
  await editor
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();
  await editor
    .getByRole("button", { name: "Discard changes", exact: true })
    .click();
  await observerCard
    .getByText(`Game 1: ${sideB} wins`, { exact: false })
    .waitFor();
  assert.equal(documentRequests, 0);
  console.log(
    "PASS remote corrections preserve unsaved staff entries and appear after the editor closes",
  );

  // Read-only player dialogs should keep updating while open.
  await landingRow.getByRole("button", { name: sideA, exact: true }).click();
  const playerDialog = landing.getByRole("dialog", {
    name: sideA,
    exact: true,
  });
  await playerDialog.waitFor();
  await save(sideA, true);
  await landingRow.getByText("2–0", { exact: true }).waitFor();
  assert.equal(await playerDialog.isVisible(), true);
  await playerDialog
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();
  console.log("PASS read-only result dialogs remain open during live updates");

  // Set visibility on this test document to exercise suspension and catch-up.
  let refreshRequests = 0;
  landing.on("request", (request: { url(): string }) => {
    if (new URL(request.url()).searchParams.has("_rsc")) refreshRequests++;
  });
  await landing.evaluate(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await landing.waitForTimeout(11000);
  assert.equal(refreshRequests, 0);
  await landing.evaluate(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await landing.waitForRequest(
    (request: { url(): string }) =>
      new URL(request.url()).searchParams.has("_rsc"),
    { timeout: 15000 },
  );
  assert.equal(documentRequests, 0);
  assert.deepEqual(errors, []);
  console.log(
    "PASS hidden tabs stop checking and resume when visible; no full-page reloads or browser errors",
  );
} finally {
  await browser.close();
  await owner.$disconnect();
}
