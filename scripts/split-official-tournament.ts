import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { audit, type Tx } from "../src/lib/db";
import { encrypt } from "../src/lib/crypto";
import { createStages } from "../src/lib/configuration";
import {
  configuration,
  newTournamentConfiguration,
  type TournamentConfiguration,
} from "../src/lib/tournament-config";

export const officialTeamSlug = "pailangz-team";
export async function createOfficialTeamTournament(
  tx: Tx,
  settings: TournamentConfiguration = newTournamentConfiguration,
) {
  const teamConfig = configuration({ ...settings, format: "TEAM" });
  const existing = await tx.integrationSetting.findUnique({
    where: { key: "officialTeamTournament" },
  });
  if (existing)
    return tx.tournament.findUniqueOrThrow({
      where: { id: String(existing.value) },
    });
  // A conflicting slug must be reviewed, never silently adopted or overwritten.
  const team = await tx.tournament.create({
    data: {
      slug: officialTeamSlug,
      name: "PAILANGZ & PAILANGZZ — Team Tournament",
      overview:
        "Kejohanan TEAM dengan empat pemain setiap pasukan. Peringkat knockout BO3; final BO5.",
      overviewEn:
        "TEAM tournament with four players per team. BO3 knockout rounds; BO5 final.",
      configuration: teamConfig,
    },
  });
  await tx.integrationSetting.create({
    data: { key: "officialTeamTournament", value: team.id },
  });
  await audit(
    tx,
    null,
    "TOURNAMENT_CREATE",
    "TOURNAMENT",
    team.id,
    { format: "TEAM", teamCapacity: teamConfig.teamCapacity },
    "Create the independent TEAM event.",
    { source: "OPERATOR", tournamentId: team.id },
  );
  return team;
}

