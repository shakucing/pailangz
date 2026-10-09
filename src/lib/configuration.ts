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
  tournamentKinds,
  playerCapacity,
  generateLeague,
  type TournamentConfiguration,
} from "./tournament-config";
import { standingsFor } from "./competition";
export async function createStages(
  tx: Tx,
  tournamentId: string,
  config: TournamentConfiguration,
) {
  for (const kind of tournamentKinds(config)) {
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
        ? ([
            [
              "knockout",
              "TEAM · Knockout",
              "KNOCKOUT",
              config.teamKnockoutBestOf,
            ],
          ] as const)
        : ([
            [
              "league",
              `SOLO · ${config.leagueRounds}-round league`,
              "LEAGUE",
              config.leagueBestOf,
            ],
            ...(config.playoffEntrants
              ? ([
                  ["qualification", "SOLO · Qualification", "LEAGUE", 3],
                ] as const)
              : []),
            [
              "knockout",
              "SOLO · Knockout",
              "KNOCKOUT",
              config.soloKnockoutBestOf,
            ],
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
  const players = await tx.participant.count({
      where: { tournamentId, withdrawn: false },
    }),
    teams = await tx.team.count({
      where: { category: { tournamentId, kind: "TEAM" }, archived: false },
    });
  const [pool] = await tx.$queryRaw<
    { count: bigint }[]
  >`SELECT count(*) AS count FROM (
      SELECT p."memberId" FROM "Participant" p WHERE p."tournamentId"=${tournamentId} AND NOT p.withdrawn
      UNION
      SELECT a."memberId" FROM "ParticipationRequest" a WHERE a."tournamentId"=${tournamentId}
        AND NOT EXISTS(SELECT FROM "Participant" p WHERE p."tournamentId"=${tournamentId} AND p."memberId"=a."memberId" AND p.withdrawn)
    ) active_players`;
  if (
    playerCapacity(config) < Math.max(players, Number(pool.count)) ||
    (config.format !== "SOLO" && config.teamCapacity < teams)
  )
    throw new DomainError(
      `Capacity must retain all ${players} assigned players and ${teams} active teams. No records can be silently removed.`,
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
  generate = true,
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
      registrationEnabled: false,
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
    where: { tournamentId: revision.tournamentId, withdrawn: false },
    orderBy: { code: "asc" },
  });
  if (
    generate &&
    config.format !== "TEAM" &&
    players.length === config.soloCapacity
  )
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
  if (config.format === "TEAM")
    throw new DomainError(
      "TEAM tournaments use a knockout bracket, not a SOLO league.",
    );
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
          bestOf: config.leagueBestOf,
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
    if (configuration(tournament.configuration).format !== config.format)
      throw new DomainError(
        "Tournament format cannot be changed. Create a separate SOLO or TEAM event.",
      );
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
    await tx.$queryRaw`SELECT id FROM "Tournament" WHERE id=${input.id} FOR UPDATE`;
    const t = await tx.tournament.findUniqueOrThrow({
      where: { id: input.id },
    });
    const config = configuration(t.configuration);
    if (
      t.published ||
      !["DRAFT", "REGISTRATION_OPEN", "REGISTRATION_CLOSED"].includes(
        t.status,
      ) ||
      (await activeResults(tx, t.id))
    )
      throw new DomainError(
        "Entrant changes require an unpublished tournament that has not started.",
      );
    const ids = z
      .array(z.string().uuid())
      .min(1)
      .max(playerCapacity(config))
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
    });
    const newIds = ids.filter(
      (id) => !existing.some((p) => p.memberId === id && !p.withdrawn),
    );
    const requests = await tx.participationRequest.findMany({
      where: { tournamentId: t.id },
      select: { memberId: true },
    });
    const reserved = new Set([
      ...existing.filter((p) => !p.withdrawn).map((p) => p.memberId),
      ...requests
        .filter(
          (a) =>
            !existing.some((p) => p.memberId === a.memberId && p.withdrawn),
        )
        .map((a) => a.memberId),
      ...newIds,
    ]);
    if (reserved.size > playerCapacity(config))
      throw new DomainError("Configured player capacity is full.");
    let next =
      Math.max(0, ...existing.map((p) => Number(p.code.slice(1)) || 0)) + 1;
    for (const memberId of newIds) {
      const previous = existing.find((p) => p.memberId === memberId);
      const data = {
        eligible: input.eligible,
        provisional: !t.mappingConfirmed,
        withdrawn: false,
      };
      if (previous)
        await tx.participant.update({ where: { id: previous.id }, data });
      else
        await tx.participant.create({
          data: {
            tournamentId: t.id,
            memberId,
            code: `P${String(next++).padStart(2, "0")}`,
            ...data,
          },
        });
    }
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

/** Retain old identities and fixtures; rebuild only an unplayed private draft. */
export async function changeEntrant(
  actor: Actor,
  input: { id: string; replacementMemberId?: string; reason: string },
) {
  const reason = requireReason(input.reason);
  return privateTx(actor, async (tx) => {
    const p = await tx.participant.findUniqueOrThrow({
      where: { id: input.id },
    });
    await tx.$queryRaw`SELECT id FROM "Tournament" WHERE id=${p.tournamentId} FOR UPDATE`;
    const t = await tx.tournament.findUniqueOrThrow({
      where: { id: p.tournamentId },
    });
    const activeStage = { archived: false, category: { tournamentId: t.id } };
    if (p.withdrawn)
      throw new DomainError("This player has already withdrawn.");
    if (
      t.published ||
      !["DRAFT", "REGISTRATION_OPEN", "REGISTRATION_CLOSED"].includes(
        t.status,
      ) ||
      (await activeResults(tx, t.id)) ||
      (await tx.match.count({
        where: {
          round: { stage: activeStage },
          status: { notIn: ["SCHEDULED", "BYE"] },
        },
      }))
    )
      throw new DomainError(
        "Unpublish before changing entrants. Started matches and results require an admin-controlled restart.",
      );
    if (
      await tx.configurationRevision.count({
        where: { tournamentId: t.id, status: "PENDING" },
      })
    )
      throw new DomainError("Resolve the pending tournament revision first.");
    const memberships = await tx.teamMembership.findMany({
      where: {
        memberId: p.memberId,
        active: true,
        category: { tournamentId: t.id },
      },
      include: { team: true },
    });
    const replacement = input.replacementMemberId;
    if (replacement) {
      const member = await tx.member.findUniqueOrThrow({
        where: { id: replacement },
      });
      if (!member.verified || member.archived || replacement === p.memberId)
        throw new DomainError("Choose a different approved, active member.");
      if (
        await tx.participant.count({
          where: {
            tournamentId: t.id,
            memberId: replacement,
            withdrawn: false,
          },
        })
      )
        throw new DomainError(
          "The replacement already has a tournament place.",
        );
      if (
        await tx.teamMembership.count({
          where: {
            memberId: replacement,
            active: true,
            category: { tournamentId: t.id },
          },
        })
      )
        throw new DomainError(
          "Remove the replacement from their existing team first.",
        );
    } else if (memberships.some((m) => m.team.ownerId === p.memberId)) {
      throw new DomainError(
        "This player owns a team. Choose a replacement to transfer ownership, or archive their team before withdrawing them.",
      );
    }
    const config = configuration(t.configuration);
    const hadFixtures = !!(await tx.round.count({
      where: { stage: activeStage },
    }));
    if (hadFixtures) {
      const stages = await tx.stage.findMany({ where: activeStage });
      const latest = await tx.configurationRevision.findFirst({
        where: { tournamentId: t.id },
        orderBy: { version: "desc" },
      });
      const revision = await tx.configurationRevision.create({
        data: {
          tournamentId: t.id,
          version: Math.max(t.configurationVersion, latest?.version ?? 0) + 1,
          beforeConfiguration: config,
          configuration: { ...config, scheduleSource: "generated" },
          requiresAdmin: false,
          reasonEncrypted: encrypt(reason, `tournament:${t.id}`),
          createdBy: actor.id,
        },
      });
      await apply(tx, actor, revision.id, reason, false);
      // Roster changes do not change the format or confirmed scoring rules.
      for (const stage of stages)
        await tx.stage.updateMany({
          where: {
            categoryId: stage.categoryId,
            key: stage.key,
            archived: false,
          },
          data: {
            rules: stage.rules as Prisma.InputJsonValue,
            confirmedRules: stage.confirmedRules,
            ruleVersion: stage.ruleVersion,
          },
        });
    }
    await tx.participant.update({
      where: { id: p.id },
      data: { withdrawn: true, eligible: false },
    });
    let replacementId: string | undefined;
    if (replacement) {
      const previous = await tx.participant.findUnique({
        where: {
          tournamentId_memberId: { tournamentId: t.id, memberId: replacement },
        },
      });
      if (previous) {
        replacementId = previous.id;
        await tx.participant.update({
          where: { id: previous.id },
          data: { withdrawn: false, eligible: true, provisional: true },
        });
      } else {
        const all = await tx.participant.findMany({
          where: { tournamentId: t.id },
          select: { code: true },
        });
        const next =
          Math.max(0, ...all.map((p) => Number(p.code.slice(1)) || 0)) + 1;
        replacementId = (
          await tx.participant.create({
            data: {
              tournamentId: t.id,
              memberId: replacement,
              code: `P${String(next).padStart(2, "0")}`,
              eligible: true,
              provisional: true,
            },
          })
        ).id;
      }
    }
    for (const membership of memberships) {
      await tx.teamMembership.update({
        where: { id: membership.id },
        data: { active: false },
      });
      if (replacement) {
        await tx.teamMembership.create({
          data: {
            teamId: membership.teamId,
            categoryId: membership.categoryId,
            memberId: replacement,
          },
        });
        if (membership.team.ownerId === p.memberId)
          await tx.team.update({
            where: { id: membership.teamId },
            data: { ownerId: replacement },
          });
      }
    }
    await tx.teamApplication.updateMany({
      where: {
        memberId: p.memberId,
        team: { category: { tournamentId: t.id } },
        status: "PENDING",
      },
      data: { status: "REJECTED", decidedAt: new Date() },
    });
    await tx.tournament.update({
      where: { id: t.id },
      data: {
        mappingConfirmed: false,
        status: t.status,
        registrationEnabled: t.registrationEnabled,
      },
    });
    const players = await tx.participant.findMany({
      where: { tournamentId: t.id, withdrawn: false },
      orderBy: { code: "asc" },
    });
    if (
      hadFixtures &&
      config.format !== "TEAM" &&
      players.length === config.soloCapacity
    )
      await generateFixtures(
        tx,
        actor,
        t.id,
        { ...config, scheduleSource: "generated" },
        players.map((p) => p.id),
        reason,
      );
    await audit(
      tx,
      actor,
      replacement ? "PARTICIPANT_REPLACE" : "PARTICIPANT_WITHDRAW",
      "PARTICIPANT",
      p.id,
      {
        previousMemberId: p.memberId,
        replacementMemberId: replacement,
        replacementId,
        rebuiltFixtures: hadFixtures,
        teamIds: memberships.map((m) => m.teamId),
      },
      reason,
      { tournamentId: t.id },
    );
    return { id: p.id, replacementId };
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
      where: { tournamentId: t.id, withdrawn: false },
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
