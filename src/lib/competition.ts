import {
  configuration,
  validateLeague,
  seededBracketPairs,
} from "./tournament-config";
import { createStages } from "./configuration";
import { persistBracket } from "./brackets";
import { z } from "zod";
import { privateTx, audit, type Actor, type Tx } from "./db";
import {
  assertTransition,
  calculateStandings,
  DomainError,
  readiness,
  requireReason,
  optionalNote,
  noteSchema,
  resultSchema,
  validateSeries,
  type Rules,
  type Standing,
  rankStandings,
  compareStandings,
  stageRankingRules,
} from "./domain";
import { decrypt, encrypt } from "./crypto";
import { Prisma } from "@/generated/prisma/client";
import type { Stage } from "@/generated/prisma/client";
export async function standingsFor(
  tx: Tx,
  stageId: string,
): Promise<{ stage: Stage; rows: Standing[] }> {
  const stage = await tx.stage.findUniqueOrThrow({
    where: { id: stageId },
    include: {
      category: { include: { tournament: true } },
      rounds: {
        include: {
          matches: { include: { currentResult: { include: { games: true } } } },
        },
      },
    },
  });
  let participants = await tx.participant.findMany({
    where: { tournamentId: stage.category.tournamentId },
    include: { member: true },
  });
  let baseRanking: Standing[] = [];
  if (stage.key === "qualification") {
    const league = await tx.stage.findFirstOrThrow({
      where: { categoryId: stage.categoryId, key: "league" },
    });
    const snapshot = await tx.rankingSnapshot.findFirst({
      where: { stageId: league.id, stale: false },
      orderBy: { version: "desc" },
    });
    baseRanking = (snapshot?.rankings ?? []) as Standing[];
    const config = configuration(stage.category.tournament.configuration);
    const ids = baseRanking
      .slice(config.directSlots, config.directSlots + config.playoffEntrants)
      .map((r) => r.id);
    participants = participants.filter((p) => ids.includes(p.id));
  }
  const rankingPolicy = stageRankingRules(
    stage.key,
    stage.rules as Rules,
    stage.confirmedRules,
  );
  const rows = calculateStandings(
    participants.map((p) => ({
      id: p.id,
      code: p.code,
      ign: p.member.displayIgn,
    })),
    stage.rounds
      .flatMap((r) => r.matches)
      .map((m) => ({
        a: m.sideAId,
        b: m.sideBId,
        status: m.status,
        outcome:
          m.currentResult?.status === "ACCEPTED"
            ? m.currentResult.outcome
            : undefined,
        games: m.currentResult?.games ?? [],
      })),
    rankingPolicy.rules,
    rankingPolicy.confirmed,
  );
  if (
    stage.key === "qualification" &&
    (stage.rules as Rules).qualificationCarry
  ) {
    return {
      stage,
      rows: rankStandings(
        rows.map((r) => ({
          ...r,
          points:
            r.points + (baseRanking.find((b) => b.id === r.id)?.points ?? 0),
        })),
        rankingPolicy.rules,
        rankingPolicy.confirmed,
      ),
    };
  }
  return { stage, rows };
}
export async function invalidateDependencies(
  tx: Tx,
  actor: Actor,
  stageId: string,
  matchId: string,
  reason: string,
) {
  const stage = await tx.stage.findUniqueOrThrow({ where: { id: stageId } });
  const stages = await tx.stage.findMany({
    where: { categoryId: stage.categoryId, archived: false },
    select: { id: true },
  });
  const stageIds = stages.map((s) => s.id);
  await tx.rankingSnapshot.updateMany({
    where: { stageId: { in: stageIds } },
    data: { stale: true },
  });
  await tx.bracketDependency.updateMany({
    where: {
      OR: [
        { sourceMatchId: matchId },
        { snapshot: { stageId: { in: stageIds } } },
      ],
    },
    data: { stale: true },
  });
  await audit(
    tx,
    actor,
    "DEPENDENCIES_STALE",
    "MATCH",
    matchId,
    { stageIds },
    reason,
    { stageId },
  );
}

