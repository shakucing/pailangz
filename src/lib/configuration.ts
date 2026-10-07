import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { privateTx, audit, type Actor, type Tx } from "./db";
import { encrypt } from "./crypto";
import {
  DomainError,
  requireReason,
  optionalNote,
  type Standing,
} from "./domain";
import {
  configuration,
  generateLeague,
  type TournamentConfiguration,
} from "./tournament-config";
import { standingsFor } from "./competition";
export async function createStages(
  tx: Tx,
  tournamentId: string,
  config: TournamentConfiguration,
) {
  for (const kind of ["SOLO", "TEAM"] as const) {
    const category = await tx.category.upsert({
      where: { tournamentId_kind: { tournamentId, kind } },
      create: {
        tournamentId,
        kind,
        capacity: kind === "SOLO" ? config.soloCapacity : config.teamCapacity,
      },
      update: {
        capacity: kind === "SOLO" ? config.soloCapacity : config.teamCapacity,
      },
    });
    const definitions =
      kind === "TEAM"
        ? ([["knockout", "TEAM · Knockout", "KNOCKOUT", 3]] as const)
        : ([
            [
              "league",
              `SOLO · ${config.leagueRounds}-round league`,
              "LEAGUE",
              3,
            ],
            ...(config.playoffEntrants
              ? ([
                  ["qualification", "SOLO · Qualification", "LEAGUE", 3],
                ] as const)
              : []),
            ["knockout", "SOLO · Knockout", "KNOCKOUT", 5],
          ] as const);
    for (const [key, name, format, bestOf] of definitions)
      await tx.stage.create({
        data: {
          categoryId: category.id,
          key,
          name,
          format,
          bestOf,
          rules: { seriesPoints: true },
          confirmedRules: [],
        },
      });
  }
}
async function checkCapacity(
  tx: Tx,
  tournamentId: string,
  config: TournamentConfiguration,
) {
  const players = await tx.participant.count({ where: { tournamentId } }),
    teams = await tx.team.count({
      where: { category: { tournamentId, kind: "TEAM" }, archived: false },
    });
  if (config.soloCapacity < players || config.teamCapacity < teams)
    throw new DomainError(
      `Capacity must retain all ${players} assigned SOLO entrants and ${teams} active teams. No records can be silently removed.`,
    );
}
async function activeResults(tx: Tx, tournamentId: string) {
  return tx.resultVersion.count({
    where: {
      match: {
        round: { stage: { archived: false, category: { tournamentId } } },
      },
    },
  });
}
async function apply(
  tx: Tx,
  actor: Actor,
  revisionId: string,
  resolution: string,
) {
  const revision = await tx.configurationRevision.findUniqueOrThrow({
    where: { id: revisionId },
    include: { tournament: true },
  });
  if (revision.status !== "PENDING")
    throw new DomainError("Only pending revisions can be applied.");
  if (revision.requiresAdmin && actor.role !== "ADMIN")
    throw new DomainError("Controlled revisions require an admin.", 403);
  const config = configuration(revision.configuration);
  await checkCapacity(tx, revision.tournamentId, config);
  if (revision.tournament.configurationVersion >= revision.version)
    throw new DomainError(
      "The configuration changed; submit a new revision.",
      409,
    );
  const stages = await tx.stage.findMany({
    where: {
      category: { tournamentId: revision.tournamentId },
      archived: false,
    },
  });
  // Capture every derived table before renaming the league or invalidating its
  // snapshots: qualification may carry points from that league snapshot.
  const standings = new Map<string, Standing[]>();
  for (const stage of stages) {
    const frozen = await tx.rankingSnapshot.findFirst({
      where: { stageId: stage.id, stale: false },
      orderBy: { version: "desc" },
    });
    standings.set(
      stage.id,
      frozen
        ? (frozen.rankings as Standing[])
        : stage.format === "LEAGUE"
          ? (await standingsFor(tx, stage.id)).rows
          : [],
    );
  }
  for (const stage of stages) {
    const rows = standings.get(stage.id)!;
    await tx.rankingSnapshot.updateMany({
      where: { stageId: stage.id },
      data: { stale: true },
    });
    const dependencies = await tx.bracketDependency.findMany({
      where: { match: { round: { stageId: stage.id } } },
    });
    for (const dependency of dependencies)
      await tx.bracketDependency.update({
        where: { id: dependency.id },
        data: {
          stale: false,
          resolutionReason: encrypt(resolution, `dependency:${dependency.id}`),
        },
      });
    await tx.stage.update({
      where: { id: stage.id },
      data: {
        archived: true,
        published: false,
        key: `${stage.key}:revision:${revision.id}`,
        name: `${stage.name} · archived v${revision.tournament.configurationVersion}`,
        archivedStandings: rows as Prisma.InputJsonValue,
      },
    });
  }
  await tx.$executeRaw`SELECT set_config('app.config_revision_id',${revision.id},true)`;
  await tx.tournament.update({
    where: { id: revision.tournamentId },
    data: {
      configuration: config,
      configurationVersion: revision.version,
      published: false,
      status: "DRAFT",
    },
  });
  await createStages(tx, revision.tournamentId, config);
  await tx.configurationRevision.update({
    where: { id: revision.id },
    data: {
      status: "APPLIED",
      resolutionEncrypted: encrypt(resolution, `revision:${revision.id}`),
      appliedBy: actor.id,
      appliedAt: new Date(),
    },
  });
  const players = await tx.participant.findMany({
    where: { tournamentId: revision.tournamentId },
    orderBy: { code: "asc" },
  });
  if (players.length === config.soloCapacity)
    await generateFixtures(
      tx,
      actor,
      revision.tournamentId,
      config,
      players.map((p) => p.id),
      resolution,
    );
  await audit(
    tx,
    actor,
    "CONFIGURATION_REVISION_APPLY",
    "TOURNAMENT",
    revision.tournamentId,
    {
      revisionId: revision.id,
      version: revision.version,
      archivedStageIds: stages.map((s) => s.id),
      preservedResults: true,
      resolution: revision.requiresAdmin
        ? "restart_stages_with_retained_history"
        : "draft_regeneration",
    },
    revision.requiresAdmin
      ? requireReason(resolution)
      : optionalNote(resolution),
  );
  return { id: revision.id, status: "APPLIED" };
}
async function generateFixtures(
  tx: Tx,
  actor: Actor,
  tournamentId: string,
  config: TournamentConfiguration,
  ids: string[],
  reason: string,
) {
  const stage = await tx.stage.findFirstOrThrow({
    where: {
      category: { tournamentId, kind: "SOLO" },
      key: "league",
      archived: false,
    },
  });
  if (await tx.round.count({ where: { stageId: stage.id } }))
    throw new DomainError(
      "Fixtures already exist. Apply an audited configuration revision to regenerate.",
    );
  const schedule = generateLeague(ids, config);
  for (const [i, pairs] of schedule.entries()) {
    const round = await tx.round.create({
      data: { stageId: stage.id, number: i + 1, name: `Round ${i + 1}` },
    });
    for (const [j, pair] of pairs.entries())
      await tx.match.create({
        data: {
          roundId: round.id,
          order: j + 1,
          sideAId: pair.a,
          sideBId: pair.b,
          bestOf: 3,
          status: pair.b === null ? "BYE" : "SCHEDULED",
        },
      });
  }
  await audit(
    tx,
    actor,
    "FIXTURES_GENERATE",
    "STAGE",
    stage.id,
    {
      rounds: schedule.length,
      matches: (ids.length * config.leagueMatchesPerPlayer) / 2,
      byes: config.soloCapacity % 2 ? config.soloCapacity : 0,
    },
    optionalNote(reason),
    { tournamentId, stageId: stage.id },
  );
}
export async function configureTournament(
  actor: Actor,
  input: {
    id: string;
    configuration: unknown;
    regenerate: boolean;
    reason: string;
  },
) {
  const config = configuration(input.configuration);
  if (config.scheduleSource !== "generated")
    throw new DomainError(
      "The supplied schedule is reserved for the original seed. Use generated for a new configuration.",
    );
  return privateTx(actor, async (tx) => {
    const tournament = await tx.tournament.findUniqueOrThrow({
      where: { id: input.id },
    });
    await checkCapacity(tx, tournament.id, config);
    const requiresAdmin =
      !!(await activeResults(tx, tournament.id)) ||
      tournament.published ||
      !!(await tx.match.count({
        where: {
          round: {
            stage: {
              archived: false,
              category: { tournamentId: tournament.id },
            },
          },
          status: { notIn: ["SCHEDULED", "BYE"] },
        },
      })) ||
      ["IN_PROGRESS", "COMPLETED", "ARCHIVED"].includes(tournament.status);
    if (!input.regenerate && !requiresAdmin)
      throw new DomainError(
        "Explicitly acknowledge fixture/stage regeneration before applying draft changes.",
      );
    if (
      await tx.configurationRevision.count({
        where: { tournamentId: tournament.id, status: "PENDING" },
      })
    )
      throw new DomainError(
        "Resolve the existing pending revision first.",
        409,
      );
    const latest = await tx.configurationRevision.findFirst({
      where: { tournamentId: tournament.id },
      orderBy: { version: "desc" },
    });
    const revision = await tx.configurationRevision.create({
      data: {
        tournamentId: tournament.id,
        version:
          Math.max(tournament.configurationVersion, latest?.version ?? 0) + 1,
        beforeConfiguration: configuration(tournament.configuration),
        configuration: config,
        requiresAdmin,
        reasonEncrypted: encrypt(
          requiresAdmin
            ? requireReason(input.reason)
            : optionalNote(input.reason),
          `tournament:${tournament.id}`,
        ),
        createdBy: actor.id,
      },
    });
    // A rejected proposal can consume a version; applied versions need only move forward.
    await audit(
      tx,
      actor,
      "CONFIGURATION_REVISION_PROPOSE",
      "TOURNAMENT",
      tournament.id,
      {
        revisionId: revision.id,
        version: revision.version,
        requiresAdmin,
        before: tournament.configuration,
        after: config,
      },
      requiresAdmin ? requireReason(input.reason) : optionalNote(input.reason),
    );
    if (requiresAdmin) return { id: revision.id, status: "PENDING" };
    return apply(tx, actor, revision.id, input.reason);
  });
}
export async function applyRevision(
  actor: Actor,
  input: { id: string; acknowledgement: string; reason: string },
) {
  if (actor.role !== "ADMIN")
    throw new DomainError("Admin permission is required.", 403);
  if (input.acknowledgement !== "RESTART_AND_RETAIN_HISTORY")
    throw new DomainError(
      "Explicit restart acknowledgement is required. Previous results remain in archived stages and do not count in the new revision.",
    );
  return privateTx(actor, (tx) =>
    apply(tx, actor, input.id, requireReason(input.reason)),
  );
}
export async function rejectRevision(
  actor: Actor,
  input: { id: string; reason: string },
) {
  if (actor.role !== "ADMIN")
    throw new DomainError("Admin permission is required.", 403);
  return privateTx(actor, async (tx) => {
    const r = await tx.configurationRevision.findUniqueOrThrow({
      where: { id: input.id },
    });
    if (r.status !== "PENDING")
      throw new DomainError("Only pending proposals can be rejected.");
    await tx.configurationRevision.update({
      where: { id: r.id },
      data: {
        status: "REJECTED",
        resolutionEncrypted: encrypt(
          requireReason(input.reason),
          `revision:${r.id}`,
        ),
      },
    });
    await audit(
      tx,
      actor,
      "CONFIGURATION_REVISION_REJECT",
      "TOURNAMENT",
      r.tournamentId,
      { revisionId: r.id },
      input.reason,
    );
    return { id: r.id };
  });
}
export async function assignParticipants(
  actor: Actor,
  input: { id: string; memberIds: string[]; eligible: boolean; reason: string },
) {
  return privateTx(actor, async (tx) => {
    const t = await tx.tournament.findUniqueOrThrow({
        where: { id: input.id },
      }),
      config = configuration(t.configuration);
    if (t.published || (await activeResults(tx, t.id)))
      throw new DomainError(
        "Entrant changes require an unpublished configuration without active results.",
      );
    const ids = z
      .array(z.string().uuid())
      .min(1)
      .max(config.soloCapacity)
      .parse(input.memberIds);
    if (new Set(ids).size !== ids.length)
      throw new DomainError("Choose distinct members.");
    const members = await tx.member.findMany({
      where: { id: { in: ids }, verified: true, archived: false },
    });
    if (members.length !== ids.length)
      throw new DomainError("Only approved active members may be assigned.");
    const existing = await tx.participant.findMany({
        where: { tournamentId: t.id },
      }),
      newIds = ids.filter((id) => !existing.some((p) => p.memberId === id));
    if (existing.length + newIds.length > config.soloCapacity)
      throw new DomainError("Configured SOLO capacity is full.");
    let next =
      Math.max(0, ...existing.map((p) => Number(p.code.slice(1)) || 0)) + 1;
    for (const memberId of newIds)
      await tx.participant.create({
        data: {
          tournamentId: t.id,
          memberId,
          code: `P${String(next++).padStart(2, "0")}`,
          eligible: input.eligible,
          provisional: !t.mappingConfirmed,
        },
      });
    await audit(
      tx,
      actor,
      "PARTICIPANTS_ASSIGN",
      "TOURNAMENT",
      t.id,
      { memberIds: newIds, eligible: input.eligible },
      optionalNote(input.reason),
    );
    return { created: newIds.length };
  });
}
export async function generateTournamentLeague(
  actor: Actor,
  input: { id: string; reason: string },
) {
  return privateTx(actor, async (tx) => {
    const t = await tx.tournament.findUniqueOrThrow({
      where: { id: input.id },
    });
    if (t.published || (await activeResults(tx, t.id)))
      throw new DomainError(
        "Use a controlled revision after publication or results.",
      );
    const players = await tx.participant.findMany({
      where: { tournamentId: t.id },
      orderBy: { code: "asc" },
    });
    await generateFixtures(
      tx,
      actor,
      t.id,
      configuration(t.configuration),
      players.map((p) => p.id),
      input.reason,
    );
    return { id: t.id };
  });
}
