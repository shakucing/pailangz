import "dotenv/config";
import { randomUUID } from "node:crypto";
import { audit, db, ensureRuntime } from "../src/lib/db";
import { standingsFor } from "../src/lib/competition";
import { persistBracket } from "../src/lib/brackets";
import {
  compareStandings,
  stageRankingRules,
  validateSeries,
  type Rules,
  type Standing,
} from "../src/lib/domain";
import { configuration } from "../src/lib/tournament-config";
import { encrypt } from "../src/lib/crypto";
import type { Prisma } from "../src/generated/prisma/client";

const marker = "SYNTHETIC_LOCAL_QUALIFICATION_SCORES";
const databaseUrl = new URL(process.env.DATABASE_URL ?? "http://invalid");
if (
  process.env.APP_ENV !== "development" ||
  process.env.DATABASE_ENV !== "development" ||
  process.env.LOCAL_PGLITE !== "true" ||
  process.env.VERCEL ||
  !["127.0.0.1", "localhost", "[::1]"].includes(databaseUrl.hostname)
)
  throw new Error(
    "Qualification scores may only be seeded in synthetic localhost PGlite development.",
  );

// Explicit local demo outcomes for the already-saved eight-player schedule.
const plans = [
  {
    a: "P01",
    b: "P25",
    scores: [
      [15, 9],
      [11, 15],
      [15, 12],
    ],
  },
  {
    a: "P16",
    b: "P05",
    scores: [
      [15, 10],
      [15, 8],
    ],
  },
  {
    a: "P04",
    b: "P27",
    scores: [
      [15, 12],
      [10, 15],
      [13, 15],
    ],
  },
  {
    a: "P20",
    b: "P06",
    scores: [
      [15, 8],
      [15, 11],
    ],
  },
  {
    a: "P01",
    b: "P06",
    scores: [
      [15, 7],
      [15, 10],
    ],
  },
  {
    a: "P25",
    b: "P20",
    scores: [
      [10, 15],
      [12, 15],
    ],
  },
  {
    a: "P16",
    b: "P27",
    scores: [
      [15, 12],
      [11, 15],
      [15, 9],
    ],
  },
  {
    a: "P05",
    b: "P04",
    scores: [
      [15, 11],
      [12, 15],
      [15, 10],
    ],
  },
];