export async function submitResult(actor: Actor, raw: unknown) {
  const input = resultSchema.parse(raw);
  return privateTx(actor, async (tx) => {
    const previous = await tx.resultVersion.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
    });
    if (previous) {
      if (previous.matchId !== input.matchId)
        throw new DomainError("Idempotency key belongs to another match.", 409);
      return { id: previous.id };
    }
    const match = await tx.match.findUniqueOrThrow({
      where: { id: input.matchId },
      include: {
        round: { include: { stage: true } },
        results: { orderBy: { version: "desc" }, take: 1 },
      },
    });
    if (
      match.round.stage.archived ||
      match.status === "VOIDED" ||
      !match.sideAId ||
      !match.sideBId
    )
      throw new DomainError("Match is not ready for a result.");
    if (
      await tx.bracketDependency.count({
        where: { matchId: match.id, stale: true },
      })
    )
      throw new DomainError("Resolve stale bracket dependencies first.");
    const stage = match.round.stage;
    if (input.outcome.includes("FORFEIT") || match.currentResultId)
      requireReason(input.reason);
    validateSeries(
      match.bestOf,
      input.games,
      input.outcome,
      stage.rules as Rules,
      stage.confirmedRules,
    );
    const result = await tx.resultVersion.create({
      data: {
        matchId: match.id,
        version: (match.results[0]?.version ?? 0) + 1,
        outcome: input.outcome,
        reason: encrypt(input.reason, `match:${match.id}`),
        idempotencyKey: input.idempotencyKey,
        submittedBy: actor.id,
        games: { create: input.games.map((g, i) => ({ ...g, number: i + 1 })) },
      },
    });
    if (match.status !== "FINALIZED")
      await tx.match.update({
        where: { id: match.id },
        data: { status: "RESULT_SUBMITTED" },
      });
    await audit(
      tx,
      actor,
      "RESULT_SUBMIT",
      "MATCH",
      match.id,
      { resultId: result.id, version: result.version, outcome: input.outcome },
      input.reason,
      { stageId: stage.id },
    );
    return { id: result.id };
  });
}
export async function reviewResult(
  actor: Actor,
  input: { id: string; action: string; reason: string },
) {
  const note = optionalNote(input.reason);
  return privateTx(actor, async (tx) => {
    const result = await tx.resultVersion.findUniqueOrThrow({
      where: { id: input.id },
      include: {
        games: true,
        evidence: true,
        match: { include: { round: { include: { stage: true } } } },
      },
    });
    const m = result.match,
      stage = m.round.stage;
    if (stage.archived)
      throw new DomainError(
        "Archived results are retained for history and cannot be changed.",
      );
    const reason =
      input.action !== "ACCEPT" ||
      (m.currentResultId && m.currentResultId !== result.id)
        ? requireReason(note)
        : note;
    if (input.action === "ACCEPT") {
      if (m.currentResultId === result.id && result.status === "ACCEPTED")
        return { id: result.id };
      if (result.status !== "SUBMITTED")
        throw new DomainError("Only a submitted result can be accepted.");
      if (!result.evidence.length)
        throw new DomainError("Upload result evidence before acceptance.");
      validateSeries(
        m.bestOf,
        result.games,
        result.outcome,
        stage.rules as Rules,
        stage.confirmedRules,
      );
      await tx.resultVersion.update({
        where: { id: result.id },
        data: {
          status: "ACCEPTED",
          acceptedBy: actor.id,
          acceptedAt: new Date(),
        },
      });
      await tx.match.update({
        where: { id: m.id },
        data: { currentResultId: result.id, status: "FINALIZED" },
      });
      if (m.currentResultId) {
        await invalidateDependencies(tx, actor, stage.id, m.id, reason);
      }
      await audit(
        tx,
        actor,
        m.currentResultId ? "RESULT_CORRECT" : "RESULT_ACCEPT",
        "MATCH",
        m.id,
        {
          beforeResultId: m.currentResultId,
          afterResultId: result.id,
          outcome: result.outcome,
          games: result.games.map((g) => `${g.scoreA}–${g.scoreB}`),
        },
        reason,
        { stageId: stage.id },
      );
      await audit(
        tx,
        actor,
        "STANDINGS_RECALCULATED",
        "STAGE",
        stage.id,
        { derived: true },
        undefined,
        { stageId: stage.id },
      );
    } else if (input.action === "REJECT") {
      if (result.status !== "SUBMITTED")
        throw new DomainError(
          "Accepted results require a new correction version.",
        );
      await tx.resultVersion.update({
        where: { id: result.id },
        data: { status: "REJECTED" },
      });
      if (!m.currentResultId)
        await tx.match.update({
          where: { id: m.id },
          data: { status: "SCHEDULED" },
        });
      await audit(
        tx,
        actor,
        "RESULT_REJECT",
        "MATCH",
        m.id,
        { resultId: result.id },
        reason,
      );
    } else if (input.action === "DISPUTE") {
      if (
        m.status === "VOIDED" ||
        (result.id !== m.currentResultId && result.status !== "SUBMITTED")
      )
        throw new DomainError(
          "Select the current accepted or a submitted result.",
        );
      if (await tx.dispute.count({ where: { matchId: m.id, resolved: false } }))
        throw new DomainError("This match already has an open dispute.");
      await tx.dispute.create({
        data: {
          matchId: m.id,
          actorId: actor.id,
          reasonEncrypted: encrypt(reason, `match:${m.id}`),
        },
      });
      await tx.match.update({
        where: { id: m.id },
        data: { status: "DISPUTED" },
      });
      await invalidateDependencies(tx, actor, stage.id, m.id, reason);
      await audit(
        tx,
        actor,
        "RESULT_DISPUTE",
        "MATCH",
        m.id,
        { resultId: result.id },
        reason,
      );
    } else throw new DomainError("Unknown result review action.");
    return { id: result.id };
  });
}
export async function saveTournament(
  actor: Actor,
  input: Record<string, unknown>,
) {
  return privateTx(actor, async (tx) => {
    const data = z
      .object({
        id: z.string().uuid().optional(),
        name: z.string().min(3).max(150),
        slug: z
          .string()
          .regex(/^[a-z0-9-]+$/)
          .optional(),
        overview: z.string().max(5000),
        overviewEn: z.string().max(5000).optional(),
        gameTitle: z.string().max(100).optional(),
        startsAt: z.string().optional(),
        registrationDeadline: z.string().optional(),
        status: z.enum([
          "DRAFT",
          "REGISTRATION_OPEN",
          "REGISTRATION_CLOSED",
          "IN_PROGRESS",
          "COMPLETED",
          "ARCHIVED",
        ]),
        reason: noteSchema,
      })
      .parse(input);
    const createConfig = !data.id
      ? configuration(input.configuration)
      : undefined;
    if (
      createConfig &&
      (createConfig.scheduleSource !== "generated" || data.status !== "DRAFT")
    )
      throw new DomainError(
        "Create a draft with a generated schedule configuration. The supplied schedule belongs only to the original seed.",
      );
    const old = data.id
      ? await tx.tournament.findUniqueOrThrow({ where: { id: data.id } })
      : null;
    if (old) assertTransition(old.status, data.status);
    const { id, reason, startsAt, registrationDeadline, ...fields } = data;
    const next = {
      ...fields,
      slug:
        fields.slug ??
        old?.slug ??
        `${
          data.name
            .toLowerCase()
            .normalize("NFKD")
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-|-$/g, "")
            .slice(0, 70) || "tournament"
        }-${crypto.randomUUID().slice(0, 8)}`,
      gameTitle: fields.gameTitle || null,
      startsAt: startsAt ? new Date(startsAt) : null,
      registrationDeadline: registrationDeadline
        ? new Date(registrationDeadline)
        : null,
    };
    const row = old
      ? await tx.tournament.update({
          where: { id: old.id },
          data: {
            ...next,
            ...(data.status === "ARCHIVED" ? { published: false } : {}),
          },
        })
      : await tx.tournament.create({
          data: { ...next, configuration: createConfig! },
        });
    if (!old) await createStages(tx, row.id, createConfig!);
    await audit(
      tx,
      actor,
      old ? "TOURNAMENT_UPDATE" : "TOURNAMENT_CREATE",
      "TOURNAMENT",
      row.id,
      { changedFields: Object.keys(fields) },
      reason,
    );
    return { id: row.id };
  });
}
export async function confirmRules(
  actor: Actor,
  input: {
    stageId: string;
    rules: unknown;
    confirmedRules: string[];
    reason: string;
  },
) {
  if (actor.role !== "ADMIN")
    throw new DomainError("Admin permission is required.", 403);
  return privateTx(actor, async (tx) => {
    const schema = z
      .object({
        seriesPoints: z.literal(true).optional(),
        drawPolicy: z.enum(["no_draws", "moderated_draw"]).optional(),
        tiebreakers: z
          .array(z.enum(["wins", "differential", "gameWins"]))
          .optional(),
        qualificationBestOf: z.union([z.literal(3), z.literal(5)]).optional(),
        qualificationCarry: z.boolean().optional(),
        qualificationPairing: z.literal("manual").optional(),
        qualificationTiebreakers: z
          .array(z.enum(["wins", "differential", "gameWins"]))
          .optional(),
        knockoutPairing: z.enum(["ranked_cross", "manual"]).optional(),
        byePolicy: z
          .enum(["none", "rotating_no_points", "seeded_top"])
          .optional(),
        teamSeeding: z.literal("manual").optional(),
        specialOutcomes: z.enum(["forfeit", "none"]).optional(),
        evidenceDeadline: z.string().min(1).optional(),
        disputeDeadline: z.string().min(1).optional(),
      })
      .strict();
    const rules = schema.parse(input.rules);
    for (const key of input.confirmedRules)
      if (!(key in rules))
        throw new DomainError(`Set a value before confirming ${key}.`);
    const stage = await tx.stage.findUniqueOrThrow({
      where: { id: input.stageId },
    });
    if (
      stage.archived ||
      stage.published ||
      stage.finalized ||
      (await tx.resultVersion.count({
        where: { match: { round: { stageId: stage.id } }, status: "ACCEPTED" },
      }))
    )
      throw new DomainError(
        "Rules are locked after publication, finalization or accepted results.",
      );
    await tx.stage.update({
      where: { id: stage.id },
      data: {
        rules: rules as Prisma.InputJsonValue,
        confirmedRules: input.confirmedRules,
        ruleVersion: { increment: 1 },
      },
    });
    await audit(
      tx,
      actor,
      "RULES_CONFIRM",
      "STAGE",
      stage.id,
      {
        rules,
        confirmedRules: input.confirmedRules,
        version: stage.ruleVersion + 1,
      },
      optionalNote(input.reason),
    );
    return { id: stage.id };
  });
}
export async function tournamentReadiness(tx: Tx, id: string) {
  const t = await tx.tournament.findUniqueOrThrow({
    where: { id },
    include: {
      participants: { include: { member: true } },
      categories: {
        include: {
          stages: { where: { archived: false } },
          teams: {
            where: { archived: false },
            include: {
              memberships: {
                where: { active: true },
                include: { member: true },
              },
            },
          },
        },
      },
    },
  });
  const teams = t.categories
    .flatMap((c) => c.teams)
    .filter(
      (t) =>
        t.memberships.length === 4 &&
        t.memberships.every((m) => m.member.verified && !m.member.archived),
    ).length;
  const config = configuration(t.configuration);
  const checks = readiness(
    t,
    t.categories.flatMap((c) => c.stages),
    t.participants.filter(
      (p) => p.eligible && p.member.verified && !p.member.archived,
    ).length,
    teams,
    config,
  ).filter((c) => config.playoffEntrants || !c.key.startsWith("qualification"));
  const league = t.categories
    .flatMap((c) => c.stages)
    .find((s) => s.key === "league");
  let scheduleValid = false;
  if (league) {
    const rounds = await tx.round.findMany({
      where: { stageId: league.id },
      orderBy: { number: "asc" },
      include: { matches: true },
    });
    try {
      validateLeague(
        t.participants.map((p) => p.id),
        rounds.map((r) =>
          r.matches.map((m) => ({ a: m.sideAId!, b: m.sideBId })),
        ),
        config,
      );
      scheduleValid = true;
    } catch {}
  }
  checks.push({
    key: "schedule",
    label:
      "League schedule matches configured capacity, rounds and match quota",
    done: scheduleValid,
  });
  const needsByes =
    config.soloCapacity % 2 !== 0 ||
    config.directSlots + config.playoffSlots < config.soloBracketSize ||
    config.teamCapacity < config.teamBracketSize;
  checks.push({
    key: "byes",
    label: "Explicit bye policies confirmed on affected stages",
    done:
      !needsByes ||
      t.categories
        .flatMap((c) => c.stages)
        .filter((s) =>
          s.key === "league"
            ? config.soloCapacity % 2 !== 0
            : s.key === "knockout" &&
              (t.categories.find((c) => c.id === s.categoryId)?.kind === "TEAM"
                ? config.teamCapacity < config.teamBracketSize
                : config.directSlots + config.playoffSlots <
                  config.soloBracketSize),
        )
        .every(
          (s) =>
            s.confirmedRules.includes("byePolicy") &&
            (s.rules as Rules).byePolicy ===
              (s.key === "league"
                ? config.leagueByePolicy
                : config.bracketByePolicy),
        ),
  });
  return { t, checks };
}
export async function publishTournament(
  actor: Actor,
  input: { id: string; published: boolean; reason: string },
) {
  if (actor.role !== "ADMIN")
    throw new DomainError("Publication requires admin approval.", 403);
  return privateTx(actor, async (tx) => {
    const { t, checks } = await tournamentReadiness(tx, input.id);
    if (input.published) {
      if (t.status === "DRAFT" || t.status === "ARCHIVED")
        throw new DomainError(
          "Change the tournament to an active state before publishing.",
        );
      const pending = checks.filter((c) => !c.done);
      if (pending.length)
        throw new DomainError(
          `Readiness is incomplete: ${pending.map((c) => c.label).join(", ")}`,
        );
    }
    await tx.tournament.update({
      where: { id: t.id },
      data: { published: input.published },
    });
    await tx.stage.updateMany({
      where: { category: { tournamentId: t.id }, archived: false },
      data: { published: input.published },
    });
    await audit(
      tx,
      actor,
      input.published ? "TOURNAMENT_PUBLISH" : "TOURNAMENT_UNPUBLISH",
      "TOURNAMENT",
      t.id,
      { published: input.published },
      optionalNote(input.reason),
    );
    return { id: t.id };
  });
}
export async function freezeRankings(
  actor: Actor,
  input: { stageId: string; rankedIds: string[]; reason: string },
) {
  if (actor.role !== "ADMIN")
    throw new DomainError("Admin permission is required.", 403);
  return privateTx(actor, async (tx) => {
    const { stage, rows } = await standingsFor(tx, input.stageId);
    if (!stage || !["league", "qualification"].includes(stage.key))
      throw new DomainError("Choose a league or qualification stage.");
    const category = await tx.category.findUniqueOrThrow({
      where: { id: stage.categoryId },
      include: { tournament: true },
    });
    const config = configuration(category.tournament.configuration);
    if (stage.archived)
      throw new DomainError(
        "Archived stages cannot advance the current tournament.",
      );
    const approved = await tx.participant.count({
      where: {
        tournamentId: category.tournamentId,
        eligible: true,
        member: { verified: true, archived: false },
      },
    });
    if (approved !== config.soloCapacity)
      throw new DomainError(
        "Confirm all configured entrants and eligibility before freezing rankings.",
      );
    const expected =
      stage.key === "league"
        ? config.leagueMatchesPerPlayer
        : config.qualificationMatchesPerPlayer;
    if (
      rows.length !==
        (stage.key === "league"
          ? config.soloCapacity
          : config.playoffEntrants) ||
      rows.some((r) => r.played !== expected)
    )
      throw new DomainError(
        `Every player must complete ${expected} finalized matches.`,
      );
    if (
      !["seriesPoints", "drawPolicy"].every((k) =>
        stage.confirmedRules.includes(k),
      )
    )
      throw new DomainError("Confirm stage scoring and draw rules first.");
    if (
      stage.key === "qualification" &&
      (await tx.bracketDependency.count({
        where: { match: { round: { stageId: stage.id } }, stale: true },
      }))
    )
      throw new DomainError("Resolve stale qualification dependencies first.");
    if (stage.key === "league" && !stage.confirmedRules.includes("tiebreakers"))
      throw new DomainError("Confirm stage tiebreakers first.");
    if (
      stage.key === "qualification" &&
      !["qualificationCarry", "qualificationTiebreakers"].every((k) =>
        stage.confirmedRules.includes(k),
      )
    )
      throw new DomainError("Confirm qualification ranking rules first.");
    if (
      input.rankedIds.length !== rows.length ||
      new Set(input.rankedIds).size !== rows.length ||
      input.rankedIds.some((id) => !rows.some((r) => r.id === id))
    )
      throw new DomainError(
        "Supply a complete, unique ranking to resolve all ties explicitly.",
      );
    const sorted = input.rankedIds.map((id) => rows.find((r) => r.id === id)!);
    const policy = stageRankingRules(
      stage.key,
      stage.rules as Rules,
      stage.confirmedRules,
    );
    for (let i = 1; i < sorted.length; i++)
      if (
        compareStandings(
          sorted[i - 1],
          sorted[i],
          policy.rules,
          policy.confirmed,
        ) > 0
      )
        throw new DomainError(
          "Manual tie resolution cannot reverse points or confirmed tiebreak ordering.",
        );
    const last = await tx.rankingSnapshot.findFirst({
      where: { stageId: stage.id },
      orderBy: { version: "desc" },
    });
    const snapshot = await tx.rankingSnapshot.create({
      data: {
        stageId: stage.id,
        version: (last?.version ?? 0) + 1,
        rankings: sorted.map((r, i) => ({
          ...r,
          rank: i + 1,
          tied: false,
        })) as Prisma.InputJsonValue,
        frozenBy: actor.id,
      },
    });
    await tx.stage.update({
      where: { id: stage.id },
      data: { finalized: true },
    });
    await audit(
      tx,
      actor,
      "RANKING_FREEZE",
      "SNAPSHOT",
      snapshot.id,
      { version: snapshot.version, participantIds: input.rankedIds },
      rows.some((r) => r.tied)
        ? requireReason(input.reason)
        : optionalNote(input.reason),
      { stageId: stage.id },
    );
    return { id: snapshot.id };
  });
}
export async function createQualification(
  actor: Actor,
  input: { stageId: string; pairs: string[][]; reason: string },
) {
  return privateTx(actor, async (tx) => {
    const stage = await tx.stage.findUniqueOrThrow({
      where: { id: input.stageId },
    });
    if (stage.archived || stage.key !== "qualification")
      throw new DomainError("Choose the qualification stage.");
    if (
      ![
        "qualificationBestOf",
        "qualificationPairing",
        "qualificationCarry",
      ].every((k) => stage.confirmedRules.includes(k))
    )
      throw new DomainError("Confirm qualification rules first.");
    const league = await tx.stage.findFirstOrThrow({
      where: { categoryId: stage.categoryId, key: "league" },
    });
    const snap = await tx.rankingSnapshot.findFirst({
      where: { stageId: league.id, stale: false },
      orderBy: { version: "desc" },
    });
    if (!snap) throw new DomainError("Freeze a current league ranking first.");
    const category = await tx.category.findUniqueOrThrow({
      where: { id: stage.categoryId },
      include: { tournament: true },
    });
    const config = configuration(category.tournament.configuration);
    const ids = (snap.rankings as { id: string }[])
      .slice(config.directSlots, config.directSlots + config.playoffEntrants)
      .map((r) => r.id);
    const expectedMatches =
      (config.playoffEntrants * config.qualificationMatchesPerPlayer) / 2;
    if (input.pairs.length !== expectedMatches)
      throw new DomainError(
        `${expectedMatches} qualification series are required.`,
      );
    const count = new Map(ids.map((id) => [id, 0])),
      seen = new Set<string>();
    for (const pair of input.pairs) {
      if (
        pair.length !== 2 ||
        pair[0] === pair[1] ||
        pair.some((id) => !count.has(id))
      )
        throw new DomainError("Invalid qualification pairing.");
      const key = [...pair].sort().join(":");
      if (seen.has(key))
        throw new DomainError("Repeated qualification pairing.");
      seen.add(key);
      pair.forEach((id) => count.set(id, count.get(id)! + 1));
    }
    if (
      [...count.values()].some(
        (n) => n !== config.qualificationMatchesPerPlayer,
      )
    )
      throw new DomainError(
        `Each qualifier must play ${config.qualificationMatchesPerPlayer} series.`,
      );
    if (await tx.round.count({ where: { stageId: stage.id } }))
      throw new DomainError("Qualification fixtures already exist.");
    const r = await tx.round.create({
      data: { stageId: stage.id, number: 1, name: "Qualification" },
    });
    for (const [i, pair] of input.pairs.entries()) {
      const m = await tx.match.create({
        data: {
          roundId: r.id,
          order: i + 1,
          sideAId: pair[0],
          sideBId: pair[1],
          bestOf: (stage.rules as Rules).qualificationBestOf!,
        },
      });
      await tx.bracketDependency.create({
        data: { snapshotId: snap.id, matchId: m.id },
      });
    }
    await audit(
      tx,
      actor,
      "QUALIFICATION_CREATE",
      "STAGE",
      stage.id,
      { matches: expectedMatches },
      optionalNote(input.reason),
    );
    return { id: stage.id };
  });
}
export async function createSoloBracket(
  actor: Actor,
  input: { categoryId: string; reason: string; rankedIds?: string[] },
) {
  return privateTx(actor, async (tx) => {
    const category = await tx.category.findUniqueOrThrow({
        where: { id: input.categoryId },
        include: { tournament: true },
      }),
      config = configuration(category.tournament.configuration);
    const stages = await tx.stage.findMany({
        where: { categoryId: category.id, archived: false },
      }),
      league = stages.find((s) => s.key === "league"),
      qualification = stages.find((s) => s.key === "qualification"),
      knockout = stages.find((s) => s.key === "knockout");
    if (category.kind !== "SOLO" || !league || !knockout)
      throw new DomainError("SOLO stages are not configured.");
    if (!knockout.confirmedRules.includes("knockoutPairing"))
      throw new DomainError("Confirm bracket pairing first.");
    const l = await tx.rankingSnapshot.findFirst({
        where: { stageId: league.id, stale: false },
        orderBy: { version: "desc" },
      }),
      q = qualification
        ? await tx.rankingSnapshot.findFirst({
            where: { stageId: qualification.id, stale: false },
            orderBy: { version: "desc" },
          })
        : null;
    if (!l || (config.playoffSlots && !q))
      throw new DomainError("Current frozen rankings are required.");
    if (await tx.round.count({ where: { stageId: knockout.id } }))
      throw new DomainError("Bracket already exists.");
    const direct = (l.rankings as { id: string }[])
        .slice(0, config.directSlots)
        .map((r) => r.id),
      playoff = ((q?.rankings ?? []) as { id: string }[])
        .slice(0, config.playoffSlots)
        .map((r) => r.id);
    let pairs;
    if ((knockout.rules as Rules).knockoutPairing === "ranked_cross") {
      if (
        direct.length !== playoff.length ||
        direct.length + playoff.length !== config.soloBracketSize
      )
        throw new DomainError(
          "Ranked-cross pairing requires equal direct/playoff slots and a full bracket. Confirm manual seeding for other sizes.",
        );
      pairs = direct.map((id, i) => ({
        a: id,
        b: playoff[playoff.length - 1 - i],
      }));
    } else {
      const ids = input.rankedIds ?? [],
        entrants = [...direct, ...playoff];
      if (
        ids.length !== entrants.length ||
        new Set(ids).size !== entrants.length ||
        ids.some((id) => !entrants.includes(id))
      )
        throw new DomainError(
          "Provide every qualified entrant in an explicit seed order.",
        );
      if (
        ids.length < config.soloBracketSize &&
        (!knockout.confirmedRules.includes("byePolicy") ||
          (knockout.rules as Rules).byePolicy !== config.bracketByePolicy)
      )
        throw new DomainError("Confirm the bye policy on this stage first.");
      pairs = seededBracketPairs(
        ids,
        config.soloBracketSize,
        config.bracketByePolicy,
      );
    }
    const stats = await persistBracket(
      tx,
      knockout.id,
      config.soloBracketSize,
      pairs,
      "SOLO",
      [l.id, ...(q ? [q.id] : [])],
    );
    await audit(
      tx,
      actor,
      "BRACKET_CREATE",
      "STAGE",
      knockout.id,
      { ...stats, pairing: (knockout.rules as Rules).knockoutPairing },
      optionalNote(input.reason),
    );
    return { id: knockout.id };
  });
}
export async function advanceWinner(
  actor: Actor,
  input: { matchId: string; reason: string },
) {
  return privateTx(actor, async (tx) => {
    const m = await tx.match.findUniqueOrThrow({
      where: { id: input.matchId },
      include: { currentResult: true, round: { include: { stage: true } } },
    });
    if (m.round.stage.archived)
      throw new DomainError("Archived stages cannot advance entrants.");
    const isBye =
      m.status === "BYE" &&
      m.round.stage.format === "KNOCKOUT" &&
      !!m.sideAId &&
      !m.sideBId;
    if (
      !isBye &&
      (m.status !== "FINALIZED" ||
        !m.currentResult ||
        !["A_WIN", "B_WIN", "A_FORFEIT", "B_FORFEIT"].includes(
          m.currentResult.outcome,
        ))
    )
      throw new DomainError(
        "A finalized decisive result or explicitly seeded bye is required.",
      );
    if (
      await tx.bracketDependency.count({
        where: { matchId: m.id, stale: true },
      })
    )
      throw new DomainError("Resolve stale dependencies before advancement.");
    const next = await tx.round.findUnique({
      where: {
        stageId_number: {
          stageId: m.round.stageId,
          number: m.round.number + 1,
        },
      },
      include: { matches: true },
    });
    if (!next) return { completed: true };
    const target = next.matches.find((n) => n.order === Math.ceil(m.order / 2));
    if (!target) throw new DomainError("Next bracket match is missing.");
    const field = m.order % 2 ? "sideAId" : "sideBId",
      winner =
        isBye || ["A_WIN", "B_FORFEIT"].includes(m.currentResult!.outcome)
          ? m.sideAId
          : m.sideBId;
    if (target[field] === winner) return { id: target.id };
    if (target.status !== "SCHEDULED" || target[field])
      throw new DomainError(
        "An occupied or started downstream match requires explicit stale-dependency resolution.",
      );
    await tx.match.update({
      where: { id: target.id },
      data: { [field]: winner },
    });
    await tx.bracketDependency.create({
      data: { sourceMatchId: m.id, matchId: target.id },
    });
    await audit(
      tx,
      actor,
      "BRACKET_ADVANCE",
      "MATCH",
      target.id,
      { sourceMatchId: m.id, winner },
      optionalNote(input.reason),
    );
    return { id: target.id };
  });
}

