import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type pg from "pg";
import { privateTx, type Actor } from "../src/lib/db";
import { saveTournament } from "../src/lib/competition";
import {
  landingHighlightsSchema,
  saveLandingHighlights,
} from "../src/lib/landing-highlights";
import { newTournamentConfiguration } from "../src/lib/tournament-config";

export async function checkLandingHighlights(
  owner: pg.Client,
  admin: Actor,
  moderator: Actor,
  check: (name: string, fn: () => Promise<void>) => Promise<void>,
) {
  const solo = await saveTournament(admin, {
    name: "Highlight SOLO",
    overview: "Selected SOLO preview",
    status: "DRAFT",
    configuration: newTournamentConfiguration,
  });
  const otherSolo = await saveTournament(admin, {
    name: "Replacement SOLO",
    overview: "Replacement SOLO preview",
    status: "DRAFT",
    configuration: newTournamentConfiguration,
  });
  const team = await saveTournament(admin, {
    name: "Highlight TEAM",
    overview: "Selected TEAM preview",
    status: "DRAFT",
    configuration: { ...newTournamentConfiguration, format: "TEAM" },
  });
  // A real saved draft score must remain absent from the highlighted preview.
  const stage = (
    await owner.query(
      'SELECT s.id FROM "Stage" s JOIN "Category" c ON c.id=s."categoryId" WHERE c."tournamentId"=$1 LIMIT 1',
      [team.id],
    )
  ).rows[0];
  const roundId = randomUUID(),
    matchId = randomUUID(),
    resultId = randomUUID();
  await owner.query(
    'INSERT INTO "Round"(id,"stageId",number,name) VALUES($1,$2,1,\'Draft final\')',
    [roundId, stage.id],
  );
  await owner.query(
    'INSERT INTO "Match"(id,"roundId","order","bestOf",status,"scheduledAt","sideKind") VALUES($1,$2,1,3,\'FINALIZED\',now(),\'TEAM\')',
    [matchId, roundId],
  );
  await owner.query(
    "INSERT INTO \"ResultVersion\"(id,\"matchId\",version,outcome,status,\"submittedBy\",reason,\"idempotencyKey\") VALUES($1,$2,1,'A_WIN','ACCEPTED','HIGHLIGHT_QA','Private draft score',$3)",
    [resultId, matchId, randomUUID()],
  );
  await owner.query(
    'INSERT INTO "GameResult"(id,"resultId",number,"scoreA","scoreB") VALUES($1,$2,1,15,7)',
    [randomUUID(), resultId],
  );
  await owner.query('UPDATE "Match" SET "currentResultId"=$1 WHERE id=$2', [
    resultId,
    matchId,
  ]);
  const selected = () =>
    owner.query(
      'SELECT format,"tournamentId" FROM "LandingHighlight" WHERE "tournamentId" IS NOT NULL ORDER BY format ASC',
    );
  const visible = () =>
    owner.query(
      'SELECT format,slug FROM "PublicLandingHighlight" ORDER BY format ASC',
    );
  await check(
    "landing highlights start empty and reject multiple selections per format",
    async () => {
      assert.equal((await selected()).rowCount, 0);
      assert.equal((await visible()).rowCount, 0);
      assert.equal(
        landingHighlightsSchema.safeParse({ soloId: [solo.id, otherSolo.id] })
          .success,
        false,
      );
      assert.equal(
        landingHighlightsSchema.safeParse({ teamId: [team.id, team.id] })
          .success,
        false,
      );
      assert.deepEqual(landingHighlightsSchema.parse({}), {
        soloId: null,
        teamId: null,
        reason: "",
      });
      await owner.query(
        "INSERT INTO \"LandingHighlight\"(format) VALUES('SOLO'),('TEAM')",
      );
      await assert.rejects(
        owner.query(
          'INSERT INTO "LandingHighlight"(format,"tournamentId") VALUES(\'SOLO\',$1)',
          [solo.id],
        ),
        /duplicate key/,
      );
      await assert.rejects(
        owner.query("INSERT INTO \"LandingHighlight\"(format) VALUES('OTHER')"),
        /check constraint/,
      );
      await assert.rejects(
        owner.query(
          'UPDATE "LandingHighlight" SET "tournamentId"=$1 WHERE format=\'TEAM\'',
          [solo.id],
        ),
        /matching the highlight format/,
      );
      await owner.query('DELETE FROM "LandingHighlight"');
    },
  );
  await check(
    "staff can choose SOLO only, TEAM only, both, or neither",
    async () => {
      for (const [soloId, teamId] of [
        [solo.id, null],
        [null, team.id],
        [solo.id, team.id],
        [null, null],
      ] as const) {
        await saveLandingHighlights(moderator, { soloId, teamId });
        assert.deepEqual((await selected()).rows, [
          ...(soloId ? [{ format: "SOLO", tournamentId: soloId }] : []),
          ...(teamId ? [{ format: "TEAM", tournamentId: teamId }] : []),
        ]);
        assert.equal(
          (await visible()).rowCount,
          Number(!!soloId) + Number(!!teamId),
        );
      }
    },
  );
  await check(
    "replacement is atomic and wrong-format or archived selections preserve both slots",
    async () => {
      await saveLandingHighlights(admin, { soloId: solo.id, teamId: team.id });
      await saveLandingHighlights(moderator, {
        soloId: otherSolo.id,
        teamId: team.id,
      });
      const before = (await selected()).rows;
      await assert.rejects(
        saveLandingHighlights(admin, { soloId: solo.id, teamId: otherSolo.id }),
        /Choose a TEAM tournament/,
      );
      assert.deepEqual((await selected()).rows, before);
      await owner.query(
        "UPDATE \"Tournament\" SET status='ARCHIVED' WHERE id=$1",
        [solo.id],
      );
      await assert.rejects(
        saveLandingHighlights(admin, { soloId: solo.id, teamId: team.id }),
        /Archived tournaments/,
      );
      assert.deepEqual((await selected()).rows, before);
      await owner.query(
        "UPDATE \"Tournament\" SET status='ARCHIVED' WHERE id=$1",
        [otherSolo.id],
      );
      assert.deepEqual(
        (await visible()).rows.map((row) => row.format),
        ["TEAM"],
      );
      await owner.query(
        "UPDATE \"Tournament\" SET status='DRAFT' WHERE id IN ($1,$2)",
        [solo.id, otherSolo.id],
      );
    },
  );
  await check(
    "anonymous viewers see chosen previews but cannot edit highlights or read draft records",
    async () => {
      await owner.query("BEGIN");
      try {
        await owner.query("SET LOCAL ROLE pailangz_app");
        assert.deepEqual(
          (await visible()).rows.map((row) => row.format),
          ["SOLO", "TEAM"],
        );
        assert.equal((await selected()).rowCount, 0);
        assert.equal(
          (
            await owner.query(
              'UPDATE "LandingHighlight" SET "tournamentId"=NULL',
            )
          ).rowCount,
          0,
        );
        assert.equal(
          (
            await owner.query(
              'SELECT id FROM "Tournament" WHERE id IN ($1,$2)',
              [otherSolo.id, team.id],
            )
          ).rowCount,
          0,
        );
        const previews = (
          await owner.query(
            'SELECT data FROM "PublicEventPreview" WHERE data->>\'slug\' IN (SELECT slug FROM "PublicLandingHighlight")',
          )
        ).rows;
        assert.equal(previews.length, 2);
        let matchCount = 0;
        for (const { data } of previews)
          for (const category of data.categories)
            for (const stage of category.stages)
              for (const round of stage.rounds)
                for (const match of round.matches) {
                  matchCount++;
                  assert.equal(match.result, null);
                  assert.equal(match.status, "SCHEDULED");
                  assert.equal(match.scheduledAt, null);
                }
        assert.ok(matchCount > 0);
      } finally {
        await owner.query("ROLLBACK");
      }
      const events = await privateTx(admin, (tx) =>
        tx.auditEvent.findMany({
          where: { action: "LANDING_HIGHLIGHTS_UPDATE" },
        }),
      );
      assert.ok(events.some((event) => event.actorId === moderator.id));
      assert.ok(events.some((event) => event.actorId === admin.id));
      await saveLandingHighlights(admin, { soloId: null, teamId: null });
      const hidden = await owner.query(
        'SELECT data FROM "PublicEventPreview" WHERE data->>\'slug\' IN (SELECT slug FROM "Tournament" WHERE id IN ($1,$2))',
        [otherSolo.id, team.id],
      );
      assert.equal(hidden.rowCount, 0);
    },
  );
}
