import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type pg from "pg";
import { privateTx, type Actor } from "../src/lib/db";
import { persistBracket } from "../src/lib/brackets";
import {
  configuration,
  newTournamentConfiguration,
  THIRD_PLACE_ROUND,
} from "../src/lib/tournament-config";
import {
  assignParticipants,
  configurePlacementSeries,
} from "../src/lib/configuration";
import {
  saveTournament,
  confirmRules,
  submitResult,
  reviewResult,
  advanceWinner,
} from "../src/lib/competition";

export async function checkPlacementMatches(
  owner: pg.Client,
  admin: Actor,
  mod: Actor,
  check: (name: string, fn: () => Promise<void>) => Promise<void>,
) {
  for (const legacy of [false, true])
    await check(
      `${legacy ? "existing" : "new"} bracket preserves scores, routes semifinal losers, configures BO7 placement and keeps the final separate`,
      async () => {
        const config = configuration({
          ...newTournamentConfiguration,
          soloCapacity: 4,
          soloBracketSize: 4,
          leagueRounds: 1,
          leagueMatchesPerPlayer: 1,
          directSlots: 4,
          playoffSlots: 0,
          playoffEntrants: 0,
          soloFinalBestOf: 9,
        });
        const event = await saveTournament(admin, {
          name: "Placement test",
          slug: `placement-${randomUUID()}`,
          overview: "Isolated placement integration test",
          status: "DRAFT",
          configuration: config,
          reason: "Test placement matches",
        });
        const members = (
          await owner.query(
            'SELECT id FROM "Member" WHERE verified ORDER BY id LIMIT 4',
          )
        ).rows.map((r) => r.id as string);
        await assignParticipants(admin, {
          id: event.id,
          memberIds: members,
          eligible: true,
          reason: "Test players",
        });
        const stage = await privateTx(admin, (tx) =>
          tx.stage.findFirstOrThrow({
            where: { key: "knockout", category: { tournamentId: event.id } },
          }),
        );
        await confirmRules(admin, {
          stageId: stage.id,
          rules: {
            seriesPoints: true,
            drawPolicy: "no_draws",
            specialOutcomes: "forfeit",
          },
          confirmedRules: ["seriesPoints", "drawPolicy", "specialOutcomes"],
          reason: "Test rules",
        });
        const players = await privateTx(admin, (tx) =>
          tx.participant.findMany({
            where: { tournamentId: event.id },
            orderBy: { code: "asc" },
          }),
        );
        await privateTx(admin, (tx) =>
          persistBracket(
            tx,
            stage.id,
            4,
            [
              { a: players[0].id, b: players[1].id },
              { a: players[2].id, b: players[3].id },
            ],
            "SOLO",
            config,
          ),
        );
        const read = () =>
          privateTx(admin, (tx) =>
            tx.round.findMany({
              where: { stageId: stage.id },
              orderBy: { number: "asc" },
              include: {
                matches: {
                  orderBy: { order: "asc" },
                  include: {
                    currentResult: { include: { games: true } },
                    dependencies: true,
                  },
                },
              },
            }),
          );
        if (legacy) {
          const round = (await read()).find(
            (r) => r.name === THIRD_PLACE_ROUND,
          )!;
          await owner.query('DELETE FROM "Match" WHERE "roundId"=$1', [
            round.id,
          ]);
          await owner.query('DELETE FROM "Round" WHERE id=$1', [round.id]);
        }
        const accept = async (
          matchId: string,
          bestOf: number,
          outcome: "A_WIN" | "B_WIN" | "A_FORFEIT",
        ) => {
          const games =
            outcome === "A_FORFEIT"
              ? []
              : Array.from({ length: (bestOf + 1) / 2 }, () => ({
                  scoreA: outcome === "A_WIN" ? 1 : 0,
                  scoreB: outcome === "B_WIN" ? 1 : 0,
                }));
          const result = await submitResult(mod, {
            matchId,
            outcome,
            games,
            idempotencyKey: randomUUID(),
            reason: "Test completed series",
          });
          await reviewResult(mod, {
            id: result.id,
            action: "ACCEPT",
            reason: "Test result checked",
          });
        };
        const semis = (await read())[0].matches;
        await accept(semis[0].id, 5, "A_WIN");
        await accept(semis[1].id, 5, "A_FORFEIT");
        for (const semi of semis)
          await advanceWinner(mod, {
            matchId: semi.id,
            reason: "Advance semifinal",
          });
        const before = await read();
        const settings = {
          id: event.id,
          finalBestOf: 9,
          thirdPlaceBestOf: 7,
          reason: "Configure placement without restart",
        };
        await assert.rejects(
          configurePlacementSeries(mod, settings),
          /Admin permission/,
        );
        await assert.rejects(
          configurePlacementSeries(admin, { ...settings, reason: "" }),
          /at least 3/,
        );
        await assert.rejects(
          configurePlacementSeries(admin, { ...settings, thirdPlaceBestOf: 6 }),
          /odd number/,
        );
        await configurePlacementSeries(admin, {
          ...settings,
          thirdPlaceBestOf: 11,
        });
        await configurePlacementSeries(admin, settings);
        const after = await read();
        assert.equal(after.length, 3);
        assert.deepEqual(after[0], before[0]);
        assert.deepEqual(after[1], before[1]);
        const final = after.find((r) => r.name === "Final")!.matches[0];
        const third = after.find((r) => r.name === THIRD_PLACE_ROUND)!
          .matches[0];
        assert.equal(final.bestOf, 9);
        assert.equal(third.bestOf, 7);
        assert.deepEqual(
          [final.sideAId, final.sideBId],
          [players[0].id, players[3].id],
        );
        assert.deepEqual(
          [third.sideAId, third.sideBId],
          [players[1].id, players[2].id],
        );
        assert.equal(third.currentResultId, null);
        assert.deepEqual(
          third.dependencies.map((d) => d.sourceMatchId).sort(),
          semis.map((m) => m.id).sort(),
        );
        for (const semi of semis)
          await advanceWinner(mod, {
            matchId: semi.id,
            reason: "Idempotent repeat",
          });
        assert.deepEqual(await read(), after);
        const tournament = await privateTx(admin, (tx) =>
          tx.tournament.findUniqueOrThrow({ where: { id: event.id } }),
        );
        assert.equal(tournament.status, "DRAFT");
        assert.equal(tournament.published, false);
        assert.equal(
          await privateTx(admin, (tx) =>
            tx.stage.count({
              where: { archived: true, category: { tournamentId: event.id } },
            }),
          ),
          0,
        );
        await owner.query(
          "UPDATE \"Match\" SET status='IN_PROGRESS' WHERE id=$1",
          [third.id],
        );
        await assert.rejects(
          configurePlacementSeries(admin, { ...settings, thirdPlaceBestOf: 9 }),
          /already started/,
        );
        await owner.query(
          "UPDATE \"Match\" SET status='SCHEDULED' WHERE id=$1",
          [third.id],
        );
        await accept(final.id, 9, "A_WIN");
        assert.deepEqual(
          await advanceWinner(mod, {
            matchId: final.id,
            reason: "Finish final",
          }),
          { completed: true },
        );
        const unchangedThird = (await read()).find(
          (r) => r.name === THIRD_PLACE_ROUND,
        )!.matches[0];
        assert.deepEqual(unchangedThird, third);
        await accept(third.id, 7, "B_WIN");
        assert.deepEqual(
          await advanceWinner(mod, {
            matchId: third.id,
            reason: "Finish playoff",
          }),
          { completed: true },
        );
        await assert.rejects(
          configurePlacementSeries(admin, { ...settings, thirdPlaceBestOf: 9 }),
          /recorded results/,
        );
        await assert.rejects(
          configurePlacementSeries(admin, { ...settings, finalBestOf: 7 }),
          /recorded results/,
        );
        // A semifinal correction invalidates both placement routes.
        await accept(semis[0].id, 5, "B_WIN");
        const changed = await read();
        for (const round of changed.filter((r) => r.name !== "Semifinals"))
          assert.ok(
            round.matches[0].dependencies.some(
              (d) => d.sourceMatchId === semis[0].id && d.stale,
            ),
          );
      },
    );
}
