import "dotenv/config";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { PrismaClient, Prisma } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { audit } from "../src/lib/db";
import { decrypt, encrypt } from "../src/lib/crypto";
import { createStages } from "../src/lib/configuration";
import { newTournamentConfiguration as soloDefaults } from "../src/lib/tournament-config";
import { emptyTournamentUpgrade } from "./neon-data-upgrade";

const { format: _format, ...newTournamentConfiguration } = soloDefaults;

// Operator-only reset for the named, unplayed event. Member identities, private
// registrations, applications and immutable audit history are never deleted.
export async function resetOfficialTournament(
  owner: PrismaClient,
  apply: boolean,
  backup: (snapshot: unknown) => Promise<void>,
  options: { upgradeId?: string; production?: boolean } = {},
) {
  return owner.$transaction(
    async (tx) => {
      if (options.production) {
        const [environment] = await tx.$queryRaw<
          { tier: string; owner: boolean }[]
        >`SELECT tier, current_user=pg_get_userbyid(c.relowner) AS owner
          FROM "DeploymentEnvironment", pg_class c WHERE c.oid='public."Tournament"'::regclass`;
        if (environment?.tier !== "production" || !environment.owner)
          throw new Error(
            "Production reset requires the production table owner.",
          );
      }
      if (options.upgradeId) {
        const [lock] = await tx.$queryRaw<{ acquired: boolean }[]>`
          SELECT pg_try_advisory_xact_lock(hashtextextended(${options.upgradeId},0)) AS acquired`;
        if (!lock.acquired)
          throw new Error("The tournament data upgrade is already running.");
      }
      const setting = await tx.integrationSetting.findUniqueOrThrow({
        where: { key: "officialSeedTournament" },
      });
      const id = String(setting.value);
      await tx.$queryRaw`SELECT id FROM "Tournament" WHERE id = ${id} FOR UPDATE`;
      const tournament = await tx.tournament.findUniqueOrThrow({
        where: { id },
        include: {
          participants: true,
          participationRequests: true,
          revisions: true,
          categories: {
            include: {
              teams: { include: { memberships: true } },
              stages: {
                include: {
                  snapshots: true,
                  rounds: {
                    include: {
                      matches: {
                        include: {
                          results: true,
                          disputes: true,
                          dependencies: true,
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      });
      const stages = tournament.categories.flatMap((c) => c.stages);
      const matches = stages.flatMap((s) => s.rounds.flatMap((r) => r.matches));
      const summary = {
        players: tournament.participants.length,
        fixtures: matches.length,
        teams: tournament.categories
          .flatMap((c) => c.teams)
          .filter((t) => !t.archived).length,
        applicationsRetained: tournament.participationRequests.length,
        configuration: newTournamentConfiguration,
      };
      // Independent events supersede this historical combined-event reset.
      if ((tournament.configuration as { format?: string }).format)
        return { applied: false, alreadyApplied: true, ...summary };
      // Check the durable marker before reset guards: future migrations must
      // leave new entrants, published events and played matches untouched.
      if (
        options.upgradeId &&
        (await tx.auditEvent.findFirst({
          where: {
            action: "TOURNAMENT_APPLICATION_RESET",
            source: "OPERATOR",
            outcome: "SUCCESS",
            changes: { path: ["upgradeId"], equals: options.upgradeId },
          },
        }))
      )
        return { applied: false, alreadyApplied: true, ...summary };
      if (
        tournament.slug !== "pailangz-solo-team" ||
        tournament.published ||
        !["DRAFT", "REGISTRATION_OPEN", "REGISTRATION_CLOSED"].includes(
          tournament.status,
        ) ||
        tournament.revisions.some((r) => r.status === "PENDING") ||
        stages.some(
          (s) => s.archived || s.published || s.finalized || s.snapshots.length,
        ) ||
        matches.some(
          (m) =>
            !["SCHEDULED", "BYE"].includes(m.status) ||
            m.results.length ||
            m.disputes.length ||
            m.dependencies.length,
        ) ||
        tournament.participationRequests.length > 32
      )
        throw new Error(
          "Reset requires the original unplayed event with no published or retained competition history, pending revision, or excess applications.",
        );
      if (options.production) {
        // Never encrypt production revision notes with keys from the local DB.
        // Verify the saved production keyring against existing ciphertext first.
        encrypt("Key validation", `tournament:${id}`);
        for (const revision of tournament.revisions)
          decrypt(revision.reasonEncrypted, `tournament:${id}`);
        const privateMember = await tx.memberPrivate.findFirst();
        if (privateMember)
          decrypt(
            privateMember.registrationEncrypted,
            `member:${privateMember.memberId}`,
          );
      }
      if (!apply) return { applied: false, ...summary };
      if (
        !summary.players &&
        !summary.fixtures &&
        !summary.teams &&
        isDeepStrictEqual(tournament.configuration, newTournamentConfiguration)
      ) {
        if (options.upgradeId)
          await audit(
            tx,
            null,
            "TOURNAMENT_APPLICATION_RESET",
            "TOURNAMENT",
            id,
            {
              upgradeId: options.upgradeId,
              alreadyEmpty: true,
              applicationLimit: 32,
            },
            "Recorded the existing empty 32-player draft as the completed one-time upgrade.",
            { source: "OPERATOR", tournamentId: id },
          );
        return { applied: false, ...summary };
      }

      await backup(tournament);
      const stageIds = stages.map((s) => s.id);
      const categoryIds = tournament.categories.map((c) => c.id);
      await tx.match.deleteMany({
        where: { round: { stageId: { in: stageIds } } },
      });
      await tx.round.deleteMany({ where: { stageId: { in: stageIds } } });
      await tx.stage.deleteMany({ where: { id: { in: stageIds } } });
      await tx.participant.deleteMany({ where: { tournamentId: id } });
      await tx.teamMembership.updateMany({
        where: { categoryId: { in: categoryIds }, active: true },
        data: { active: false },
      });
      await tx.team.updateMany({
        where: { categoryId: { in: categoryIds }, archived: false },
        data: { archived: true },
      });

      const reason =
        "User requested 32 player applications, removal of current fixtures and tournament assignments, retention of all member records and the 32-player formula.";
      const version =
        Math.max(
          tournament.configurationVersion,
          ...tournament.revisions.map((r) => r.version),
        ) + 1;
      const revision = await tx.configurationRevision.create({
        data: {
          tournamentId: id,
          version,
          beforeConfiguration:
            tournament.configuration as Prisma.InputJsonValue,
          configuration: newTournamentConfiguration,
          reasonEncrypted: encrypt(reason, `tournament:${id}`),
          createdBy: "OPERATOR",
        },
      });
      await tx.$executeRaw`SELECT set_config('app.config_revision_id', ${revision.id}, true)`;
      await tx.tournament.update({
        where: { id },
        data: {
          configuration: newTournamentConfiguration,
          configurationVersion: version,
          mappingConfirmed: false,
        },
      });
      await createStages(tx, id, newTournamentConfiguration);
      await tx.configurationRevision.update({
        where: { id: revision.id },
        data: {
          status: "APPLIED",
          appliedBy: "OPERATOR",
          appliedAt: new Date(),
          resolutionEncrypted: encrypt(reason, `revision:${revision.id}`),
        },
      });
      await audit(
        tx,
        null,
        "TOURNAMENT_APPLICATION_RESET",
        "TOURNAMENT",
        id,
        {
          ...(options.upgradeId ? { upgradeId: options.upgradeId } : {}),
          revisionId: revision.id,
          version,
          removedFixtures: summary.fixtures,
          removedAssignments: summary.players,
          archivedTeams: summary.teams,
          applicationsRetained: summary.applicationsRetained,
          retainedMembers: true,
          applicationLimit: 32,
        },
        reason,
        { source: "OPERATOR", tournamentId: id },
      );
      return { applied: true, ...summary };
    },
    { isolationLevel: "Serializable", timeout: 60000 },
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const owner = new PrismaClient({
    adapter: new PrismaPg({
      connectionString: process.env.MIGRATION_DATABASE_URL,
      max: 1,
      options: "-c timezone=UTC",
    }),
  });
  try {
    if (!process.env.MIGRATION_DATABASE_URL)
      throw new Error("Owner database connection required.");
    const result = await resetOfficialTournament(
      owner,
      process.argv.includes("--apply"),
      async (snapshot) => {
        const directory = path.resolve(
          process.env.TOURNAMENT_RESET_BACKUP_DIR ?? ".local/tournament-reset",
        );
        await mkdir(directory, { recursive: true, mode: 0o700 });
        await chmod(directory, 0o700);
        await writeFile(
          path.join(directory, `pailangz-${Date.now()}-${randomUUID()}.json`),
          JSON.stringify(snapshot, null, 2),
          { mode: 0o600, flag: "wx" },
        );
      },
      process.argv.includes("--neon-upgrade")
        ? { upgradeId: emptyTournamentUpgrade, production: true }
        : {},
    );
    console.log(JSON.stringify(result));
  } catch {
    console.error(
      "Tournament reset failed; the transaction was rolled back. Check the owner connection and reset prerequisites. No member records were deleted.",
    );
    process.exitCode = 1;
  } finally {
    await owner.$disconnect();
  }
}
