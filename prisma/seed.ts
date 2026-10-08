import {
  newTournamentConfiguration,
  originalConfiguration,
} from "../src/lib/tournament-config";
import { createStages } from "../src/lib/configuration";
import "dotenv/config";
import { pathToFileURL } from "node:url";
import { playerIGNs, fixtureTokens } from "../src/lib/seed-data";
import { validateFixtures } from "../src/lib/fixture-validation";
import { canonicalIgn } from "../src/lib/domain";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
export async function seed({ legacyFixtures = false } = {}) {
  validateFixtures(playerIGNs, fixtureTokens);
  const { audit } = await import("../src/lib/db");
  const db = new PrismaClient({
    adapter: new PrismaPg({
      options: "-c timezone=UTC",
      connectionString:
        process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL,
      max: 1,
    }),
  });
  let revised = false;
  let emptyDraft = false;
  await db.$transaction(
    async (tx) => {
      const provenance = await tx.integrationSetting.findUnique({
        where: { key: "officialSeedTournament" },
      });
      let tournament = provenance
        ? await tx.tournament.findUnique({
            where: { id: provenance.value as string },
          })
        : await tx.tournament.findUnique({
            where: { slug: "pailangz-solo-team" },
          });
      if (!tournament) {
        tournament = await tx.tournament.create({
          data: {
            slug: "pailangz-solo-team",
            name: "PAILANGZ & PAILANGZZ — Solo & Team Tournament",
            registrationEnabled: true,
            configuration: legacyFixtures
              ? originalConfiguration
              : newTournamentConfiguration,
            overview:
              "Aktiviti bersama dan persaingan sihat untuk mengenal pasti pemain solo serta pasukan terkuat PAILANGZ dan PAILANGZZ. Pemain bebas memilih weapons dan weapon modes.",
          },
        });
        await audit(
          tx,
          null,
          "SEED_TOURNAMENT",
          "TOURNAMENT",
          tournament.id,
          { draft: true, datesUnset: true },
          undefined,
          { source: "SEED" },
        );
      }
      await tx.integrationSetting.upsert({
        where: { key: "officialSeedTournament" },
        update: {},
        create: { key: "officialSeedTournament", value: tournament.id },
      });
      if (tournament.configurationVersion > 1) {
        revised = true;
        return;
      }
      if (
        (tournament.configuration as { scheduleSource?: string })
          .scheduleSource === "generated"
      ) {
        emptyDraft = true;
        if (
          !(await tx.stage.count({
            where: { category: { tournamentId: tournament.id } },
          }))
        )
          await createStages(tx, tournament.id, newTournamentConfiguration);
        await tx.integrationSetting.upsert({
          where: { key: "formMapping" },
          update: {},
          create: {
            key: "formMapping",
            value: { ign: "IGN", phone: "Whatsapp Number", country: "Country" },
          },
        });
        return;
      }
      const solo = await tx.category.upsert({
          where: {
            tournamentId_kind: { tournamentId: tournament.id, kind: "SOLO" },
          },
          update: {},
          create: { tournamentId: tournament.id, kind: "SOLO", capacity: 64 },
        }),
        team = await tx.category.upsert({
          where: {
            tournamentId_kind: { tournamentId: tournament.id, kind: "TEAM" },
          },
          update: {},
          create: { tournamentId: tournament.id, kind: "TEAM", capacity: 16 },
        });
      const league = await tx.stage.upsert({
        where: { categoryId_key: { categoryId: solo.id, key: "league" } },
        update: {},
        create: {
          categoryId: solo.id,
          key: "league",
          name: "SOLO · Six-round league",
          format: "LEAGUE",
          bestOf: 3,
          rules: {
            seriesPoints: true,
            drawPolicy: "unconfirmed",
            tiebreakers: [],
          },
        },
      });
      for (const [categoryId, key, name, format, bestOf] of [
        [solo.id, "qualification", "SOLO · Qualification", "LEAGUE", null],
        [solo.id, "knockout", "SOLO · Knockout", "KNOCKOUT", 5],
        [team.id, "knockout", "TEAM · Knockout", "KNOCKOUT", 3],
      ] as const)
        await tx.stage.upsert({
          where: { categoryId_key: { categoryId, key } },
          update: {},
          create: {
            categoryId,
            key,
            name,
            format,
            bestOf,
            rules: { seriesPoints: true },
          },
        });
      const participantIds: string[] = [];
      for (const [i, ign] of playerIGNs.entries()) {
        const code = `P${String(i + 1).padStart(2, "0")}`;
        let p = await tx.participant.findUnique({
          where: { tournamentId_code: { tournamentId: tournament.id, code } },
        });
        if (!p) {
          let m = await tx.member.findUnique({
            where: { canonicalIgn: canonicalIgn(ign) },
          });
          if (!m)
            m = await tx.member.create({
              data: {
                displayIgn: ign,
                canonicalIgn: canonicalIgn(ign),
                verified: false,
              },
            });
          p = await tx.participant.create({
            data: {
              tournamentId: tournament.id,
              memberId: m.id,
              code,
              provisional: true,
              eligible: false,
            },
          });
          await audit(
            tx,
            null,
            "SEED_ROSTER",
            "PARTICIPANT",
            p.id,
            { code, ign, verified: false },
            i === 63
              ? "P64 reconciled to Smith69 per later private-data instruction; original roster contained a final period."
              : undefined,
            { source: "SEED" },
          );
        }
        participantIds.push(p.id);
      }
      if (
        tournament.configurationVersion === 1 &&
        (tournament.configuration as { scheduleSource?: string })
          .scheduleSource === "supplied"
      )
        for (const [i, tokens] of fixtureTokens.entries()) {
          const round = await tx.round.upsert({
            where: { stageId_number: { stageId: league.id, number: i + 1 } },
            update: {},
            create: {
              stageId: league.id,
              number: i + 1,
              name: `Round ${i + 1}`,
            },
          });
          for (const [j, token] of tokens.entries()) {
            const [a, b] = token.split("-").map(Number);
            const existing = await tx.match.findUnique({
              where: { roundId_order: { roundId: round.id, order: j + 1 } },
            });
            if (!existing) {
              const m = await tx.match.create({
                data: {
                  roundId: round.id,
                  order: j + 1,
                  sideAId: participantIds[a - 1],
                  sideBId: participantIds[b - 1],
                  bestOf: 3,
                },
              });
              await audit(
                tx,
                null,
                "SEED_FIXTURE",
                "MATCH",
                m.id,
                { token, round: i + 1, order: j + 1 },
                undefined,
                { source: "SEED", stageId: league.id },
              );
            }
          }
        }
      await tx.integrationSetting.upsert({
        where: { key: "formMapping" },
        update: {},
        create: {
          key: "formMapping",
          value: { ign: "IGN", phone: "Whatsapp Number", country: "Country" },
        },
      });
    },
    { timeout: 60000 },
  );
  await db.$disconnect();
  console.log(
    revised
      ? "Official seed retained; applied configuration revisions were not changed."
      : emptyDraft
        ? "Official draft ready: 32 SOLO players / eight teams of four; no assignments or fixtures generated."
        : "Official draft seed verified: 64 provisional players; 6 rounds; 192 distinct series. No results or staff credentials seeded.",
  );
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  seed({
    legacyFixtures:
      process.env.APP_ENV === "development" &&
      process.argv.includes("--legacy-test-fixtures"),
  }).catch(() => {
    console.error(
      "Seed failed. Check migrations and the owner connection; no personal data is printed.",
    );
    process.exitCode = 1;
  });
