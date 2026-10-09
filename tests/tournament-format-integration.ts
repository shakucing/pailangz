import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import type pg from "pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { privateTx, type Actor } from "../src/lib/db";
import { newTournamentConfiguration } from "../src/lib/tournament-config";
import {
  assignParticipants,
  configureTournament,
  generateTournamentLeague,
} from "../src/lib/configuration";
import {
  saveTournament,
  confirmRules,
  tournamentReadiness,
  publishTournament,
} from "../src/lib/competition";
import { teamUpdate } from "../src/lib/operations";
import { splitOfficialTournament } from "../scripts/split-official-tournament";
import { encrypt } from "../src/lib/crypto";
import { submitParticipation } from "../src/lib/participation";
import {
  startMemberAccess,
  endMemberAccess,
  mutateTeam,
  publicTeamEvent,
  publicTeams,
  teamRegistrationOpen,
} from "../src/lib/team-portal";

export async function checkTournamentFormats(
  owner: pg.Client,
  actor: Actor,
  check: (name: string, fn: () => Promise<void>) => Promise<void>,
) {
  const ids = (
    await owner.query(
      'SELECT id FROM "Member" WHERE verified AND NOT archived LIMIT 32',
    )
  ).rows.map((r) => r.id as string);
  assert.equal(ids.length, 32);
  const config = {
    ...newTournamentConfiguration,
    soloCapacity: 2,
    leagueRounds: 1,
    leagueMatchesPerPlayer: 1,
    directSlots: 2,
    playoffSlots: 0,
    playoffEntrants: 0,
    soloBracketSize: 2,
    teamCapacity: 6,
  };
  const solo = await saveTournament(actor, {
    name: "Independent SOLO",
    overview: "SOLO test",
    status: "DRAFT",
    configuration: config,
  });
  const team = await saveTournament(actor, {
    name: "Independent TEAM",
    overview: "TEAM test",
    status: "DRAFT",
    configuration: { ...newTournamentConfiguration, format: "TEAM" },
  });
  await check(
    "SOLO and TEAM create only their own categories and stages",
    async () => {
      for (const [event, kind, keys] of [
        [solo, "SOLO", ["knockout", "league"]],
        [team, "TEAM", ["knockout"]],
      ] as const) {
        const rows = await privateTx(actor, (tx) =>
          tx.category.findMany({
            where: { tournamentId: event.id },
            include: { stages: true },
          }),
        );
        assert.deepEqual(
          rows.map((c) => c.kind),
          [kind],
        );
        assert.deepEqual(rows[0].stages.map((s) => s.key).sort(), keys);
      }
      await assert.rejects(
        generateTournamentLeague(actor, {
          id: team.id,
          reason: "No SOLO league",
        }),
        /TEAM tournaments/,
      );
      await assert.rejects(
        configureTournament(actor, {
          id: solo.id,
          configuration: { ...newTournamentConfiguration, format: "TEAM" },
          regenerate: true,
          reason: "Reject format switch",
        }),
        /format cannot be changed/,
      );
    },
  );
  await check(
    "TEAM capacity can be configured to four, sixteen or six teams independently",
    async () => {
      const event = await saveTournament(actor, {
        name: "Configurable TEAM",
        overview: "Flexible capacity",
        status: "DRAFT",
        configuration: { ...newTournamentConfiguration, format: "TEAM" },
      });
      for (const teamCapacity of [4, 16, 6]) {
        const config = {
          ...newTournamentConfiguration,
          format: "TEAM" as const,
          teamCapacity,
          teamBracketSize: teamCapacity === 6 ? 8 : teamCapacity,
          bracketByePolicy:
            teamCapacity === 6 ? ("seeded_top" as const) : ("none" as const),
        };
        await configureTournament(actor, {
          id: event.id,
          configuration: config,
          regenerate: true,
          reason: "Change team count",
        });
        const { t, checks } = await privateTx(actor, (tx) =>
          tournamentReadiness(tx, event.id),
        );
        assert.equal(t.categories.length, 1);
        assert.equal(t.categories[0].capacity, teamCapacity);
        assert.equal(t.categories[0].stages.length, 1);
        assert.equal(t.categories[0].stages[0].key, "knockout");
        assert.ok(
          checks.some(
            (c) =>
              c.label ===
              `${teamCapacity} teams with four eligible players each`,
          ),
        );
        assert.ok(
          !checks.some((c) => c.key === "schedule" || c.key === "eligibility"),
        );
        const capacity = (
          await owner.query("SELECT app_tournament_player_capacity($1) n", [
            event.id,
          ])
        ).rows[0].n;
        assert.equal(capacity, teamCapacity * 4);
      }
    },
  );
  await assignParticipants(actor, {
    id: solo.id,
    memberIds: ids.slice(0, 2),
    eligible: true,
    reason: "Fill SOLO",
  });
  await generateTournamentLeague(actor, {
    id: solo.id,
    reason: "Generate SOLO",
  });
  await assignParticipants(actor, {
    id: team.id,
    memberIds: ids,
    eligible: true,
    reason: "Fill TEAM pool",
  });
  const teamCategory = await privateTx(actor, (tx) =>
    tx.category.findFirstOrThrow({
      where: { tournamentId: team.id, kind: "TEAM" },
    }),
  );
  for (let i = 0; i < 8; i++)
    await teamUpdate(actor, {
      categoryId: teamCategory.id,
      name: `Format Team ${i + 1}`,
      memberIds: ids.slice(i * 4, i * 4 + 4),
      reason: "Independent team roster",
    });
  await check(
    "SOLO publication has no team requirements and TEAM publication has no SOLO requirements",
    async () => {
      for (const [event, format] of [
        [solo, "SOLO"],
        [team, "TEAM"],
      ] as const) {
        const { t, checks } = await privateTx(actor, (tx) =>
          tournamentReadiness(tx, event.id),
        );
        const keys = checks.map((c) => c.key);
        if (format === "SOLO") {
          assert.ok(!keys.includes("teams"));
          assert.ok(!keys.includes("teamSeeding"));
        } else
          for (const key of [
            "mapping",
            "eligibility",
            "schedule",
            "tiebreakers",
            "knockoutPairing",
            "qualificationBestOf",
          ])
            assert.ok(!keys.includes(key), key);
        for (const stage of t.categories.flatMap((c) => c.stages)) {
          const rules = {
            seriesPoints: true,
            drawPolicy: "no_draws",
            tiebreakers: ["wins"],
            knockoutPairing: "ranked_cross",
            teamSeeding: "manual",
            specialOutcomes: "forfeit",
            evidenceDeadline: "24 hours",
            disputeDeadline: "24 hours",
          };
          const relevant = Object.fromEntries(
            Object.entries(rules).filter(([key]) => keys.includes(key)),
          );
          await confirmRules(actor, {
            stageId: stage.id,
            rules: relevant,
            confirmedRules: Object.keys(relevant),
            reason: "Confirm format rules",
          });
        }
        await owner.query(
          'UPDATE "Tournament" SET "mappingConfirmed"=$2,"startsAt"=now()+interval \'3 days\',"registrationDeadline"=now()+interval \'2 days\',"gameTitle"=\'Format test\',status=\'REGISTRATION_CLOSED\' WHERE id=$1',
          [event.id, format === "SOLO"],
        );
        const readiness = await privateTx(actor, (tx) =>
          tournamentReadiness(tx, event.id),
        );
        assert.deepEqual(
          readiness.checks.filter((c) => !c.done),
          [],
        );
        await publishTournament(actor, {
          id: event.id,
          published: true,
          reason: "Publish independently",
        });
      }
    },
  );
  await check(
    "registration works for one category and reserves independent event slots",
    async () => {
      const memberId = randomUUID(),
        ign = `format-${memberId}`,
        record = encrypt(
          JSON.stringify({ "Tiktok ID": "@format-player" }),
          `member:${memberId}`,
        );
      await owner.query(
        'INSERT INTO "Member"(id,"displayIgn","canonicalIgn",verified) VALUES($1,$2,$2,true)',
        [memberId, ign],
      );
      await owner.query(
        'INSERT INTO "MemberPrivate"("memberId","originalIgn","registrationEncrypted") VALUES($1,$2,$3)',
        [memberId, ign, record],
      );
      for (const format of ["SOLO", "TEAM"] as const) {
        const event = await saveTournament(actor, {
          name: `Register ${format}`,
          overview: "Independent registration",
          status: "DRAFT",
          registrationEnabled: true,
          teamRosterManagement: format === "TEAM" ? "STAFF" : "PLAYER",
          configuration: { ...newTournamentConfiguration, format },
        });
        const row = (
          await owner.query('SELECT slug FROM "Tournament" WHERE id=$1', [
            event.id,
          ])
        ).rows[0];
        await privateTx(actor, async (tx) => {
          const view = await tx.$queryRaw<
            { capacity: number; format: string }[]
          >`SELECT capacity,format FROM "PublicTournamentRegistration" WHERE slug=${row.slug}`;
          assert.equal(view[0].capacity, 32);
          assert.equal(view[0].format, format);
        });
        await submitParticipation({
          tournamentSlug: row.slug,
          ign,
          tiktokId: "@format-player",
        });
        await submitParticipation({
          tournamentSlug: row.slug,
          ign,
          tiktokId: "@format-player",
        });
        const count = (
          await owner.query(
            'SELECT count(*)::int n FROM "Participant" WHERE "tournamentId"=$1 AND "memberId"=$2',
            [event.id, memberId],
          )
        ).rows[0].n;
        assert.equal(count, 1);
        if (format === "TEAM") {
          const eventInfo = await publicTeamEvent(row.slug);
          assert.equal(eventInfo?.format, "TEAM");
          assert.equal(teamRegistrationOpen(eventInfo!), false);
          assert.equal((await publicTeams(row.slug)).length, 0);
          const memberships = await owner.query(
            'SELECT count(*)::int n FROM "TeamMembership" tm JOIN "Category" c ON c.id=tm."categoryId" WHERE c."tournamentId"=$1 AND tm."memberId"=$2',
            [event.id, memberId],
          );
          assert.equal(memberships.rows[0].n, 0);
          // Staff can assign individually registered entrants to a roster later.
          await assignParticipants(actor, {
            id: event.id,
            memberIds: [memberId, ...ids.slice(0, 3)],
            eligible: true,
            reason: "Prepare staff-assigned TEAM roster",
          });
          const category = await privateTx(actor, (tx) =>
            tx.category.findFirstOrThrow({
              where: { tournamentId: event.id, kind: "TEAM" },
            }),
          );
          await teamUpdate(actor, {
            categoryId: category.id,
            name: "Staff assigned team",
            memberIds: [memberId, ...ids.slice(0, 3)],
            reason: "Assign registered entrants",
          });
          const [assigned] = await publicTeams(row.slug);
          assert.equal(assigned.playerCount, 4);
          assert.equal(assigned.acceptsApplications, false);
          assert.ok(assigned.roster.some((p) => p.ign === ign));
          const token = await startMemberAccess({
            ign,
            tiktokId: "@format-player",
          });
          try {
            for (const action of [
              "CREATE",
              "APPLY",
              "APPROVE",
              "REJECT",
            ] as const) {
              await assert.rejects(
                mutateTeam(token, row.slug, {
                  action,
                  name: "Public team",
                  teamSlug: assigned.slug,
                  applicationId: randomUUID(),
                }),
                /STAFF_MANAGED/,
              );
              // The database also rejects direct calls and stale browser forms.
              const denied = await owner.query(
                "SELECT app_team_action($1,$2,$3,$4,$5,$6,$7,$8) AS result",
                [
                  createHash("sha256").update(token).digest("hex"),
                  row.slug,
                  action,
                  assigned.slug,
                  "Public team",
                  randomUUID(),
                  randomUUID(),
                  randomUUID(),
                ],
              );
              assert.deepEqual(denied.rows[0].result, {
                error: "STAFF_MANAGED",
              });
            }
            const deniedAvatar = await owner.query(
              "SELECT app_team_create_with_avatar($1,$2,$3,$4,$5,$6,NULL) AS result",
              [
                createHash("sha256").update(token).digest("hex"),
                row.slug,
                "public-avatar-team",
                "Public avatar team",
                randomUUID(),
                randomUUID(),
              ],
            );
            assert.deepEqual(deniedAvatar.rows[0].result, {
              error: "STAFF_MANAGED",
            });
            assert.equal((await publicTeams(row.slug)).length, 1);
            // The default remains player-managed, and policy changes retain rosters.
            const flexible = await saveTournament(actor, {
              name: "Configurable roster ownership",
              overview: "Player or staff management",
              status: "DRAFT",
              registrationEnabled: true,
              configuration: { ...newTournamentConfiguration, format: "TEAM" },
            });
            const flexibleEvent = await privateTx(actor, (tx) =>
              tx.tournament.findUniqueOrThrow({ where: { id: flexible.id } }),
            );
            const flexibleSlug = flexibleEvent.slug;
            assert.equal(flexibleEvent.teamRosterManagement, "PLAYER");
            await submitParticipation({
              tournamentSlug: flexibleSlug,
              ign,
              tiktokId: "@format-player",
            });
            const playerTeam = await mutateTeam(token, flexibleSlug, {
              action: "CREATE",
              name: "Player managed team",
            });
            const originalRoster = (await publicTeams(flexibleSlug))[0].roster;
            for (const mode of ["STAFF", "PLAYER"] as const) {
              await saveTournament(actor, {
                id: flexible.id,
                name: flexibleEvent.name,
                overview: flexibleEvent.overview,
                status: "REGISTRATION_OPEN",
                teamRosterManagement: mode,
              });
              const info = await publicTeamEvent(flexibleSlug);
              assert.equal(info?.teamRosterManagement, mode);
              assert.equal(teamRegistrationOpen(info!), mode === "PLAYER");
              const [retained] = await publicTeams(flexibleSlug);
              assert.equal(retained.slug, playerTeam.slug);
              assert.deepEqual(retained.roster, originalRoster);
              assert.equal(retained.acceptsApplications, mode === "PLAYER");
              await assert.rejects(
                mutateTeam(token, flexibleSlug, {
                  action: "CREATE",
                  name: "Another team",
                }),
                mode === "STAFF" ? /STAFF_MANAGED/ : /ALREADY_IN_TEAM/,
              );
            }
            await assert.rejects(
              saveTournament(actor, {
                id: flexible.id,
                name: flexibleEvent.name,
                overview: flexibleEvent.overview,
                status: "REGISTRATION_OPEN",
                teamRosterManagement: "INVALID",
              }),
            );
          } finally {
            await endMemberAccess(token);
          }
        }
      }
    },
  );
  await check(
    "the official split preserves SOLO records, moves TEAM records and is idempotent",
    async () => {
      const { format: _format, ...legacy } = newTournamentConfiguration;
      const mixed = await saveTournament(actor, {
        name: "Combined split fixture",
        overview: "Preserve entries",
        status: "DRAFT",
        configuration: legacy,
      });
      await assignParticipants(actor, {
        id: mixed.id,
        memberIds: ids.slice(0, 4),
        eligible: true,
        reason: "Split fixture",
      });
      const category = await privateTx(actor, (tx) =>
        tx.category.findFirstOrThrow({
          where: { tournamentId: mixed.id, kind: "TEAM" },
        }),
      );
      const roster = await teamUpdate(actor, {
        categoryId: category.id,
        name: "Retained team",
        memberIds: ids.slice(0, 4),
        reason: "Split fixture roster",
      });
      const previous = (
        await owner.query(
          "SELECT value FROM \"IntegrationSetting\" WHERE key='officialSeedTournament'",
        )
      ).rows[0].value;
      const before = (
        await owner.query(
          'SELECT * FROM "Participant" WHERE "tournamentId"=$1 ORDER BY id',
          [mixed.id],
        )
      ).rows;
      await owner.query(
        "UPDATE \"IntegrationSetting\" SET value=$1::jsonb WHERE key='officialSeedTournament'",
        [JSON.stringify(mixed.id)],
      );
      const client = new PrismaClient({
        adapter: new PrismaPg({
          connectionString: process.env.MIGRATION_DATABASE_URL,
          max: 1,
        }),
      });
      try {
        let backups = 0;
        const result = await splitOfficialTournament(client, async () => {
          backups++;
        });
        assert.equal(backups, 1);
        assert.deepEqual(
          (
            await owner.query(
              'SELECT * FROM "Participant" WHERE "tournamentId"=$1 ORDER BY id',
              [mixed.id],
            )
          ).rows,
          before,
        );
        const moved = (
          await owner.query(
            'SELECT c."tournamentId",c.capacity FROM "Team" t JOIN "Category" c ON c.id=t."categoryId" WHERE t.id=$1',
            [roster.id],
          )
        ).rows[0];
        assert.equal(moved.tournamentId, result.teamId);
        assert.equal(moved.capacity, 8);
        assert.equal(
          (
            await owner.query(
              'SELECT count(*)::int n FROM "Participant" WHERE "tournamentId"=$1',
              [result.teamId],
            )
          ).rows[0].n,
          4,
        );
        assert.equal(
          (
            await splitOfficialTournament(client, async () => {
              throw new Error("Repeated backup");
            })
          ).alreadyApplied,
          true,
        );
      } finally {
        await client.$disconnect();
        await owner.query(
          "UPDATE \"IntegrationSetting\" SET value=$1::jsonb WHERE key='officialSeedTournament'",
          [JSON.stringify(previous)],
        );
      }
    },
  );
}
