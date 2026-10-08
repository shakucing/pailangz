import "dotenv/config";
import { randomUUID } from "node:crypto";
import { audit, db, ensureRuntime } from "../src/lib/db";
import { encrypt } from "../src/lib/crypto";
import { validateSeries, type Rules } from "../src/lib/domain";
import { readGameWinners, type GameWinner } from "../src/lib/score-entry";

const semifinalSeed = process.argv.includes("--semifinals");
const roundNumber = semifinalSeed ? 2 : 1;
const roundName = semifinalSeed ? "Semifinals" : "Quarterfinals";
const marker = semifinalSeed
  ? "SYNTHETIC_LOCAL_SOLO_SEMIFINAL_WINNERS"
  : "SYNTHETIC_LOCAL_SOLO_QUARTERFINAL_WINNERS";
const url = new URL(process.env.DATABASE_URL ?? "http://invalid");
if (
  process.env.APP_ENV !== "development" ||
  process.env.DATABASE_ENV !== "development" ||
  process.env.LOCAL_PGLITE !== "true" ||
  process.env.VERCEL ||
  !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
)
  throw new Error(
    "Knockout demo results require synthetic localhost PGlite development.",
  );

const plans: GameWinner[][] = semifinalSeed
  ? [
      ["A", "B", "A", "B", "A"],
      ["B", "A", "B", "B"],
    ]
  : [
      ["A", "B", "A", "A"],
      ["B", "A", "B", "A", "B"],
      ["A", "A", "A"],
      ["B", "A", "B", "B"],
    ];