export async function resolveDispute(
  actor: Actor,
  input: { id: string; uphold: boolean; reason: string },
) {
  return privateTx(actor, async (tx) => {
    const dispute = await tx.dispute.findUniqueOrThrow({
      where: { id: input.id },
      include: { match: { include: { round: { include: { stage: true } } } } },
    });
    if (dispute.match.round.stage.archived)
      throw new DomainError("Archived competition history cannot be edited.");
    if (dispute.resolved)
      throw new DomainError("This dispute has already been resolved.");
    if (input.uphold && !dispute.match.currentResultId)
      throw new DomainError(
        "Accept a validated result with evidence before upholding it.",
      );
    const reason = requireReason(input.reason);
    await tx.dispute.update({
      where: { id: dispute.id },
      data: {
        resolved: true,
        resolutionEncrypted: encrypt(reason, `dispute:${dispute.id}`),
      },
    });
    await tx.match.update({
      where: { id: dispute.matchId },
      data: { status: input.uphold ? "FINALIZED" : "VOIDED" },
    });
    await audit(
      tx,
      actor,
      "DISPUTE_RESOLVE",
      "MATCH",
      dispute.matchId,
      { disputeId: dispute.id, status: input.uphold ? "FINALIZED" : "VOIDED" },
      reason,
    );
    return { id: dispute.id };
  });
}
