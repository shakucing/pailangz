import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { hash } from "bcryptjs";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { createStages } from "../src/lib/configuration";
import { newTournamentConfiguration as soloDefaults } from "../src/lib/tournament-config";
import { RULE_LABELS } from "../src/lib/domain";

// Run through web-isolated.ts --readiness-dialogs. PLAYWRIGHT_MODULE can point
// to the desktop's bundled package when Playwright is not installed locally.
assert.equal(process.env.PAILANGZ_ISOLATED_WEB_TEST, "true");
const { format: _format, ...newTournamentConfiguration } = soloDefaults;

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
  const email = `readiness-${randomUUID()}@synthetic.invalid`;
  const password = randomBytes(24).toString("base64url");
  await owner.staffUser.create({
    data: {
      name: "Disposable browser QA readiness",
      email,
      passwordHash: await hash(password, 12),
      role: "MODERATOR",
    },
  });
  const config = {
    ...newTournamentConfiguration,
    teamCapacity: 6,
    bracketByePolicy: "seeded_top" as const,
  };
  const tournament = await owner.tournament.create({
    data: {
      name: "Readiness dialog QA cup",
      slug: `readiness-${randomUUID()}`,
      overview: "Synthetic browser regression event",
      configuration: config,
    },
  });
  await owner.$transaction((tx) => createStages(tx, tournament.id, config));
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  await context.addCookies([
    { name: "pailangz_locale", value: "en", url: origin },
  ]);
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  async function checkTarget(selector: string) {
    const dialog = page.getByRole("dialog");
    const target = dialog.locator(selector);
    await page.waitForFunction((selector: string) => {
      const dialog = document.querySelector("dialog[open]");
      const target = dialog?.querySelector(selector);
      const highlight = dialog?.querySelector('[class*="highlight"]');
      if (!target || !highlight?.contains(target)) return false;
      const control = document.activeElement as HTMLElement;
      if (!highlight.contains(control)) return false;
      const body = dialog?.querySelector('[class*="body"]');
      if (!body) return false;
      const bounds = control.getBoundingClientRect();
      const viewport = body.getBoundingClientRect();
      const header = dialog?.querySelector("header")?.getBoundingClientRect();
      const footer = dialog?.querySelector("footer")?.getBoundingClientRect();
      const modal = dialog?.getBoundingClientRect();
      return (
        bounds.top >= viewport.top &&
        bounds.bottom <= viewport.bottom &&
        !!header &&
        !!footer &&
        !!modal &&
        header.top >= modal.top &&
        footer.bottom <= modal.bottom
      );
    }, selector);
    assert.equal(await target.count(), 1);
    assert.equal(await dialog.locator('[class*="highlight"]').count(), 1);
  }
  const errors: string[] = [];
  page.on("pageerror", (error: Error) => errors.push(error.message));
  await page.goto(`${origin}/staff`);
  await page.getByLabel("Staff email").fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole("button", { name: "Enter staff portal" }).click();
  await page.waitForURL(/\/moderator$/);
  const workspace = `${origin}/moderator/tournaments?id=${tournament.id}`;
  await page.goto(workspace);
  const checklist = page.locator(".tournament-readiness");
  await checklist
    .getByText("View readiness checklist", { exact: true })
    .click();
  let opened = 0;
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({
      reducedMotion: width === 390 ? "reduce" : "no-preference",
    });
    for (const [key, label] of Object.entries(RULE_LABELS)) {
      // Begin on a different tab to exercise launching hidden task content.
      await page.getByRole("tab", { name: "Sizes & updates" }).click();
      const trigger = checklist
        .getByRole("button", { name: label, exact: true })
        .last();
      assert.equal(await trigger.getAttribute("aria-haspopup"), "dialog");
      if (key === "gameTitle") {
        await trigger.focus();
        await trigger.press("Enter");
      } else await trigger.click();
      const dialog = page.getByRole("dialog");
      await dialog.waitFor({ state: "visible" });
      if (["dates", "gameTitle"].includes(key)) {
        assert.match(
          await dialog.getByRole("heading").innerText(),
          /Overview & schedule/,
        );
        assert.equal(
          await dialog
            .locator(
              `input[name="${key === "dates" ? "startsAt" : "gameTitle"}"]`,
            )
            .isVisible(),
          true,
        );
      } else {
        assert.equal(
          await dialog.locator('[name="confirmedRules"]').count(),
          0,
        );
        const stage = key.startsWith("qualification")
          ? "SOLO · Qualification"
          : key === "knockoutPairing"
            ? "SOLO · Knockout"
            : key === "teamSeeding"
              ? "TEAM · Knockout"
              : "SOLO · 6-round league";
        assert.equal(
          await dialog.getByRole("heading").innerText(),
          `Tournament rules · ${stage}`,
        );
        assert.equal(await dialog.locator(`[name="rule:${key}"]`).count(), 1);
      }
      await checkTarget(
        `[name="${key === "dates" ? "startsAt" : key === "gameTitle" ? key : `rule:${key}`}"]`,
      );
      if (width === 390 && key === "disputeDeadline")
        await page.screenshot({
          path: "/tmp/pailangz-readiness-highlight-mobile.png",
        });
      if (width === 1280 && key === "gameTitle") {
        await dialog
          .locator('[class*="highlight"]')
          .waitFor({ state: "detached", timeout: 5000 });
        assert.equal(
          await dialog
            .getByLabel(/^Game title/)
            .evaluate(
              (element: HTMLElement) => document.activeElement === element,
            ),
          true,
        );
      }
      await page.keyboard.press("Escape");
      await dialog.waitFor({ state: "hidden" });
      assert.equal(
        await trigger.evaluate(
          (element: HTMLElement) => document.activeElement === element,
        ),
        true,
      );
      opened++;
    }
    for (const [label, heading, selector] of [
      [
        "Player list confirmed",
        "Player list confirmation",
        '[data-action="mapping"] button[type="submit"]',
      ],
      [
        "32 approved and eligible SOLO players",
        "Assign players",
        'input[type="search"]',
      ],
      [
        "6 teams with four eligible players each",
        "Create a team",
        '[name="name"]',
      ],
      [
        "League schedule matches configured capacity, rounds and match quota",
        "Assign players",
        '[data-action="generateLeague"] button[type="submit"]',
      ],
      [
        "Explicit bye policies confirmed on affected stages",
        "Tournament rules · TEAM · Knockout",
        '[name="rule:byePolicy"]',
      ],
    ]) {
      await page.getByRole("tab", { name: "Overview & schedule" }).click();
      await checklist
        .getByRole("button", { name: label, exact: true })
        .last()
        .click();
      const dialog = page.getByRole("dialog");
      await dialog.waitFor({ state: "visible" });
      assert.ok(
        (await dialog.getByRole("heading").first().innerText()).startsWith(
          heading,
        ),
      );
      if (label.startsWith("Explicit bye"))
        assert.equal(
          await dialog.locator('[name="rule:byePolicy"]').isVisible(),
          true,
        );
      await checkTarget(selector);
      await dialog
        .getByRole("button", { name: "Close dialog", exact: true })
        .click();
      await dialog.waitFor({ state: "hidden" });
      opened++;
    }
  }
  // The compact list also launches a dialog, and unsaved edits still prompt.
  const compact = checklist
    .getByRole("button", { name: RULE_LABELS.gameTitle, exact: true })
    .first();
  await compact.click();
  let dialog = page.getByRole("dialog");
  await checkTarget('[name="gameTitle"]');
  await dialog.getByLabel(/^Game title/).fill("Unsaved QA title");
  await page.keyboard.press("Escape");
  await dialog.getByText("Discard unsaved changes?", { exact: true }).waitFor();
  await dialog.getByRole("button", { name: "Keep editing" }).click();
  assert.equal(
    await dialog.getByLabel(/^Game title/).inputValue(),
    "Unsaved QA title",
  );
  await page.keyboard.press("Escape");
  await dialog.getByRole("button", { name: "Discard changes" }).click();
  await dialog.waitFor({ state: "hidden" });
  await compact.click();
  assert.equal(
    await page
      .getByRole("dialog")
      .getByLabel(/^Game title/)
      .inputValue(),
    "",
  );
  await page.keyboard.press("Escape");
  // A full roster must open eligibility review, rather than an assignment form.
  for (let index = 1; index <= 32; index++) {
    const member = await owner.member.create({
      data: {
        displayIgn: `Readiness QA ${index}`,
        canonicalIgn: `readiness-qa-${index}`,
        verified: true,
      },
    });
    await owner.participant.create({
      data: {
        tournamentId: tournament.id,
        memberId: member.id,
        code: `P${String(index).padStart(2, "0")}`,
      },
    });
  }
  await page.reload();
  await checklist
    .getByText("View readiness checklist", { exact: true })
    .click();
  await checklist
    .getByRole("button", {
      name: "32 approved and eligible SOLO players",
      exact: true,
    })
    .click();
  dialog = page.getByRole("dialog");
  await dialog.waitFor({ state: "visible" });
  assert.ok(
    (await dialog.getByRole("heading").first().innerText()).startsWith(
      "Player eligibility",
    ),
  );
  assert.equal(
    await dialog.getByLabel("Select all assigned players").isVisible(),
    true,
  );
  await checkTarget('[aria-label="Select all assigned players"]');
  assert.equal(
    await dialog
      .getByRole("button", { name: "Ineligible", exact: true })
      .count(),
    32,
  );
  const firstPlayer = await owner.participant.findFirstOrThrow({
    where: { tournamentId: tournament.id },
    orderBy: { code: "asc" },
    include: { member: true },
  });
  const toggleRow = page.getByRole("row").filter({
    has: page.getByText(firstPlayer.member.displayIgn, { exact: true }),
  });
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (const eligible of [true, false]) {
      const response = page.waitForResponse(
        (response: {
          url: () => string;
          request: () => { method: () => string };
        }) =>
          response.url().endsWith("/api/staff") &&
          response.request().method() === "POST",
      );
      await toggleRow
        .getByRole("button", {
          name: eligible ? "Ineligible" : "Eligible",
          exact: true,
        })
        .click();
      assert.equal((await response).status(), 200);
      const toggle = toggleRow.getByRole("button", {
        name: eligible ? "Eligible" : "Ineligible",
        exact: true,
      });
      await toggle.waitFor();
      assert.equal(await toggle.getAttribute("aria-pressed"), String(eligible));
      assert.equal(
        (
          await owner.participant.findUniqueOrThrow({
            where: { id: firstPlayer.id },
          })
        ).eligible,
        eligible,
      );
      assert.equal(
        await page.getByRole("dialog").count(),
        1,
        "Eligibility toggles without opening another dialog",
      );
      if (eligible)
        await page.screenshot({
          path: `/tmp/pailangz-player-toggles-${width}.png`,
        });
    }
  }
  console.log(
    "PASS desktop/mobile eligibility toggles persist both states with one click and no additional dialog",
  );
  await page.keyboard.press("Escape");
  const teamCategory = await owner.category.findFirstOrThrow({
    where: { tournamentId: tournament.id, kind: "TEAM" },
  });
  await owner.team.create({
    data: { categoryId: teamCategory.id, name: "Incomplete QA roster" },
  });
  await owner.tournament.update({
    where: { id: tournament.id },
    data: {
      startsAt: new Date("2026-11-01T00:00:00Z"),
      gameTitle: "Confirmed QA game",
    },
  });
  await page.reload();
  await checklist
    .getByText("View readiness checklist", { exact: true })
    .click();
  await checklist
    .getByRole("button", { name: RULE_LABELS.dates, exact: true })
    .last()
    .click();
  await checkTarget('[name="registrationDeadline"]');
  await page.keyboard.press("Escape");
  const completed = checklist
    .locator(".check.done")
    .getByRole("button", { name: RULE_LABELS.gameTitle, exact: true });
  await completed.click();
  await checkTarget('[name="gameTitle"]');
  assert.equal(
    await page
      .getByRole("dialog")
      .getByLabel(/^Game title/)
      .inputValue(),
    "Confirmed QA game",
  );
  await page.keyboard.press("Escape");
  // Saving configured rules confirms them without separate checkboxes.
  const league = await owner.stage.findFirstOrThrow({
    where: {
      category: { tournamentId: tournament.id, kind: "SOLO" },
      key: "league",
    },
  });
  for (const value of ["no_draws", "no_draws", ""]) {
    await checklist
      .getByRole("button", { name: RULE_LABELS.drawPolicy, exact: true })
      .last()
      .click();
    const rulesDialog = page.getByRole("dialog");
    assert.equal(
      await rulesDialog.locator('[name="confirmedRules"]').count(),
      0,
    );
    await rulesDialog.locator('[name="rule:drawPolicy"]').selectOption(value);
    const response = page.waitForResponse(
      (response: {
        url: () => string;
        request: () => { method: () => string };
      }) =>
        response.url().endsWith("/api/staff") &&
        response.request().method() === "POST",
    );
    await rulesDialog
      .getByRole("button", { name: "Save rules", exact: true })
      .click();
    assert.equal((await response).status(), 200);
    await rulesDialog.getByText("Saved.", { exact: true }).waitFor();
    const saved = await owner.stage.findUniqueOrThrow({
      where: { id: league.id },
    });
    assert.equal(saved.confirmedRules.includes("drawPolicy"), !!value);
    assert.equal(
      (saved.rules as Record<string, unknown>).drawPolicy,
      value || undefined,
    );
    await page.keyboard.press("Escape");
    await rulesDialog.waitFor({ state: "hidden" });
    await page.reload();
    await checklist
      .getByText("View readiness checklist", { exact: true })
      .click();
    const row = checklist.locator("details .check").filter({
      has: page.getByRole("button", {
        name: RULE_LABELS.drawPolicy,
        exact: true,
      }),
    });
    assert.equal((await row.getAttribute("class"))?.includes("done"), !!value);
  }
  await checklist
    .getByRole("button", { name: "6 teams with four eligible players each" })
    .click();
  await checkTarget('input[type="search"]');
  assert.match(
    await page.getByRole("dialog").getByRole("heading").innerText(),
    /Edit roster · Incomplete QA roster/,
  );
  await page
    .getByRole("dialog")
    .getByRole("link", { name: "View all teams" })
    .click();
  await page.waitForURL(/\/moderator\/teams$/);

  // Removal must use the entrant ID rather than its separate signup ID and
  // free capacity without deleting community membership or signup history.
  const [signupPlayer, assignedPlayer] = await owner.participant.findMany({
    where: { tournamentId: tournament.id },
    orderBy: { code: "asc" },
    take: 2,
    include: { member: true },
  });
  const signup = await owner.participationRequest.create({
    data: { tournamentId: tournament.id, memberId: signupPlayer.memberId },
  });
  assert.notEqual(signup.id, signupPlayer.id);
  await owner.tournament.update({
    where: { id: tournament.id },
    data: {
      registrationEnabled: true,
      status: "REGISTRATION_OPEN",
      published: true,
    },
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(
    `${origin}/moderator/participation?q=${encodeURIComponent(signupPlayer.member.displayIgn)}`,
  );
  const signupRow = page.getByRole("row").filter({
    has: page.getByText(signupPlayer.member.displayIgn, { exact: true }),
  });
  await signupRow.waitFor();
  assert.equal(
    await signupRow
      .getByRole("button", { name: "Remove player", exact: true })
      .isEnabled(),
    false,
  );
  await owner.tournament.update({
    where: { id: tournament.id },
    data: { published: false },
  });
  const [beforeRemoval] = await owner.$queryRaw<{ status: string }[]>`
    SELECT app_participation_status(${tournament.slug}) AS status
  `;
  assert.equal(beforeRemoval.status, "FULL");
  await page.reload();
  await signupRow
    .getByRole("button", { name: "Remove player", exact: true })
    .click();
  let removal = page.getByRole("dialog");
  await removal
    .getByLabel("Reason", { exact: true })
    .fill("Player cannot attend");
  assert.ok(
    await removal
      .locator('[class*="body"]')
      .evaluate(
        (element: HTMLElement) =>
          element.scrollWidth <= element.clientWidth + 1,
      ),
  );
  await page.screenshot({ path: "/tmp/pailangz-remove-player-desktop.png" });
  let removed = page.waitForResponse(
    (response: {
      url: () => string;
      request: () => { method: () => string };
    }) =>
      response.url().endsWith("/api/staff") &&
      response.request().method() === "POST",
  );
  await removal
    .getByRole("button", { name: "Remove player from tournament", exact: true })
    .click();
  let removalResponse = await removed;
  assert.equal(removalResponse.status(), 200);
  assert.equal(
    removalResponse.request().postDataJSON().data.id,
    signupPlayer.id,
  );
  await signupRow
    .getByText(`${signupPlayer.code} · Withdrawn`, { exact: true })
    .waitFor();
  assert.equal(
    await signupRow
      .getByRole("button", { name: "Remove player", exact: true })
      .count(),
    0,
  );
  assert.equal(
    (
      await owner.participant.findUniqueOrThrow({
        where: { id: signupPlayer.id },
      })
    ).withdrawn,
    true,
  );
  assert.equal(
    await owner.member.count({
      where: { id: signupPlayer.memberId, verified: true, archived: false },
    }),
    1,
  );
  assert.equal(
    await owner.participationRequest.count({ where: { id: signup.id } }),
    1,
  );
  const [availability] = await owner.$queryRaw<
    { status: string }[]
  >`SELECT app_participation_status(${tournament.slug}) AS status`;
  assert.equal(availability.status, "OPEN");

  // The same action works from the assigned-player dialog on mobile.
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto(workspace);
  await page.getByRole("tab", { name: "Players & teams", exact: true }).click();
  await page
    .getByRole("button", {
      name: "Review assigned players & eligibility",
      exact: true,
    })
    .click();
  const playerRow = page.getByRole("row").filter({
    has: page.getByText(assignedPlayer.member.displayIgn, { exact: true }),
  });
  await playerRow
    .getByRole("button", { name: "Remove player", exact: true })
    .click();
  removal = page.getByRole("dialog", {
    name: `Remove player · ${assignedPlayer.code} · ${assignedPlayer.member.displayIgn}`,
    exact: true,
  });
  await removal
    .getByLabel("Reason", { exact: true })
    .fill("Free a place for another player");
  assert.ok(
    await removal
      .locator('[class*="body"]')
      .evaluate(
        (element: HTMLElement) =>
          element.scrollWidth <= element.clientWidth + 1,
      ),
  );
  await page.screenshot({ path: "/tmp/pailangz-remove-player-mobile.png" });
  removed = page.waitForResponse(
    (response: {
      url: () => string;
      request: () => { method: () => string };
    }) =>
      response.url().endsWith("/api/staff") &&
      response.request().method() === "POST",
  );
  await removal
    .getByRole("button", { name: "Remove player from tournament", exact: true })
    .click();
  removalResponse = await removed;
  assert.equal(removalResponse.status(), 200);
  await page
    .getByRole("heading", { name: "Assigned players · 30 of 32", exact: true })
    .waitFor();
  assert.equal(await playerRow.count(), 0);
  assert.equal(
    (
      await owner.participant.findUniqueOrThrow({
        where: { id: assignedPlayer.id },
      })
    ).withdrawn,
    true,
  );
  assert.equal(
    await owner.auditEvent.count({
      where: {
        entityId: { in: [signupPlayer.id, assignedPlayer.id] },
        action: "PARTICIPANT_WITHDRAW",
      },
    }),
    2,
  );
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();
  console.log(
    "PASS desktop signup removal and mobile assigned-player removal free slots, retain members/history, record audits and prevent published edits",
  );
  assert.deepEqual(errors, []);
  console.log(
    `${opened + 9} readiness dialog checks passed at desktop and mobile widths; saving confirms configured rules, repeated saves retain confirmation, clearing restores incomplete readiness, scrolling, temporary highlights, completed items, reduced motion, keyboard, focus restoration, unsaved changes and team navigation passed.`,
  );
} finally {
  await browser.close();
  await owner.$disconnect();
}