const apply = process.argv.includes("--apply");
try {
  await ensureRuntime();
  const summary = await db.$transaction(
    async (tx) => {
      const tournament = await tx.tournament.findUniqueOrThrow({
        where: { slug: "pailangz-solo-team" },
        include: {
          categories: {
            where: { kind: "SOLO" },
            include: {
              stages: {
                where: { archived: false },
                include: {
                  rounds: {
                    orderBy: { number: "asc" },
                    include: {
                      matches: {
                        orderBy: { order: "asc" },
                        include: {
                          results: true,
                          currentResult: {
                            include: { games: { orderBy: { number: "asc" } } },
                          },
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
      const stages = tournament.categories[0]?.stages ?? [];
      for (const [key, expectedCount, submittedBy] of [
        ["league", 96, "SYNTHETIC_LOCAL_SIX_ROUND_SCORES"],
        ["qualification", 8, "SYNTHETIC_LOCAL_QUALIFICATION_SCORES"],
      ] as const) {
        const matches =
          stages.find((s) => s.key === key)?.rounds.flatMap((r) => r.matches) ??
          [];
        if (
          matches.length !== expectedCount ||
          matches.some(
            (m) =>
              m.status !== "FINALIZED" ||
              m.currentResult?.status !== "ACCEPTED" ||
              m.currentResult.submittedBy !== submittedBy,
          )
        )
          throw new Error(
            `Expected the completed synthetic local ${key}; real results must not be seeded.`,
          );
      }
      const stage = stages.find((s) => s.key === "knockout");
      const selectedRound = stage?.rounds.find((r) => r.number === roundNumber);
      const nextRound = stage?.rounds.find((r) => r.number === roundNumber + 1);
      if (
        !stage ||
        stage.finalized ||
        stage.format !== "KNOCKOUT" ||
        selectedRound?.name !== roundName ||
        selectedRound.matches.length !== plans.length ||
        nextRound?.matches.length !== plans.length / 2
      )
        throw new Error(
          `Expected the existing active SOLO ${roundName.toLowerCase()} and next-round fixtures.`,
        );
      if (semifinalSeed) {
        const quarterfinals =
          stage.rounds.find((r) => r.number === 1)?.matches ?? [];
        if (
          quarterfinals.length !== 4 ||
          quarterfinals.some(
            (m) =>
              m.status !== "FINALIZED" ||
              m.currentResult?.status !== "ACCEPTED" ||
              m.currentResult.submittedBy !==
                "SYNTHETIC_LOCAL_SOLO_QUARTERFINAL_WINNERS" ||
              m.dependencies.some((d) => d.stale),
          )
        )
          throw new Error(
            "Expected the four completed synthetic local quarterfinals.",
          );
        for (const source of quarterfinals) {
          const target = selectedRound.matches.find(
            (m) => m.order === Math.ceil(source.order / 2),
          );
          const field = source.order % 2 ? "sideAId" : "sideBId";
          const winner =
            source.currentResult!.outcome === "A_WIN"
              ? source.sideAId
              : source.sideBId;
          if (
            !winner ||
            target?.[field] !== winner ||
            !target.dependencies.some((d) => d.sourceMatchId === source.id)
          )
            throw new Error(
              "Semifinal entrants must match the seeded quarterfinal winners.",
            );
        }
      }
      const participants = await tx.participant.findMany({
        where: { tournamentId: tournament.id },
        select: {
          id: true,
          code: true,
          member: { select: { displayIgn: true } },
        },
      });
      const names = new Map(
        participants.map((p) => [p.id, `${p.code} · ${p.member.displayIgn}`]),
      );
      let seeded = 0,
        advanced = 0;
      const results = [];
      for (const [index, match] of selectedRound.matches.entries()) {
        if (
          match.order !== index + 1 ||
          match.bestOf !== 5 ||
          !names.has(match.sideAId ?? "") ||
          !names.has(match.sideBId ?? "") ||
          match.dependencies.some((d) => d.stale)
        )
          throw new Error(
            "Knockout entrants, BO5 format and dependencies must be ready.",
          );
        const entry = readGameWinners(
          plans[index].map((winner) => ({ winner })),
          5,
        );
        validateSeries(
          5,
          entry.games,
          entry.outcome!,
          stage.rules as Rules,
          stage.confirmedRules,
        );
        const existing = match.currentResult;
        const alreadySeeded =
          match.status === "FINALIZED" &&
          existing?.status === "ACCEPTED" &&
          existing.submittedBy === marker &&
          existing.outcome === entry.outcome &&
          existing.games.length === entry.games.length &&
          existing.games.every(
            (g, i) =>
              g.number === i + 1 &&
              g.scoreA === entry.games[i].scoreA &&
              g.scoreB === entry.games[i].scoreB,
          );
        if (
          !alreadySeeded &&
          (match.status !== "SCHEDULED" ||
            match.results.length ||
            match.currentResultId)
        )
          throw new Error(
            "An existing result or started match must not be overwritten.",
          );
        const winner =
          entry.outcome === "A_WIN" ? match.sideAId! : match.sideBId!;
        const target = nextRound.matches.find(
          (m) => m.order === Math.ceil(match.order / 2),
        );
        const field = match.order % 2 ? "sideAId" : "sideBId";
        if (
          !target ||
          target.status !== "SCHEDULED" ||
          target.results.length ||
          target.dependencies.some((d) => d.stale) ||
          (target[field] && target[field] !== winner)
        )
          throw new Error(
            "An occupied or started downstream match must not be overwritten.",
          );
        if (apply && !alreadySeeded) {
          const result = await tx.resultVersion.create({
            data: {
              matchId: match.id,
              version: 1,
              outcome: entry.outcome!,
              status: "ACCEPTED",
              submittedBy: marker,
              acceptedBy: marker,
              acceptedAt: new Date(),
              idempotencyKey: randomUUID(),
              reason: encrypt(
                `Synthetic local ${roundName.toLowerCase()} demo winners; not a real played match.`,
                `result:${match.id}`,
              ),
              games: {
                create: entry.games.map((g, i) => ({ ...g, number: i + 1 })),
              },
            },
          });
          await tx.match.update({
            where: { id: match.id },
            data: { status: "FINALIZED", currentResultId: result.id },
          });
          await audit(
            tx,
            null,
            semifinalSeed
              ? "SEED_SEMIFINAL_RESULT"
              : "SEED_QUARTERFINAL_RESULT",
            "MATCH",
            match.id,
            {
              synthetic: true,
              resultId: result.id,
              outcome: entry.outcome,
              gameWinners: plans[index],
            },
            `Explicit local ${roundName.toLowerCase()} demo seed`,
            { source: "SEED", tournamentId: tournament.id, stageId: stage.id },
          );
          seeded++;
        }
        if (apply && target[field] !== winner) {
          await tx.match.update({
            where: { id: target.id },
            data: { [field]: winner },
          });
          await tx.bracketDependency.create({
            data: { sourceMatchId: match.id, matchId: target.id },
          });
          await audit(
            tx,
            null,
            "BRACKET_ADVANCE",
            "MATCH",
            target.id,
            { synthetic: true, sourceMatchId: match.id, winner },
            `Advance seeded local ${roundName.toLowerCase()} winner`,
            { source: "SEED", tournamentId: tournament.id, stageId: stage.id },
          );
          advanced++;
        }
        results.push({
          match: match.order,
          a: names.get(match.sideAId!),
          b: names.get(match.sideBId!),
          series: `${entry.winsA}–${entry.winsB}`,
          winner: names.get(winner),
          nextRound: nextRound.name,
          nextMatch: target.order,
          alreadySeeded,
        });
      }
      return { apply, seeded, advanced, results };
    },
    { timeout: 20000 },
  );
  console.log(JSON.stringify(summary, null, 2));
} finally {
  await db.$disconnect();
}
