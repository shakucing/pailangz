import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { hash } from "bcryptjs";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

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
  const email = `formats-${randomUUID()}@synthetic.invalid`,
    password = randomBytes(24).toString("base64url");
  await owner.staffUser.create({
    data: {
      name: "Format browser QA",
      email,
      passwordHash: await hash(password, 12),
      role: "MODERATOR",
    },
  });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
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
  await page.waitForURL(/\/moderator$/);
  const created = new Map<
    "SOLO" | "TEAM",
    { id: string; slug: string; name: string }
  >();
  for (const format of ["SOLO", "TEAM"] as const) {
    await page.goto(`${origin}/moderator/tournaments`);
    await page
      .getByRole("button", { name: "Create tournament", exact: true })
      .click();
    const dialog = page.getByRole("dialog");
    const picker = dialog.getByLabel("Tournament format");
    assert.deepEqual(await picker.locator("option").allTextContents(), [
      "SOLO tournament",
      "TEAM tournament",
    ]);
    await picker.selectOption(format);
    const prefix = format.toLowerCase();
    const knockoutLength = dialog.locator(
      `input[name="${prefix}KnockoutBestOf"]`,
    );
    const finalLength = dialog.locator(`input[name="${prefix}FinalBestOf"]`);
    await knockoutLength.fill("5");
    await finalLength.fill("6");
    assert.equal(
      await finalLength.evaluate((input: HTMLInputElement) =>
        input.checkValidity(),
      ),
      false,
    );
    await finalLength.fill("7");
    assert.equal(
      await finalLength.evaluate((input: HTMLInputElement) =>
        input.checkValidity(),
      ),
      true,
    );
    assert.equal(
      await dialog
        .getByLabel("Number of SOLO players", { exact: true })
        .count(),
      format === "SOLO" ? 1 : 0,
    );
    assert.equal(
      await dialog.getByLabel("Number of teams", { exact: true }).count(),
      format === "TEAM" ? 1 : 0,
    );
    const name = `Browser ${format} ${randomUUID()}`;
    await dialog.getByLabel("Name", { exact: true }).fill(name);
    await dialog
      .getByLabel("Overview", { exact: true })
      .fill(`${format} independent event`);
    await dialog
      .getByRole("button", { name: "Create draft", exact: true })
      .click();
    await dialog.getByText("Saved.", { exact: true }).waitFor();
    await dialog
      .getByRole("button", { name: "Close dialog", exact: true })
      .click();
    const tournament = await owner.tournament.findFirstOrThrow({
      where: { name },
      include: { categories: { include: { stages: true } } },
    });
    created.set(format, tournament);
    const configured = tournament.configuration as Record<string, unknown>;
    assert.equal(configured[`${prefix}KnockoutBestOf`], 5);
    assert.equal(configured[`${prefix}FinalBestOf`], 7);
    assert.deepEqual(
      tournament.categories.map((c) => c.kind),
      [format],
    );
    await owner.tournament.update({
      where: { id: tournament.id },
      data: { registrationEnabled: true },
    });
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`${origin}/moderator/tournaments?id=${tournament.id}`);
      await page.locator(".tournament-presentation").waitFor();
      const progressionText = await page
        .locator(".tournament-presentation")
        .innerText();
      assert.ok(progressionText.includes("BO5"));
      assert.ok(progressionText.includes("BO7"));
      await page.getByText("View readiness checklist", { exact: true }).click();
      const checklist = await page.locator(".tournament-readiness").innerText();
      if (format === "SOLO") {
        assert.ok(checklist.includes("32 approved and eligible SOLO players"));
        assert.ok(!checklist.includes("teams with four"));
        assert.ok(!checklist.includes("Team lineups"));
        assert.equal(
          await page.getByRole("tab", { name: "Players", exact: true }).count(),
          1,
        );
      } else {
        assert.ok(
          checklist.includes("8 teams with four eligible players each"),
        );
        assert.ok(!checklist.includes("SOLO"));
        assert.ok(!checklist.includes("League schedule"));
        assert.ok(!checklist.includes("Qualification"));
      }
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth + 1,
        ),
      );
      await page.screenshot({
        path: `/tmp/pailangz-${format.toLowerCase()}-${width}.png`,
        fullPage: true,
      });
    }
    if (format === "TEAM") {
      await page.getByRole("tab", { name: "Sizes & updates" }).click();
      await page
        .getByRole("button", { name: /Change tournament sizes/ })
        .click();
      const sizes = page.getByRole("dialog");
      await sizes.getByLabel("Number of teams", { exact: true }).fill("16");
      await sizes.locator('select[name="teamBracketSize"]').selectOption("16");
      await sizes.locator('input[name="regenerate"]').check();
      await sizes
        .getByRole("button", { name: "Save tournament sizes", exact: true })
        .click();
      await sizes.getByText(/Tournament sizes updated/).waitFor();
      await sizes
        .getByRole("button", { name: "Close dialog", exact: true })
        .click();
      const updated = await owner.tournament.findUniqueOrThrow({
        where: { id: tournament.id },
        include: { categories: true },
      });
      assert.equal(
        (updated.configuration as { teamCapacity: number }).teamCapacity,
        16,
      );
      assert.equal(updated.categories[0].capacity, 16);
      console.log(
        "PASS browser changes TEAM capacity from eight to sixteen with no SOLO setup",
      );
    }
    await owner.tournament.update({
      where: { id: tournament.id },
      data: { registrationEnabled: true },
    });
    await page.goto(`${origin}/participate/${tournament.slug}`);
    const text = await page.locator("main").innerText();
    assert.ok(text.includes(`Entry for ${format}.`));
    assert.ok(!text.includes("SOLO & TEAM"));
    assert.equal(
      await page.getByRole("link", { name: "Browse teams" }).count(),
      0,
    );
    console.log(
      `PASS browser creates ${format}, displays independent readiness on desktop/mobile and correct registration copy`,
    );
  }
  const solo = created.get("SOLO")!,
    team = created.get("TEAM")!;
  for (const [key, id] of [
    ["officialSeedTournament", solo.id],
    ["officialTeamTournament", team.id],
  ]) {
    await owner.integrationSetting.upsert({
      where: { key },
      create: { key, value: id },
      update: { value: id },
    });
  }
  await owner.tournament.update({
    where: { id: solo.id },
    data: {
      published: true,
      status: "IN_PROGRESS",
      registrationEnabled: false,
    },
  });
  await owner.stage.updateMany({
    where: { category: { tournamentId: solo.id } },
    data: { published: true },
  });
  const soloPlayers = [];
  for (const ign of ["Solo only Alpha", "Solo only Beta"]) {
    const member = await owner.member.create({
      data: {
        displayIgn: ign,
        canonicalIgn: ign.toLowerCase(),
        verified: true,
      },
    });
    soloPlayers.push(
      await owner.participant.create({
        data: {
          tournamentId: solo.id,
          memberId: member.id,
          code: `P0${soloPlayers.length + 1}`,
          eligible: true,
        },
      }),
    );
  }
  const soloStage = await owner.stage.findFirstOrThrow({
    where: { category: { tournamentId: solo.id }, key: "league" },
  });
  const soloRound = await owner.round.create({
    data: { stageId: soloStage.id, number: 1, name: "Round 1" },
  });
  const soloMatch = await owner.match.create({
    data: {
      roundId: soloRound.id,
      order: 1,
      bestOf: 3,
      sideAId: soloPlayers[0].id,
      sideBId: soloPlayers[1].id,
      status: "FINALIZED",
    },
  });
  const result = await owner.resultVersion.create({
    data: {
      matchId: soloMatch.id,
      version: 1,
      outcome: "A_WIN",
      status: "ACCEPTED",
      submittedBy: "BROWSER_QA",
      reason: "Synthetic landing test",
      idempotencyKey: randomUUID(),
      games: {
        create: [
          { number: 1, scoreA: 15, scoreB: 3 },
          { number: 2, scoreA: 15, scoreB: 4 },
        ],
      },
    },
  });
  await owner.match.update({
    where: { id: soloMatch.id },
    data: { currentResultId: result.id },
  });
  const teamCategory = await owner.category.findFirstOrThrow({
    where: { tournamentId: team.id, kind: "TEAM" },
  });
  const teamA = await owner.team.create({
    data: { categoryId: teamCategory.id, name: "Team only Alpha" },
  });
  const teamB = await owner.team.create({
    data: { categoryId: teamCategory.id, name: "Team only Beta" },
  });
  const memberNames = [
    "Team captain",
    "Team player two",
    "Team player three",
    "Team player four",
  ];
  for (const [index, ign] of memberNames.entries()) {
    const member = await owner.member.create({
      data: {
        displayIgn: ign,
        canonicalIgn: ign.toLowerCase(),
        verified: true,
      },
    });
    await owner.participant.create({
      data: {
        tournamentId: team.id,
        memberId: member.id,
        code: `P0${index + 1}`,
        eligible: true,
      },
    });
    await owner.teamMembership.create({
      data: {
        teamId: teamA.id,
        categoryId: teamCategory.id,
        memberId: member.id,
      },
    });
    if (index === 0)
      await owner.team.update({
        where: { id: teamA.id },
        data: { ownerId: member.id },
      });
  }
  const teamStage = await owner.stage.findFirstOrThrow({
    where: { categoryId: teamCategory.id, key: "knockout" },
  });
  const teamRound = await owner.round.create({
    data: { stageId: teamStage.id, number: 1, name: "Round 1" },
  });
  const teamMatch = await owner.match.create({
    data: {
      roundId: teamRound.id,
      order: 1,
      bestOf: 3,
      sideKind: "TEAM",
      sideAId: teamA.id,
      sideBId: teamB.id,
      status: "FINALIZED",
      scheduledAt: new Date("2040-01-01T00:00:00Z"),
    },
  });
  const draftResult = await owner.resultVersion.create({
    data: {
      matchId: teamMatch.id,
      version: 1,
      outcome: "B_WIN",
      status: "ACCEPTED",
      submittedBy: "BROWSER_QA",
      reason: "PRIVATE_TEAM_RESULT_CANARY",
      idempotencyKey: randomUUID(),
      games: { create: [{ number: 1, scoreA: 12, scoreB: 15 }] },
    },
  });
  await owner.match.update({
    where: { id: teamMatch.id },
    data: { currentResultId: draftResult.id },
  });
  await owner.tournament.update({
    where: { id: team.id },
    data: { published: false, registrationEnabled: false },
  });
  // Test the actual anonymous database boundary, not just the rendered labels.
  await owner.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET LOCAL ROLE pailangz_app");
    const previews = await tx.$queryRaw<
      {
        data: {
          slug: string;
          categories: {
            stages: {
              rounds: {
                matches: {
                  id: string;
                  result: unknown;
                  status: string;
                  scheduledAt: unknown;
                }[];
              }[];
            }[];
          }[];
        };
      }[]
    >`SELECT data FROM "PublicEventPreview"`;
    assert.deepEqual(
      previews.map(({ data }) => data.slug).sort(),
      [solo.slug, team.slug].sort(),
    );
    const preview = previews.find(({ data }) => data.slug === team.slug)!.data;
    const match = preview.categories
      .flatMap((c) =>
        c.stages.flatMap((s) => s.rounds.flatMap((r) => r.matches)),
      )
      .find((m) => m.id === teamMatch.id)!;
    assert.equal(match.result, null);
    assert.equal(match.scheduledAt, null);
    assert.equal(match.status, "SCHEDULED");
    const roster = await tx.$queryRaw<
      { slug: string; teamCode: string; ign: string; owner: boolean }[]
    >`SELECT * FROM "PublicEventTeamMember" WHERE slug = ${team.slug}`;
    assert.deepEqual(
      roster.map((member) => member.ign).sort(),
      [...memberNames].sort(),
    );
    assert.equal(
      roster.find((member) => member.ign === memberNames[0])?.owner,
      true,
    );
    assert.ok(roster.every((member) => member.teamCode === teamA.code));
    assert.deepEqual(Object.keys(roster[0]).sort(), [
      "ign",
      "owner",
      "slug",
      "teamCode",
    ]);
  });
  await context.addCookies([
    { name: "pailangz_theme", value: "dark", url: origin },
  ]);
  for (const [format, tournamentId] of [
    ["SOLO", solo.id],
    ["TEAM", team.id],
  ] as const) {
    await owner.landingHighlight.upsert({
      where: { format },
      create: { format, tournamentId },
      update: { tournamentId },
    });
  }
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(origin);
    const centre = page.locator("#tournament-format");
    const tabs = centre.getByRole("group", {
      name: "Event tournament",
      exact: true,
    });
    const soloTab = tabs.getByRole("button", { name: /^SOLO/ }),
      teamTab = tabs.getByRole("button", { name: /^TEAM/ });
    assert.equal(await soloTab.getAttribute("aria-pressed"), "true");
    assert.ok((await centre.innerText()).includes(solo.name));
    assert.ok(!(await centre.innerText()).includes(team.name));
    const metrics = centre.locator('[class*="metrics"]');
    assert.match(await metrics.innerText(), /2\s*\/ 32/);
    assert.ok((await centre.innerText()).includes("2–0"));
    const soloBounds = await soloTab.boundingBox(),
      teamBounds = await teamTab.boundingBox();
    assert.ok(
      soloBounds &&
        teamBounds &&
        Math.abs(soloBounds.y - teamBounds.y) < 2 &&
        teamBounds.x > soloBounds.x,
    );
    await teamTab.focus();
    await teamTab.press("Enter");
    assert.equal(
      await teamTab.evaluate(
        (button: HTMLButtonElement) => button === document.activeElement,
      ),
      true,
    );
    assert.equal(await teamTab.getAttribute("aria-pressed"), "true");
    assert.ok((await centre.innerText()).includes(team.name));
    assert.match(await centre.innerText(), /schedule preview/i);
    assert.ok(!(await centre.innerText()).includes("Solo only"));
    assert.match(await metrics.innerText(), /2\s*\/ 16/);
    assert.equal(
      await centre
        .getByRole("button", { name: "Standings", exact: true })
        .count(),
      0,
    );
    assert.ok((await centre.innerText()).includes("Team only Alpha"));
    await centre.getByRole("button", { name: "Fixtures", exact: true }).click();
    const fixtures = centre.getByRole("region", {
      name: "Knockout · Round 1",
      exact: true,
    });
    assert.ok((await fixtures.innerText()).includes("Team only Beta"));
    assert.ok((await fixtures.innerText()).includes("Scheduled"));
    assert.ok(!(await fixtures.innerText()).includes("0–1"));
    const teamChip = centre.getByRole("button", {
      name: `${teamA.code} · ${teamA.name} · 4/4 players`,
      exact: true,
    });
    await teamChip.focus();
    await teamChip.press("Enter");
    const teamDialog = page.getByRole("dialog", {
      name: `${teamA.code} · ${teamA.name}`,
      exact: true,
    });
    assert.equal(await teamDialog.isVisible(), true);
    for (const ign of memberNames)
      assert.ok((await teamDialog.innerText()).includes(ign));
    assert.equal(
      await teamDialog.getByText("Owner", { exact: true }).isVisible(),
      true,
    );
    assert.ok((await teamDialog.innerText()).includes("Awaiting result"));
    assert.ok(!(await teamDialog.innerText()).includes("12–15"));
    assert.ok(!(await teamDialog.innerText()).includes("0–1"));
    assert.ok(
      await teamDialog.evaluate(
        (dialog: HTMLDialogElement) =>
          dialog.scrollWidth <= dialog.clientWidth + 1,
      ),
    );
    await teamDialog.screenshot({
      path: `/tmp/pailangz-team-members-${width}.png`,
    });
    await teamDialog.press("Escape");
    assert.equal(await teamDialog.count(), 0);
    assert.equal(
      await teamChip.evaluate(
        (button: HTMLButtonElement) => button === document.activeElement,
      ),
      true,
    );
    await centre
      .getByRole("button", {
        name: `${teamB.code} · ${teamB.name} · 0/4 players`,
        exact: true,
      })
      .click();
    assert.ok(
      (await page.getByRole("dialog").innerText()).includes(
        "Team members are not publicly available yet.",
      ),
    );
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Close", exact: true })
      .click();
    await centre.scrollIntoViewIfNeeded();
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1,
      ),
    );
    await centre.screenshot({
      path: `/tmp/pailangz-landing-team-${width}.png`,
    });
    await soloTab.click();
    assert.ok((await centre.innerText()).includes("SOLO event board"));
    assert.ok(!(await centre.innerText()).includes("Team only"));
    assert.ok((await centre.innerText()).includes("2–0"));
    console.log(
      `PASS landing SOLO/TEAM tabs at ${width}px keep separate capacity, entrants, fixtures and public/draft results`,
    );
  }
  // Directory links follow the TEAM event when it is available for registration.
  await owner.tournament.update({
    where: { id: team.id },
    data: { registrationEnabled: true },
  });
  await page.goto(origin);
  const centre = page.locator("#tournament-format");
  await centre
    .getByRole("group", { name: "Event tournament" })
    .getByRole("button", { name: /^TEAM/ })
    .click();
  const teamLink = centre.locator(
    `#teams a[href="/tournaments/${team.slug}/teams/${teamA.slug}"]`,
  );
  assert.equal(await teamLink.count(), 1);
  await centre
    .getByRole("group", { name: "Event tournament" })
    .getByRole("button", { name: /^SOLO/ })
    .click();
  assert.equal(await centre.locator("#teams").count(), 0);
  console.log(
    "PASS TEAM directory uses the independent TEAM tournament URL and hides on SOLO",
  );
  await owner.tournament.update({
    where: { id: team.id },
    data: {
      published: true,
      status: "IN_PROGRESS",
      registrationEnabled: false,
    },
  });
  await owner.stage.update({
    where: { id: teamStage.id },
    data: { published: true },
  });
  const emptyTeam = await owner.team.create({
    data: { categoryId: teamCategory.id, name: "Team without matches" },
  });
  for (const [locale, width] of [
    ["en", 1280],
    ["en", 390],
    ["ms", 390],
  ] as const) {
    await context.addCookies([
      { name: "pailangz_locale", value: locale, url: origin },
    ]);
    await page.setViewportSize({ width, height: 900 });
    await page.goto(origin);
    await centre
      .getByRole("group", {
        name: locale === "en" ? "Event tournament" : "Kejohanan acara",
      })
      .getByRole("button", { name: /^TEAM/ })
      .click();
    for (const [selectedTeam, seriesScore, gameScore] of [
      [teamA, "0–1", "12–15"],
      [teamB, "1–0", "15–12"],
    ] as const) {
      await centre
        .getByRole("button", {
          name: new RegExp(`^${selectedTeam.code} · ${selectedTeam.name} ·`),
        })
        .click();
      const dialog = page.getByRole("dialog", {
        name: `${selectedTeam.code} · ${selectedTeam.name}`,
        exact: true,
      });
      assert.ok((await dialog.innerText()).includes(seriesScore));
      assert.ok((await dialog.innerText()).includes(gameScore));
      assert.ok(
        !(await dialog.innerText()).includes(
          locale === "en" ? "Awaiting result" : "Menunggu keputusan",
        ),
      );
      assert.ok(
        await dialog.evaluate(
          (element: HTMLDialogElement) =>
            element.scrollWidth <= element.clientWidth + 1,
        ),
      );
      await dialog.screenshot({
        path: `/tmp/pailangz-team-results-${selectedTeam.code}-${locale}-${width}.png`,
      });
      await dialog
        .getByRole("button", {
          name: locale === "en" ? "Close" : "Tutup",
          exact: true,
        })
        .last()
        .click();
    }
    await centre
      .getByRole("button", {
        name: new RegExp(`^${emptyTeam.code} · ${emptyTeam.name} ·`),
      })
      .click();
    const dialog = page.getByRole("dialog");
    assert.ok(
      (await dialog.innerText()).includes(
        locale === "en"
          ? "No matches have been prepared for this team yet."
          : "Perlawanan pasukan ini belum disediakan.",
      ),
    );
    await dialog.press("Escape");
    console.log(
      `PASS TEAM roster and published scores at ${width}px in ${locale} orient both sides and handle empty results`,
    );
  }
  const knockout = await owner.stage.findFirstOrThrow({
    where: {
      category: { tournamentId: solo.id },
      key: "knockout",
      archived: false,
    },
  });
  await owner.stage.update({
    where: { id: knockout.id },
    data: {
      rules: { seriesPoints: true, drawPolicy: "no_draws" },
      confirmedRules: ["seriesPoints", "drawPolicy"],
    },
  });
  const finalRound = await owner.round.create({
    data: { stageId: knockout.id, number: 3, name: "Final" },
  });
  const finalMatch = await owner.match.create({
    data: {
      roundId: finalRound.id,
      order: 1,
      bestOf: 7,
      sideAId: soloPlayers[0].id,
      sideBId: soloPlayers[1].id,
    },
  });
  await context.addCookies([
    { name: "pailangz_locale", value: "en", url: origin },
  ]);
  await page.goto(`${origin}/moderator/matches?stageId=${knockout.id}&round=3`);
  await page
    .getByRole("button", { name: "Enter / correct result", exact: true })
    .click();
  const finalDialog = page.getByRole("dialog", {
    name: "Enter / correct result",
    exact: true,
  });
  assert.ok(
    (await finalDialog.innerText()).includes(
      "Best of 7 · First to 4 game wins",
    ),
  );
  for (const [index, side] of [0, 1, 0, 1, 0, 1, 0].entries()) {
    await finalDialog
      .getByRole("button", {
        name: new RegExp(`as winner of Game ${index + 1}$`),
      })
      .nth(side)
      .click();
    if (index === 5) {
      await finalDialog
        .getByRole("button", { name: "Save & confirm", exact: true })
        .click();
      await finalDialog.getByRole("alert").waitFor();
      assert.equal(
        await owner.resultVersion.count({ where: { matchId: finalMatch.id } }),
        0,
      );
    }
  }
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    assert.ok(
      await finalDialog.evaluate(
        (element: HTMLDialogElement) =>
          element.scrollWidth <= element.clientWidth + 1,
      ),
    );
    await finalDialog.screenshot({
      path: `/tmp/pailangz-bo7-final-${width}.png`,
    });
  }
  await finalDialog
    .getByRole("button", { name: "Save & confirm", exact: true })
    .click();
  await finalDialog
    .getByText("Result saved and confirmed.", { exact: true })
    .waitFor();
  const savedFinal = await owner.match.findUniqueOrThrow({
    where: { id: finalMatch.id },
    include: { currentResult: { include: { games: true } } },
  });
  assert.equal(savedFinal.status, "FINALIZED");
  assert.equal(savedFinal.currentResult?.outcome, "A_WIN");
  assert.equal(savedFinal.currentResult?.games.length, 7);
  console.log(
    "PASS BO7 final offers all seven games on desktop/mobile, requires four wins and saves a confirmed 4–3 result",
  );
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
  await owner.$disconnect();
}