/** Operator-only, idempotent split. SOLO identities and match history stay intact. */
export async function splitOfficialTournament(
  owner: PrismaClient,
  backup: (snapshot: unknown) => Promise<void>,
) {
  return owner.$transaction(
    async (tx) => {
      const marker = await tx.integrationSetting.findUnique({
        where: { key: "officialTournamentFormatSplit" },
      });
      if (marker)
        return {
          alreadyApplied: true,
          ...(marker.value as { soloId: string; teamId: string }),
        };
      const provenance = await tx.integrationSetting.findUniqueOrThrow({
        where: { key: "officialSeedTournament" },
      });
      const id = String(provenance.value);
      await tx.$queryRaw`SELECT id FROM "Tournament" WHERE id=${id} FOR UPDATE`;
      const solo = await tx.tournament.findUniqueOrThrow({
        where: { id },
        include: {
          participants: true,
          participationRequests: true,
          revisions: true,
          categories: {
            include: {
              teams: { include: { memberships: true, applications: true } },
              stages: { include: { rounds: { include: { matches: true } } } },
            },
          },
        },
      });
      if (
        solo.published ||
        !["DRAFT", "REGISTRATION_OPEN", "REGISTRATION_CLOSED"].includes(
          solo.status,
        ) ||
        solo.revisions.some((r) => r.status === "PENDING")
      )
        throw new Error(
          "Split requires an unpublished event before competition starts with no pending configuration revision.",
        );
      const teamCategory = solo.categories.find((c) => c.kind === "TEAM");
      if (
        teamCategory &&
        teamCategory.stages.some(
          (s) =>
            s.published ||
            s.finalized ||
            s.rounds.some((r) => r.matches.length),
        )
      )
        throw new Error(
          "Review TEAM fixtures and capacity before splitting. Existing competition history cannot be resized automatically.",
        );
      await backup(solo);
      const before = configuration(solo.configuration);
      const team = await createOfficialTeamTournament(
        tx,
        teamCategory ? before : newTournamentConfiguration,
      );
      // Retain only the TEAM-associated player pool; SOLO registrations stay in SOLO.
      const teamMemberIds = new Set(
        teamCategory?.teams.flatMap((t) => [
          ...(t.ownerId ? [t.ownerId] : []),
          ...t.memberships.map((m) => m.memberId),
          ...t.applications.map((a) => a.memberId),
        ]) ?? [],
      );
      for (const p of solo.participants.filter((p) =>
        teamMemberIds.has(p.memberId),
      )) {
        const {
          id: previousId,
          tournamentId: previousTournamentId,
          ...fields
        } = p;
        await tx.participant.create({
          data: { ...fields, tournamentId: team.id },
        });
      }
      for (const r of solo.participationRequests.filter((r) =>
        teamMemberIds.has(r.memberId),
      ))
        await tx.participationRequest.create({
          data: {
            tournamentId: team.id,
            memberId: r.memberId,
            createdAt: r.createdAt,
          },
        });
      if (teamCategory) {
        await tx.category.update({
          where: { id: teamCategory.id },
          data: {
            tournamentId: team.id,
            capacity: configuration(team.configuration).teamCapacity,
          },
        });
      } else if (
        !(await tx.category.count({ where: { tournamentId: team.id } }))
      ) {
        await createStages(tx, team.id, configuration(team.configuration));
      }
      const after = { ...before, format: "SOLO" as const };
      if (before.format !== "SOLO") {
        const revision = await tx.configurationRevision.create({
          data: {
            tournamentId: solo.id,
            version:
              Math.max(
                solo.configurationVersion,
                ...solo.revisions.map((r) => r.version),
              ) + 1,
            beforeConfiguration: before,
            configuration: after,
            requiresAdmin: false,
            reasonEncrypted: encrypt(
              "Separate SOLO and TEAM events; retain SOLO entries, rules and fixtures.",
              `tournament:${solo.id}`,
            ),
            createdBy: "SYSTEM_TOURNAMENT_FORMAT_SPLIT",
          },
        });
        await tx.$executeRaw`SELECT set_config('app.config_revision_id',${revision.id},true)`;
        await tx.tournament.update({
          where: { id: solo.id },
          data: {
            configuration: after,
            configurationVersion: revision.version,
          },
        });
        await tx.configurationRevision.update({
          where: { id: revision.id },
          data: {
            status: "APPLIED",
            appliedAt: new Date(),
            appliedBy: "SYSTEM_TOURNAMENT_FORMAT_SPLIT",
          },
        });
      }
      await tx.tournament.update({
        where: { id: solo.id },
        data: {
          name: "PAILANGZ & PAILANGZZ — Solo Tournament",
          overview:
            "Kejohanan SOLO PAILANGZ dan PAILANGZZ: liga, kelayakan dan knockout. Pemain bebas memilih weapons dan weapon modes.",
          overviewEn:
            "PAILANGZ and PAILANGZZ SOLO tournament: league, qualification and knockout. Players may choose their weapons and weapon modes.",
        },
      });
      const result = { soloId: solo.id, teamId: team.id };
      await tx.integrationSetting.create({
        data: { key: "officialTournamentFormatSplit", value: result },
      });
      await audit(
        tx,
        null,
        "TOURNAMENT_FORMAT_SPLIT",
        "TOURNAMENT",
        solo.id,
        {
          ...result,
          transferredTeamCategoryId: teamCategory?.id ?? null,
          preservedSoloPlayers: solo.participants.length,
        },
        "Split the original event into independent SOLO and TEAM tournaments.",
        { source: "OPERATOR", tournamentId: solo.id },
      );
      return { alreadyApplied: false, ...result };
    },
    { timeout: 60000 },
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  if (
    process.env.APP_ENV !== "development" ||
    process.env.DATABASE_ENV !== "development"
  )
    throw new Error(
      "This command targets local development only. Hosted splits require an explicitly authorized operator run.",
    );
  const url = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url || !["localhost", "127.0.0.1"].includes(new URL(url).hostname))
    throw new Error("A local database is required.");
  const owner = new PrismaClient({
    adapter: new PrismaPg({ connectionString: url, max: 1 }),
  });
  try {
    console.log(
      await splitOfficialTournament(owner, async (snapshot) => {
        await mkdir(".local/tournament-split", {
          recursive: true,
          mode: 0o700,
        });
        await writeFile(
          `.local/tournament-split/before-${randomUUID()}.json`,
          JSON.stringify(snapshot),
          { flag: "wx", mode: 0o600 },
        );
      }),
    );
  } finally {
    await owner.$disconnect();
  }
}
