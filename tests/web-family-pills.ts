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
      configuration: newTournamentConfiguration,
      categories: {
        create: {
          kind: "SOLO",
          capacity: 32,
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
  const labels = ["Pailangz", "Night Owls", "Null", "Pailangz"];
  const participants: { id: string }[] = [];
  for (const [i, family] of labels.entries()) {
    const id = randomUUID();
    const participant = await owner.participant.create({
      data: {
        tournament: { connect: { id: event.id } },
        code: `P0${i + 1}`,
        eligible: true,
        provisional: false,
        member: {
          create: {
            id,
            displayIgn: `Family Player ${i + 1}`,
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
                    "Family Name": family === "Night Owls" ? family : "",
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
    assert.equal(first.updated, 2);
    assert.equal((await backfillPlayerFamilies(client)).updated, 0);
  } finally {
    await client.end();
  }
  for (const stage of event.categories[0].stages) {
    await owner.round.create({
      data: {
        stageId: stage.id,
        number: 1,
        name: stage.key === "league" ? "Round 1" : "Semifinals",
        matches: {
          create: [0, 1].map((i) => ({
            order: i + 1,
            sideKind: "PARTICIPANT" as const,
            sideAId: participants[i * 2].id,
            sideBId: participants[i * 2 + 1].id,
            bestOf: 3,
          })),
        },
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
