import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { PrismaClient, Prisma } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { audit } from "../src/lib/db";
import { encrypt } from "../src/lib/crypto";
import { createStages } from "../src/lib/configuration";
import { newTournamentConfiguration } from "../src/lib/tournament-config";

// Operator-only reset for the named, unplayed event. Member identities, private
// registrations, applications and immutable audit history are never deleted.
export async function resetOfficialTournament(
  owner: PrismaClient,
  apply: boolean,
  backup: (snapshot: unknown) => Promise<void>,
) {
  return owner.$transaction(
    async (tx) => {
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
      const summary = {
        players: tournament.participants.length,
        fixtures: matches.length,
        teams: tournament.categories
          .flatMap((c) => c.teams)
          .filter((t) => !t.archived).length,
        applicationsRetained: tournament.participationRequests.length,
        configuration: newTournamentConfiguration,
      };
      if (!apply) return { applied: false, ...summary };
      if (
        !summary.players &&
        !summary.fixtures &&
        !summary.teams &&
        isDeepStrictEqual(tournament.configuration, newTournamentConfiguration)
      )
        return { applied: false, ...summary };

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
        const directory = path.resolve(".local/tournament-reset");
        await mkdir(directory, { recursive: true, mode: 0o700 });
        await writeFile(
          path.join(directory, `pailangz-${Date.now()}.json`),
          JSON.stringify(snapshot, null, 2),
          { mode: 0o600, flag: "wx" },
        );
      },
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
