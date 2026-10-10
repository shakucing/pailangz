import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { hash } from "bcryptjs";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { configuration } from "../src/lib/tournament-config";

// Run through web-isolated.ts --stage-progression against disposable records.
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
  const tournament = await owner.tournament.findUniqueOrThrow({
    where: { slug: "pailangz-solo-team" },
    include: {
      categories: { include: { stages: { where: { archived: false } } } },
      participants: { orderBy: { code: "asc" }, include: { member: true } },
    },
  });
  const config = configuration(tournament.configuration);
  const solo = tournament.categories.find((c) => c.kind === "SOLO")!;
  const league = solo.stages.find((s) => s.key === "league")!;
  const qualification = solo.stages.find((s) => s.key === "qualification")!;
  const knockout = solo.stages.find((s) => s.key === "knockout")!;
  const player = tournament.participants[config.directSlots];
  const opponent = tournament.participants[config.directSlots + 1];
  const playerLabel = `${player.code} · ${player.member.displayIgn}`;
  const leagueMatch = await owner.match.findFirstOrThrow({
    where: {
      round: { stageId: league.id },
      OR: [{ sideAId: player.id }, { sideBId: player.id }],
    },
  });
  const round = await owner.round.create({
    data: { stageId: qualification.id, number: 1, name: "Qualification" },
  });
  const qualificationMatch = await owner.match.create({
    data: {
      roundId: round.id,
      order: 1,
      bestOf: 3,
      sideAId: player.id,
      sideBId: opponent.id,
    },
  });
  for (const match of [leagueMatch, qualificationMatch]) {
    const win = match.id === leagueMatch.id;
    const sideA = player.id === match.sideAId;
    const result = await owner.resultVersion.create({
      data: {
        matchId: match.id,
        version: 1,
        outcome: win ? (sideA ? "A_WIN" : "B_WIN") : "DRAW",
        status: "ACCEPTED",
        submittedBy: "SYNTHETIC_STAGE_PROGRESSION",
        acceptedBy: "SYNTHETIC_STAGE_PROGRESSION",
        reason: "PRIVATE_RESULT_REASON_CANARY",
        idempotencyKey: randomUUID(),
        games: {
          create: [1, 2].map((number) => ({
            number,
            scoreA: win ? (sideA ? 1 : 0) : number === 1 ? 1 : 0,
            scoreB: win ? (sideA ? 0 : 1) : number === 1 ? 0 : 1,
          })),
        },
      },
    });
    await owner.match.update({
      where: { id: match.id },
      data: { status: "FINALIZED", currentResultId: result.id },
    });
  }
  const rankings = tournament.participants.map((p, i) => ({
    id: p.id,
    code: p.code,
    ign: p.member.displayIgn,
    rank: i + 1,
    points: 0,
  }));
  for (const [stageId, rows] of [
    [league.id, rankings],
    [
      qualification.id,
      rankings.slice(
        config.directSlots,
        config.directSlots + config.playoffEntrants,
      ),
    ],
  ] as const)
    await owner.rankingSnapshot.create({
      data: {
        stageId,
        version: 1,
        rankings: rows,
        frozenBy: "SYNTHETIC_STAGE_PROGRESSION",
      },
    });
  await owner.stage.update({
    where: { id: knockout.id },
    data: { rules: { knockoutPairing: "manual" } },
  });

  for (const role of ["ADMIN", "MODERATOR"] as const) {
    const email = `progression-${randomUUID()}@synthetic.invalid`;
    const password = randomBytes(24).toString("base64url");
    await owner.staffUser.create({
      data: {
        name: "Disposable browser QA stage progression",
        email,
        passwordHash: await hash(password, 12),
        role,
      },
    });
    for (const width of [1280, 390]) {
      const carry = width === 390;
      await owner.stage.update({
        where: { id: qualification.id },
        data: {
          rules: { qualificationCarry: carry, qualificationPairing: "manual" },
          confirmedRules: ["qualificationCarry"],
        },
      });
      const context = await browser.newContext({
        viewport: { width, height: 900 },
      });
      await context.addCookies([
        { name: "pailangz_locale", value: "en", url: origin },
      ]);
      const page = await context.newPage();
      const errors: string[] = [];
      page.on("pageerror", (error: Error) => errors.push(error.message));
      page.setDefaultTimeout(15000);
      await page.goto(`${origin}/staff`);
      await page.getByLabel("Staff email").fill(email);
      await page.locator('input[name="password"]').fill(password);
      await page.getByRole("button", { name: "Enter staff portal" }).click();
      const area = role.toLowerCase();
      await page.waitForURL(new RegExp(`/${area}$`));
      await page.goto(`${origin}/${area}/tournaments?id=${tournament.id}`);
      await page.getByRole("tab", { name: "Rules & stages" }).click();
      const cards = page.locator(".tournament-stage-card");
      assert.deepEqual(await cards.locator("h3").allTextContents(), [
        league.name,
        qualification.name,
        knockout.name,
        ...tournament.categories
          .filter((category) => category.kind === "TEAM")
          .flatMap((category) => category.stages.map((stage) => stage.name)),
      ]);
      assert.deepEqual(
        await cards
          .locator(".tournament-stage-badges > :first-child")
          .allTextContents(),
        ["Completed", "Completed", "Current stage", "Current stage"],
      );
      assert.equal(
        await cards
          .filter({ hasText: knockout.name })
          .getAttribute("aria-current"),
        "step",
      );
      assert.equal(
        await cards
          .filter({ hasText: knockout.name })
          .evaluate((element: HTMLElement) =>
            element.classList.contains("is-current"),
          ),
        true,
      );
      const progressionButton = (name: string) =>
        cards
          .filter({ has: page.getByRole("heading", { name, exact: true }) })
          .getByRole("button", {
            name: "Manage stage progression",
            exact: true,
          });
      if (process.env.PAILANGZ_QA_SCREENSHOT_DIR)
        await page.screenshot({
          path: `${process.env.PAILANGZ_QA_SCREENSHOT_DIR}/stage-cards-${area}-${width}.png`,
          fullPage: true,
        });
      await progressionButton(league.name).click();
      const progression = page.getByRole("dialog", {
        name: `Stage progression · ${league.name}`,
        exact: true,
      });
      const order = progression.locator('input[name="rankedIds"]');
      const originalOrder = await order.inputValue();
      const trigger = progression.getByRole("button", {
        name: playerLabel,
        exact: true,
      });
      assert.equal(await trigger.getAttribute("type"), "button");
      assert.equal(await trigger.getAttribute("aria-haspopup"), "dialog");
      assert.match(await trigger.locator("..").innerText(), /3 points/);
      await trigger.focus();
      await trigger.press("Enter");
      const results = page.getByRole("dialog", {
        name: playerLabel,
        exact: true,
      });
      await results.waitFor({ state: "visible" });
      assert.deepEqual(
        await results.locator("section > h3").allTextContents(),
        carry ? ["League & Qualification"] : ["League", "Qualification"],
      );
      assert.ok(
        (await results.innerText()).includes(
          carry ? "Total points\n4" : "Total league points\n3",
        ),
      );
      assert.ok((await results.innerText()).includes("2–0"));
      assert.ok((await results.innerText()).includes("Awaiting result"));
      assert.ok(
        await results.evaluate(
          (element: HTMLElement) => element.scrollWidth <= element.clientWidth,
        ),
      );
      assert.ok(
        !(await page.content()).includes("PRIVATE_RESULT_REASON_CANARY"),
      );
      await page.keyboard.press("Escape");
      await results.waitFor({ state: "detached" });
      assert.equal(await order.inputValue(), originalOrder);
      assert.equal(
        await trigger.evaluate(
          (button: HTMLElement) => button === document.activeElement,
        ),
        true,
      );
      await progression
        .getByRole("button", { name: "Close dialog", exact: true })
        .click();
      await progression.waitFor({ state: "detached" });

      // Opening results is read-only; actual ranking edits still survive it.
      await progressionButton(league.name).click();
      await progression.locator(".order-buttons button").nth(1).click();
      const changedOrder = await order.inputValue();
      assert.notEqual(changedOrder, originalOrder);
      await trigger.click();
      await results.getByRole("button", { name: "Close", exact: true }).click();
      assert.equal(await order.inputValue(), changedOrder);
      await progression
        .getByRole("button", { name: "Close dialog", exact: true })
        .click();
      await progression
        .getByRole("button", { name: "Discard changes", exact: true })
        .click();

      // The playoff pool and manual SOLO seeding use the same results dialog.
      for (const stage of [qualification, knockout]) {
        await progressionButton(stage.name).click();
        const dialog = page.getByRole("dialog", {
          name: `Stage progression · ${stage.name}`,
          exact: true,
        });
        const name = dialog.getByRole("button", {
          name: playerLabel,
          exact: true,
        });
        assert.ok(await name.count());
        await name.last().click();
        await results.waitFor({ state: "visible" });
        await results
          .getByRole("button", { name: "Close dialog", exact: true })
          .click();
        await dialog
          .getByRole("button", { name: "Close dialog", exact: true })
          .click();
        await dialog.waitFor({ state: "detached" });
      }
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      );
      assert.deepEqual(errors, []);
      console.log(
        `PASS ${role} ${width}px: stage player results, carry totals, keyboard/close/focus, unchanged and edited rankings, playoff names, SOLO seeding, privacy and layout`,
      );
      await context.close();
    }
  }
} finally {
  await browser.close();
  await owner.$disconnect();
}