try {
  await ensureRuntime();
  const summary = await db.$transaction(
    async (tx) => {
      const tournament = await tx.tournament.findUniqueOrThrow({
        where: { slug: "pailangz-solo-team" },
        include: {
          categories: {
            where: { kind: "SOLO" },
            include: { stages: { where: { archived: false } } },
          },
        },
      });
      const config = configuration(tournament.configuration);
      const category = tournament.categories[0];
      const league = category?.stages.find((s) => s.key === "league");
      const qualification = category?.stages.find(
        (s) => s.key === "qualification",
      );
      const knockout = category?.stages.find((s) => s.key === "knockout");
      if (
        !league ||
        !qualification ||
        !knockout ||
        config.playoffEntrants !== 8 ||
        config.playoffSlots !== 4 ||
        config.directSlots !== 4 ||
        config.qualificationMatchesPerPlayer !== 2
      )
        throw new Error(
          "This demo seed requires the saved four-direct/eight-playoff-player format.",
        );
      const leagueSnapshot = await tx.rankingSnapshot.findFirstOrThrow({
        where: { stageId: league.id },
        orderBy: { version: "desc" },
      });
      if (leagueSnapshot.stale || !league.finalized)
        throw new Error("Finalize the current league rankings first.");
      const leagueMatches = await tx.match.findMany({
        where: { round: { stageId: league.id } },
        include: { currentResult: true },
      });
      if (
        leagueMatches.length !== 96 ||
        leagueMatches.some(
          (m) =>
            m.currentResult?.submittedBy !== "SYNTHETIC_LOCAL_SIX_ROUND_SCORES",
        )
      )
        throw new Error(
          "Expected the existing synthetic six-round league; real results must not be seeded.",
        );
      if (
        await tx.bracketDependency.count({
          where: {
            match: { round: { stageId: qualification.id } },
            stale: true,
          },
        })
      )
        throw new Error("Qualification has stale dependencies.");
      const matches = await tx.match.findMany({
        where: { round: { stageId: qualification.id } },
        include: { currentResult: true, results: true },
      });
      const participants = await tx.participant.findMany({
        where: { tournamentId: tournament.id },
        select: { id: true, code: true },
      });
      const codes = new Map(participants.map((p) => [p.id, p.code]));
      if (matches.length !== plans.length)
        throw new Error(
          "Expected exactly eight existing qualification fixtures.",
        );
      let seeded = 0;
      for (const plan of plans) {
        const match = matches.find(
          (m) =>
            codes.get(m.sideAId ?? "") === plan.a &&
            codes.get(m.sideBId ?? "") === plan.b,
        );
        if (!match || match.bestOf !== 3)
          throw new Error(`Saved BO3 fixture missing: ${plan.a} vs ${plan.b}`);
        if (
          match.currentResult?.submittedBy === marker &&
          match.currentResult.status === "ACCEPTED" &&
          match.status === "FINALIZED"
        )
          continue;
        if (match.status !== "SCHEDULED" || match.results.length)
          throw new Error(
            "An existing result or started match must not be overwritten.",
          );
        const games = plan.scores.map(([scoreA, scoreB]) => ({
          scoreA,
          scoreB,
        }));
        const outcome =
          games.filter((g) => g.scoreA > g.scoreB).length === 2
            ? "A_WIN"
            : "B_WIN";
        validateSeries(
          3,
          games,
          outcome,
          qualification.rules as Rules,
          qualification.confirmedRules,
        );
        const result = await tx.resultVersion.create({
          data: {
            matchId: match.id,
            version: 1,
            outcome,
            status: "ACCEPTED",
            submittedBy: marker,
            acceptedBy: marker,
            acceptedAt: new Date(),
            idempotencyKey: randomUUID(),
            reason: encrypt(
              "Synthetic local qualification demo scores; not a real played match.",
              `result:${match.id}`,
            ),
            games: { create: games.map((g, i) => ({ ...g, number: i + 1 })) },
          },
        });
        await tx.match.update({
          where: { id: match.id },
          data: { status: "FINALIZED", currentResultId: result.id },
        });
        await audit(
          tx,
          null,
          "SEED_QUALIFICATION_RESULT",
          "MATCH",
          match.id,
          { synthetic: true, resultId: result.id, outcome, games },
          "Explicit local demo result seed",
          {
            source: "SEED",
            tournamentId: tournament.id,
            stageId: qualification.id,
          },
        );
        seeded++;
      }
      const { rows } = await standingsFor(tx, qualification.id);
      if (rows.length !== 8 || rows.some((r) => r.played !== 2))
        throw new Error(
          "Each qualification entrant must have two finalized series.",
        );
      const policy = stageRankingRules(
        "qualification",
        qualification.rules as Rules,
        qualification.confirmedRules,
      );
      const leagueRows = leagueSnapshot.rankings as unknown as Standing[];
      const leagueOrder = new Map(leagueRows.map((r, i) => [r.id, i]));
      const ranked = [...rows]
        .sort(
          (a, b) =>
            compareStandings(a, b, policy.rules, policy.confirmed) ||
            leagueOrder.get(a.id)! - leagueOrder.get(b.id)!,
        )
        .map((r, i) => ({ ...r, rank: i + 1, tied: false }));
      let snapshot = await tx.rankingSnapshot.findFirst({
        where: { stageId: qualification.id },
        orderBy: { version: "desc" },
      });
      const savedRankings = (snapshot?.rankings ?? []) as unknown as Standing[];
      if (
        snapshot &&
        (snapshot.stale ||
          snapshot.frozenBy !== marker ||
          savedRankings.length !== ranked.length ||
          savedRankings.some((r, i) =>
            [
              "id",
              "rank",
              "played",
              "points",
              "wins",
              "gameWins",
              "gameLosses",
            ].some(
              (key) =>
                r[key as keyof Standing] !== ranked[i][key as keyof Standing],
            ),
          ))
      )
        throw new Error(
          "An existing qualification ranking must not be overwritten.",
        );
      if (!snapshot) {
        snapshot = await tx.rankingSnapshot.create({
          data: {
            stageId: qualification.id,
            version: 1,
            frozenBy: marker,
            rankings: ranked as unknown as Prisma.InputJsonValue,
          },
        });
        await tx.stage.update({
          where: { id: qualification.id },
          data: { finalized: true },
        });
        await audit(
          tx,
          null,
          "SEED_QUALIFICATION_RANKING",
          "SNAPSHOT",
          snapshot.id,
          {
            synthetic: true,
            ranks: ranked.map((r) => ({ code: r.code, rank: r.rank })),
          },
          "Confirmed qualification tiebreakers apply; remaining equal-score ties use the frozen league order for this synthetic demo.",
          {
            source: "SEED",
            tournamentId: tournament.id,
            stageId: qualification.id,
          },
        );
      }
      let bracketCreated = false;
      if (!(await tx.round.count({ where: { stageId: knockout.id } }))) {
        if (
          !knockout.confirmedRules.includes("knockoutPairing") ||
          (knockout.rules as Rules).knockoutPairing !== "ranked_cross" ||
          config.soloBracketSize !== 8
        )
          throw new Error(
            "The confirmed eight-player ranked-cross knockout format is required.",
          );
        const direct = leagueRows.slice(0, 4),
          playoff = ranked.slice(0, 4);
        const pairs = direct.map((r, i) => ({ a: r.id, b: playoff[3 - i].id }));
        const stats = await persistBracket(
          tx,
          knockout.id,
          8,
          pairs,
          "SOLO",
          config,
          [leagueSnapshot.id, snapshot.id],
        );
        await audit(
          tx,
          null,
          "SEED_SOLO_BRACKET",
          "STAGE",
          knockout.id,
          { synthetic: true, ...stats },
          "Create the knockout fixtures from the seeded local qualification rankings; no knockout results seeded.",
          { source: "SEED", tournamentId: tournament.id, stageId: knockout.id },
        );
        bracketCreated = true;
      }
      return {
        seeded,
        total: matches.length,
        bracketCreated,
        qualification: ranked.map((r) => ({
          code: r.code,
          rank: r.rank,
          played: r.played,
          points: r.points,
          differential: r.differential,
        })),
      };
    },
    { timeout: 20000 },
  );
  console.log(JSON.stringify(summary, null, 2));
} finally {
  await db.$disconnect();
}
