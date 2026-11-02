import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import pg from "pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { encrypt } from "../src/lib/crypto";
import { newTournamentConfiguration } from "../src/lib/tournament-config";
import { backfillPlayerFamilies } from "../scripts/backfill-player-families";

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
  const event = await owner.tournament.create({
    data: {
      slug: `family-pills-${randomUUID()}`,
      name: "Family label QA",
      overview: "Synthetic family labels",
      status: "IN_PROGRESS",
      published: true,
      configuration: {
        ...newTournamentConfiguration,
        soloCapacity: 16,
        soloBracketSize: 16,
        leagueRounds: 1,
        leagueMatchesPerPlayer: 1,
        directSlots: 16,
        playoffSlots: 0,
        playoffEntrants: 0,
      },
      categories: {
        create: {
          kind: "SOLO",
          capacity: 16,
          stages: {
            create: [
              {
                key: "league",
                name: "League",
                format: "LEAGUE",
                bestOf: 3,
                rules: {},
                published: true,
              },
              {
                key: "knockout",
                name: "Knockout",
                format: "KNOCKOUT",
                bestOf: 3,
                rules: {},
                published: true,
              },
            ],
          },
        },
      },
    },
    include: { categories: { include: { stages: true } } },
  });
  const labels = Array.from(
    { length: 16 },
    (_, i) => ["Pailangz", "Night Owls", "Null", "Pailangz"][i % 4],
  );
  labels[15] = "A very long family name that must stay within its bracket card";
  const participants: { id: string; code: string }[] = [];
  for (const [i, family] of labels.entries()) {
    const id = randomUUID();
    const participant = await owner.participant.create({
      data: {
        tournament: { connect: { id: event.id } },
        code: `P${String(i + 1).padStart(2, "0")}`,
        eligible: true,
        provisional: false,
        member: {
          create: {
            id,
            displayIgn:
              i === 15
                ? "AnExtremelyLongPlayerNameWithoutSpaces"
                : `Family Player ${i + 1}`,
            canonicalIgn: `family-${id}`,
            verified: true,
            // Legacy profiles are normalized by the explicit backfill below.
            isMember: true,
            privateData: {
              create: {
                originalIgn: `Family Player ${i + 1}`,
                registrationEncrypted: encrypt(
                  JSON.stringify({
                    "Non-family": family === "Pailangz" ? "No" : "Yes",
                    "Family Name": ["Pailangz", "Null"].includes(family)
                      ? ""
                      : family,
                    Email: "PRIVATE_FAMILY_CONTACT_CANARY",
                    "Discord ID": "PRIVATE_FAMILY_CONTACT_CANARY",
                  }),
                  `member:${id}`,
                ),
              },
            },
          },
        },
      },
    });
    participants.push(participant);
  }
  const client = new pg.Client({
    connectionString: process.env.MIGRATION_DATABASE_URL,
  });
  await client.connect();
  try {
    const first = await backfillPlayerFamilies(client);
    assert.equal(
      first.updated,
      labels.filter((label) => label !== "Pailangz").length,
    );
    assert.equal((await backfillPlayerFamilies(client)).updated, 0);
  } finally {
    await client.end();
  }
  for (const stage of event.categories[0].stages) {
    const roundCount = stage.key === "league" ? 1 : 4;
    for (let number = 1; number <= roundCount; number++) {
      await owner.round.create({
        data: {
          stageId: stage.id,
          number,
          name:
            stage.key === "league"
              ? "Round 1"
              : ["Round of 16", "Quarterfinals", "Semifinals", "Final"][
                  number - 1
                ],
          matches: {
            create: Array.from({ length: 16 / 2 ** number }, (_, i) => ({
              order: i + 1,
              sideKind: "PARTICIPANT" as const,
              sideAId: number === 1 ? participants[i * 2].id : null,
              sideBId: number === 1 ? participants[i * 2 + 1].id : null,
              bestOf: 3,
            })),
          },
        },
      });
    }
    if (stage.key === "league")
      await owner.rankingSnapshot.create({
        data: {
          stageId: stage.id,
          version: 1,
          frozenBy: "SYNTHETIC_BRACKET_LAYOUT",
          rankings: participants.map((p, i) => ({
            id: p.id,
            code: p.code,
            rank: i + 1,
            played: 0,
            wins: 0,
            draws: 0,
            losses: 0,
            points: 0,
          })),
        },
      });
  }
  await owner.landingHighlight.upsert({
    where: { format: "SOLO" },
    create: { format: "SOLO", tournamentId: event.id },
    update: { tournamentId: event.id },
  });
  const errors: string[] = [];
  await mkdir(".local/family-pill-qa", { recursive: true });
  for (const width of [1440, 390]) {
    const context = await browser.newContext({
      viewport: { width, height: 1000 },
    });
    await context.addCookies([
      { name: "pailangz_locale", value: "en", url: origin },
    ]);
    const page = await context.newPage();
    page.on("pageerror", (error: Error) => errors.push(error.message));
    page.setDefaultTimeout(15000);
    await page.goto(origin);
    const fixtures = page.getByRole("region", {
      name: "League · Round 1",
      exact: true,
    });
    await fixtures.waitFor();
    for (const label of ["Pailangz", "Night Owls", "Null"])
      assert.ok(
        (await fixtures.locator(`[data-family-label="${label}"]`).count()) > 0,
      );
    assert.ok(
      !(await page.content()).includes("PRIVATE_FAMILY_CONTACT_CANARY"),
    );
    await fixtures.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `.local/family-pill-qa/board-${width}.png` });
    await page
      .getByRole("button", { name: "P01 · Family Player 1", exact: true })
      .first()
      .click();
    await page
      .getByRole("dialog", { name: "P01 · Family Player 1", exact: true })
      .waitFor();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Bracket", exact: true }).click();
    const bracket = page.getByRole("region", {
      name: "Bracket, scroll horizontally to see every round",
      exact: true,
    });
    const checkLayout = async () => {
      const failures = await bracket.evaluate((region: HTMLElement) => {
        const cards = Array.from(region.querySelectorAll("article"));
        const errors: string[] = [];
        cards.forEach((card, i) => {
          const rect = card.getBoundingClientRect();
          const slot = card.parentElement!.getBoundingClientRect();
          if (
            rect.left < slot.left - 1 ||
            rect.right > slot.right + 1 ||
            rect.top < slot.top - 1 ||
            rect.bottom > slot.bottom + 1
          )
            errors.push(`${card.ariaLabel} overflows its slot`);
          for (const other of cards.slice(i + 1)) {
            const next = other.getBoundingClientRect();
            if (
              Math.min(rect.right, next.right) >
                Math.max(rect.left, next.left) &&
              Math.min(rect.bottom, next.bottom) > Math.max(rect.top, next.top)
            )
              errors.push(`${card.ariaLabel} overlaps ${other.ariaLabel}`);
          }
          for (const control of card.querySelectorAll(
            "button, [data-family-label]",
          )) {
            const bounds = control.getBoundingClientRect();
            if (bounds.left < rect.left || bounds.right > rect.right)
              errors.push(`${card.ariaLabel} has overflowing player content`);
          }
        });
        return errors;
      });
      assert.deepEqual(failures, []);
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      );
    };
    assert.equal(await bracket.getByRole("article").count(), 15);
    await bracket.getByText("League #1", { exact: true }).waitFor();
    await checkLayout();
    await page.getByRole("button", { name: "My picks", exact: true }).click();
    await checkLayout();
    await bracket.screenshot({
      path: `.local/family-pill-qa/bracket-${width}.png`,
    });
    // Advance every round so later cards also contain names, pills and origins.
    for (const card of await bracket.getByRole("article").all()) {
      await card
        .getByRole("button", { name: /^Pick .* as winner of/ })
        .first()
        .click();
    }
    await checkLayout();
    for (const label of ["Pailangz", "Night Owls", "Null"])
      assert.ok(
        (await page.locator(`[data-family-label="${label}"]`).count()) > 0,
      );
    for (const view of ["fixtures", "standings", "brackets"]) {
      await page.goto(`${origin}/tournaments/${event.slug}/${view}`);
      for (const label of ["Pailangz", "Night Owls", "Null"])
        await page.locator(`[data-family-label="${label}"]`).first().waitFor();
      assert.ok(
        !(await page.content()).includes("PRIVATE_FAMILY_CONTACT_CANARY"),
      );
    }
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await context.close();
    console.log(
      `PASS member, named-family and Null pills on the board and public tournament tabs at ${width}px`,
    );
  }
  assert.deepEqual(errors, []);
  console.log(
    "PASS encrypted legacy backfill is idempotent; player dialogs still open and private answers remain hidden",
  );
} finally {
  await browser.close();
  await owner.$disconnect();
}
