import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type pg from "pg";
import { privateTx, type Actor } from "../src/lib/db";
import {
  newTournamentConfiguration,
  originalConfiguration,
  configuration,
} from "../src/lib/tournament-config";
import {
  configureTournament,
  applyRevision,
  rejectRevision,
  assignParticipants,
  generateTournamentLeague,
} from "../src/lib/configuration";
import {
  saveTournament,
  confirmRules,
  standingsFor,
  advanceWinner,
  submitResult,
  reviewResult,
  freezeRankings,
  createQualification,
  createSoloBracket,
} from "../src/lib/competition";
import { teamUpdate, createTeamBracket } from "../src/lib/operations";

export async function checkConfigurations(
  owner: pg.Client,
  actor: Actor,
  mod: Actor,
  check: (name: string, fn: () => Promise<void>) => Promise<void>,
  originalTournamentId: string,
  originalMatchId: string,
  seed: () => Promise<void>,
) {
  const members = (
    await owner.query('SELECT id FROM "Member" ORDER BY id LIMIT 32')
  ).rows.map((r) => r.id as string);
  await owner.query(
    'UPDATE "Member" SET verified=true WHERE id=ANY($1::text[])',
    [members],
  );
  const created = await saveTournament(mod, {
    name: "Synthetic 32-player competition",
    slug: "synthetic-config-" + randomUUID(),
    overview: "Configuration verification",
    status: "DRAFT",
    configuration: newTournamentConfiguration,
    reason: "Verify configurable draft creation",
  });
  await assignParticipants(mod, {
    id: created.id,
    memberIds: members,
    eligible: true,
    reason: "Assign approved synthetic players",
  });
  await check(
    "32-player schedule persists six rounds / 96 non-repeating matches",
    async () => {
      await generateTournamentLeague(mod, {
        id: created.id,
        reason: "Generate configured league",
      });
      const counts = (
        await owner.query(
          'SELECT count(*)::int matches,count(DISTINCT r.id)::int rounds FROM "Match" m JOIN "Round" r ON r.id=m."roundId" JOIN "Stage" s ON s.id=r."stageId" JOIN "Category" c ON c.id=s."categoryId" WHERE c."tournamentId"=$1',
          [created.id],
        )
      ).rows[0];
      assert.deepEqual(counts, { matches: 96, rounds: 6 });
      await assert.rejects(
        generateTournamentLeague(mod, {
          id: created.id,
          reason: "Prevent duplicate fixtures",
        }),
      );
    },
  );
  const teamCategory = await privateTx(actor, (tx) =>
    tx.category.findFirstOrThrow({
      where: { tournamentId: created.id, kind: "TEAM" },
      include: { stages: true },
    }),
  );
  const teamIds: string[] = [];
  await check(
    "eight complete TEAM entrants produce QF / SF / Final",
    async () => {
      for (let i = 0; i < 8; i++)
        teamIds.push(
          (
            await teamUpdate(mod, {
              categoryId: teamCategory.id,
              name: `Synthetic configured team ${i + 1}`,
              memberIds: members.slice(i * 4, i * 4 + 4),
              reason: "Create configured team",
            })
          ).id,
        );
      await confirmRules(actor, {
        stageId: teamCategory.stages[0].id,
        rules: { teamSeeding: "manual" },
        confirmedRules: ["teamSeeding"],
        reason: "Approve explicit team seeds",
      });
      await createTeamBracket(mod, {
        categoryId: teamCategory.id,
        teamIds,
        reason: "Generate eight-team bracket",
      });
      const rounds = await privateTx(actor, (tx) =>
        tx.round.findMany({
          where: { stageId: teamCategory.stages[0].id },
          orderBy: { number: "asc" },
          include: { matches: true },
        }),
      );
      assert.deepEqual(
        rounds.map((r) => r.name),
        ["Quarterfinals", "Semifinals", "Final"],
      );
      assert.deepEqual(
        rounds.map((r) => r.matches.length),
        [4, 2, 1],
      );
      assert.deepEqual(
        rounds.map((r) => r.matches[0].bestOf),
        [3, 3, 5],
      );
    },
  );
  await check(
    "capacity reductions cannot discard assigned players or active teams",
    async () => {
      await assert.rejects(
        configureTournament(mod, {
          id: created.id,
          configuration: {
            ...newTournamentConfiguration,
            soloCapacity: 31,
            leagueRounds: 31,
            leagueMatchesPerPlayer: 30,
            leagueByePolicy: "rotating_no_points",
          },
          regenerate: true,
          reason: "Reject player removal",
        }),
        /retain all 32/,
      );
      await assert.rejects(
        configureTournament(mod, {
          id: created.id,
          configuration: {
            ...newTournamentConfiguration,
            teamCapacity: 7,
            bracketByePolicy: "seeded_top",
          },
          regenerate: true,
          reason: "Reject team removal",
        }),
        /8 active teams/,
      );
      await assert.rejects(
        privateTx(mod, (tx) =>
          tx.category.update({
            where: { id: teamCategory.id },
            data: { capacity: 7 },
          }),
        ),
      );
      assert.equal(
        (
          await owner.query(
            'SELECT count(*)::int n FROM "Participant" WHERE "tournamentId"=$1',
            [created.id],
          )
        ).rows[0].n,
        32,
      );
      assert.equal(
        (
          await owner.query(
            'SELECT count(*)::int n FROM "Team" WHERE "categoryId"=$1',
            [teamCategory.id],
          )
        ).rows[0].n,
        8,
      );
    },
  );
  await check(
    "draft regeneration archives previous fixtures and retains entrants",
    async () => {
      const input = {
        id: created.id,
        configuration: {
          ...newTournamentConfiguration,
          leagueRounds: 4,
          leagueMatchesPerPlayer: 4,
        },
        regenerate: true,
        reason: "Change draft to four validated rounds",
      };
      await assert.rejects(
        configureTournament(mod, { ...input, regenerate: false }),
      );
      assert.equal((await configureTournament(mod, input)).status, "APPLIED");
      const counts = (
        await owner.query(
          'SELECT s.archived,count(*)::int n FROM "Match" m JOIN "Round" r ON r.id=m."roundId" JOIN "Stage" s ON s.id=r."stageId" JOIN "Category" c ON c.id=s."categoryId" WHERE c."tournamentId"=$1 GROUP BY s.archived ORDER BY s.archived',
          [created.id],
        )
      ).rows;
      assert.deepEqual(counts, [
        { archived: false, n: 64 },
        { archived: true, n: 103 },
      ]);
      assert.equal(
        (
          await owner.query(
            'SELECT count(*)::int n FROM "Participant" WHERE "tournamentId"=$1',
            [created.id],
          )
        ).rows[0].n,
        32,
      );
    },
  );
  await check(
    "explicit top-seed byes advance without fabricating results",
    async () => {
      await configureTournament(mod, {
        id: created.id,
        configuration: {
          ...newTournamentConfiguration,
          leagueRounds: 4,
          leagueMatchesPerPlayer: 4,
          teamBracketSize: 16,
          bracketByePolicy: "seeded_top",
        },
        regenerate: true,
        reason: "Approve a bracket with seeded byes",
      });
      const stage = await privateTx(actor, (tx) =>
        tx.stage.findFirstOrThrow({
          where: {
            categoryId: teamCategory.id,
            key: "knockout",
            archived: false,
          },
        }),
      );
      await confirmRules(actor, {
        stageId: stage.id,
        rules: { teamSeeding: "manual", byePolicy: "seeded_top" },
        confirmedRules: ["teamSeeding", "byePolicy"],
        reason: "Confirm seeded TEAM bye policy",
      });
      await createTeamBracket(mod, {
        categoryId: teamCategory.id,
        teamIds,
        reason: "Persist byes from explicit seeds",
      });
      const byes = await privateTx(actor, (tx) =>
        tx.match.findMany({
          where: { round: { stageId: stage.id, number: 1 }, status: "BYE" },
          orderBy: { order: "asc" },
        }),
      );
      assert.equal(byes.length, 8);
      await advanceWinner(mod, {
        matchId: byes[0].id,
        reason: "Advance explicit seeded bye",
      });
      const next = await privateTx(actor, (tx) =>
        tx.match.findFirstOrThrow({
          where: { round: { stageId: stage.id, number: 2 }, order: 1 },
        }),
      );
      assert.equal(next.sideAId, byes[0].sideAId);
      assert.equal(
        await privateTx(actor, (tx) =>
          tx.resultVersion.count({
            where: { match: { round: { stageId: stage.id } } },
          }),
        ),
        0,
      );
    },
  );
  let revisionId = "";
  await check(
    "changes after results remain pending and require admin resolution",
    async () => {
      const proposed = {
        ...originalConfiguration,
        scheduleSource: "generated",
        leagueRounds: 7,
        leagueMatchesPerPlayer: 7,
      };
      const before = (
        await owner.query(
          'SELECT configuration,"configurationVersion" FROM "Tournament" WHERE id=$1',
          [originalTournamentId],
        )
      ).rows[0];
      const rejected = await configureTournament(mod, {
        id: originalTournamentId,
        configuration: proposed,
        regenerate: true,
        reason: "First controlled proposal",
      });
      assert.equal(rejected.status, "PENDING");
      await rejectRevision(actor, {
        id: rejected.id,
        reason: "Retain rejected proposal history",
      });
      await assert.rejects(
        privateTx(actor, (tx) =>
          tx.configurationRevision.update({
            where: { id: rejected.id },
            data: { status: "PENDING" },
          }),
        ),
      );
      const r = await configureTournament(mod, {
        id: originalTournamentId,
        configuration: proposed,
        regenerate: true,
        reason: "Reviewed controlled restart proposal",
      });
      revisionId = r.id;
      assert.equal(r.status, "PENDING");
      assert.deepEqual(
        (
          await owner.query(
            'SELECT configuration,"configurationVersion" FROM "Tournament" WHERE id=$1',
            [originalTournamentId],
          )
        ).rows[0],
        before,
      );
      await assert.rejects(
        applyRevision(mod, {
          id: r.id,
          acknowledgement: "RESTART_AND_RETAIN_HISTORY",
          reason: "Moderator cannot restart results",
        }),
      );
      await assert.rejects(
        applyRevision(actor, {
          id: r.id,
          acknowledgement: "",
          reason: "No implicit restart",
        }),
      );
      await assert.rejects(
        privateTx(mod, (tx) =>
          tx.tournament.update({
            where: { id: originalTournamentId },
            data: { configuration: configuration(proposed) },
          }),
        ),
      );
    },
  );
  await check(
    "controlled restart retains result versions, evidence and archived standings",
    async () => {
      const results = (
        await owner.query(
          'SELECT * FROM "ResultVersion" WHERE "matchId"=$1 ORDER BY version',
          [originalMatchId],
        )
      ).rows;
      const evidence = (
        await owner.query(
          'SELECT e.* FROM "Evidence" e JOIN "ResultVersion" v ON v.id=e."resultId" WHERE v."matchId"=$1 ORDER BY e.id',
          [originalMatchId],
        )
      ).rows;
      await applyRevision(actor, {
        id: revisionId,
        acknowledgement: "RESTART_AND_RETAIN_HISTORY",
        reason:
          "Restart competition with old results retained and excluded from current standings",
      });
      assert.deepEqual(
        (
          await owner.query(
            'SELECT * FROM "ResultVersion" WHERE "matchId"=$1 ORDER BY version',
            [originalMatchId],
          )
        ).rows,
        results,
      );
      assert.deepEqual(
        (
          await owner.query(
            'SELECT e.* FROM "Evidence" e JOIN "ResultVersion" v ON v.id=e."resultId" WHERE v."matchId"=$1 ORDER BY e.id',
            [originalMatchId],
          )
        ).rows,
        evidence,
      );
      const old = (
        await owner.query(
          'SELECT s.archived,s."archivedStandings" FROM "Match" m JOIN "Round" r ON r.id=m."roundId" JOIN "Stage" s ON s.id=r."stageId" WHERE m.id=$1',
          [originalMatchId],
        )
      ).rows[0];
      assert.equal(old.archived, true);
      assert.equal(old.archivedStandings.length, 64);
      assert.ok(
        old.archivedStandings.some((r: { played: number }) => r.played === 1),
      );
      const current = await privateTx(actor, (tx) =>
        tx.stage.findFirstOrThrow({
          where: {
            category: { tournamentId: originalTournamentId },
            key: "league",
            archived: false,
          },
        }),
      );
      const rows = (
        await privateTx(actor, (tx) => standingsFor(tx, current.id))
      ).rows;
      assert.ok(rows.every((r) => r.played === 0));
      assert.equal(
        await privateTx(actor, (tx) =>
          tx.match.count({ where: { round: { stageId: current.id } } }),
        ),
        224,
      );
      await assert.rejects(
        reviewResult(actor, {
          id: results[0].id,
          action: "DISPUTE",
          reason: "No edits to retained history",
        }),
      );
      await assert.rejects(
        submitResult(actor, {
          matchId: originalMatchId,
          idempotencyKey: randomUUID(),
          outcome: "A_WIN",
          games: [
            { scoreA: 3, scoreB: 0 },
            { scoreA: 3, scoreB: 0 },
          ],
          reason: "No new versions in archived stages",
        }),
      );
      await assert.rejects(
        owner.query("UPDATE \"Match\" SET status='VOIDED' WHERE id=$1", [
          originalMatchId,
        ]),
      );
      await seed();
      assert.equal(
        (
          await owner.query(
            'SELECT "configurationVersion" FROM "Tournament" WHERE id=$1',
            [originalTournamentId],
          )
        ).rows[0].configurationVersion,
        3,
      );
      assert.equal(
        await privateTx(actor, (tx) =>
          tx.match.count({ where: { round: { stageId: current.id } } }),
        ),
        224,
      );
    },
  );
  await check(
    "odd leagues persist explicit balanced byes and award no points",
    async () => {
      const config = configuration({
        ...newTournamentConfiguration,
        soloCapacity: 5,
        teamCapacity: 2,
        teamBracketSize: 2,
        leagueRounds: 5,
        leagueMatchesPerPlayer: 4,
        directSlots: 4,
        playoffSlots: 0,
        playoffEntrants: 0,
        soloBracketSize: 4,
        leagueByePolicy: "rotating_no_points",
      });
      const t = await saveTournament(mod, {
        name: "Synthetic odd league",
        slug: "synthetic-odd-" + randomUUID(),
        overview: "Balanced bye verification",
        status: "DRAFT",
        configuration: config,
        reason: "Create explicit odd league",
      });
      await assignParticipants(mod, {
        id: t.id,
        memberIds: members.slice(0, 5),
        eligible: true,
        reason: "Assign five approved players",
      });
      await generateTournamentLeague(mod, {
        id: t.id,
        reason: "Generate balanced odd cycle",
      });
      const stage = await privateTx(actor, (tx) =>
        tx.stage.findFirstOrThrow({
          where: {
            category: { tournamentId: t.id },
            key: "league",
            archived: false,
          },
        }),
      );
      assert.equal(
        await privateTx(actor, (tx) =>
          tx.match.count({
            where: { round: { stageId: stage.id }, status: "BYE" },
          }),
        ),
        5,
      );
      assert.equal(
        await privateTx(actor, (tx) =>
          tx.match.count({
            where: { round: { stageId: stage.id }, status: "SCHEDULED" },
          }),
        ),
        10,
      );
      assert.ok(
        (await privateTx(actor, (tx) => standingsFor(tx, stage.id))).rows.every(
          (r) => r.played === 0 && r.points === 0,
        ),
      );
    },
  );
  await check(
    "configured qualification and SOLO bracket use completed frozen rankings",
    async () => {
      const config = configuration({
        ...newTournamentConfiguration,
        soloCapacity: 4,
        teamCapacity: 2,
        teamBracketSize: 2,
        leagueRounds: 1,
        leagueMatchesPerPlayer: 1,
        directSlots: 2,
        playoffSlots: 2,
        playoffEntrants: 2,
        soloBracketSize: 4,
        qualificationMatchesPerPlayer: 1,
      });
      const t = await saveTournament(mod, {
        name: "Synthetic full progression",
        slug: "synthetic-progression-" + randomUUID(),
        overview: "Verify configured stage progression",
        status: "DRAFT",
        configuration: config,
        reason: "Create full synthetic progression",
      });
      await assignParticipants(mod, {
        id: t.id,
        memberIds: members.slice(0, 4),
        eligible: true,
        reason: "Assign four approved entrants",
      });
      await generateTournamentLeague(mod, {
        id: t.id,
        reason: "Generate one configured round",
      });
      const stages = await privateTx(actor, (tx) =>
          tx.stage.findMany({
            where: { category: { tournamentId: t.id, kind: "SOLO" } },
          }),
        ),
        l = stages.find((s) => s.key === "league")!,
        q = stages.find((s) => s.key === "qualification")!,
        k = stages.find((s) => s.key === "knockout")!;
      const scoring = {
          seriesPoints: true,
          drawPolicy: "no_draws",
          tiebreakers: ["differential"],
        },
        keys = ["seriesPoints", "drawPolicy", "tiebreakers"];
      await confirmRules(actor, {
        stageId: l.id,
        rules: scoring,
        confirmedRules: keys,
        reason: "Confirm synthetic league rules",
      });
      await confirmRules(actor, {
        stageId: q.id,
        rules: {
          seriesPoints: true,
          drawPolicy: "no_draws",
          qualificationBestOf: 3,
          qualificationPairing: "manual",
          qualificationCarry: false,
          qualificationTiebreakers: ["differential"],
        },
        confirmedRules: [
          "seriesPoints",
          "drawPolicy",
          "qualificationBestOf",
          "qualificationPairing",
          "qualificationCarry",
          "qualificationTiebreakers",
        ],
        reason: "Confirm synthetic qualification rules",
      });
      await confirmRules(actor, {
        stageId: k.id,
        rules: { knockoutPairing: "ranked_cross" },
        confirmedRules: ["knockoutPairing"],
        reason: "Confirm synthetic knockout pairing",
      });
      const accept = async (matchId: string) => {
        const result = await submitResult(mod, {
          matchId,
          idempotencyKey: randomUUID(),
          outcome: "A_WIN",
          games: [
            { scoreA: 3, scoreB: 0 },
            { scoreA: 3, scoreB: 0 },
          ],
          reason: "Complete synthetic stage match",
        });
        await privateTx(actor, (tx) =>
          tx.evidence.create({
            data: {
              resultId: result.id,
              storageKey: randomUUID(),
              mime: "image/png",
              size: 8,
              uploadedBy: actor.id,
            },
          }),
        );
        await reviewResult(mod, {
          id: result.id,
          action: "ACCEPT",
          reason: "Synthetic evidence verified",
        });
      };
      const leagueMatches = await privateTx(actor, (tx) =>
        tx.match.findMany({ where: { round: { stageId: l.id } } }),
      );
      for (const m of leagueMatches) await accept(m.id);
      const leagueRows = (
        await privateTx(actor, (tx) => standingsFor(tx, l.id))
      ).rows;
      const leagueIds = [...leagueRows]
        .sort((a, b) => b.points - a.points || a.id.localeCompare(b.id))
        .map((r) => r.id);
      await freezeRankings(actor, {
        stageId: l.id,
        rankedIds: leagueIds,
        reason: "Explicitly resolve synthetic equal-score ties",
      });
      await createQualification(mod, {
        stageId: q.id,
        pairs: [leagueIds.slice(2)],
        reason: "Generate configured two-player playoff",
      });
      const qualifier = await privateTx(actor, (tx) =>
        tx.match.findFirstOrThrow({ where: { round: { stageId: q.id } } }),
      );
      await accept(qualifier.id);
      const qualRows = (await privateTx(actor, (tx) => standingsFor(tx, q.id)))
        .rows;
      await freezeRankings(actor, {
        stageId: q.id,
        rankedIds: [...qualRows]
          .sort((a, b) => b.points - a.points)
          .map((r) => r.id),
        reason: "Freeze completed playoff ranking",
      });
      await createSoloBracket(mod, {
        categoryId: l.categoryId,
        reason: "Generate four-player SOLO knockout",
      });
      const rounds = await privateTx(actor, (tx) =>
        tx.round.findMany({
          where: { stageId: k.id },
          orderBy: { number: "asc" },
          include: { matches: { orderBy: { order: "asc" } } },
        }),
      );
      assert.deepEqual(
        rounds.map((r) => r.name),
        ["Semifinals", "Final"],
      );
      assert.deepEqual(
        rounds.map((r) => r.matches.length),
        [2, 1],
      );
      assert.ok(rounds.flatMap((r) => r.matches).every((m) => m.bestOf === 5));
      assert.equal(rounds[0].matches[0].sideAId, leagueIds[0]);
      // A controlled restart keeps the frozen, explicitly resolved league order.
      const revision = await configureTournament(mod, {
        id: t.id,
        configuration: {
          ...config,
          leagueRounds: 2,
          leagueMatchesPerPlayer: 2,
        },
        regenerate: true,
        reason: "Verify frozen standings preservation",
      });
      assert.equal(revision.status, "PENDING");
      await applyRevision(actor, {
        id: revision.id,
        acknowledgement: "RESTART_AND_RETAIN_HISTORY",
        reason:
          "Retain completed league and playoff standings while restarting stages",
      });
      const archived = await privateTx(actor, (tx) =>
        tx.stage.findUniqueOrThrow({ where: { id: l.id } }),
      );
      assert.deepEqual(
        (archived.archivedStandings as { id: string; rank: number }[]).map(
          (r) => r.id,
        ),
        leagueIds,
      );
      assert.deepEqual(
        (archived.archivedStandings as { id: string; rank: number }[]).map(
          (r) => r.rank,
        ),
        [1, 2, 3, 4],
      );
    },
  );
}
