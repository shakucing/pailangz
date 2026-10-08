import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type pg from "pg";
import { encrypt } from "../src/lib/crypto";
import type { Actor } from "../src/lib/db";
import { newTournamentConfiguration } from "../src/lib/tournament-config";

export async function checkParticipation(
  owner: pg.Client,
  actor: Actor,
  check: (name: string, fn: () => Promise<void>) => Promise<void>,
) {
  const { submitParticipation } = await import("../src/lib/participation");
  const { participationStatus } =
    await import("../src/lib/participation-status");
  const { privateTx } = await import("../src/lib/db");
  const memberId = randomUUID();
  const ign = "Participation player ✨";
  const tiktokId = "@PRIVATE_PARTICIPATION_CANARY";
  const encrypted = encrypt(
    JSON.stringify({
      "Tiktok ID": tiktokId,
      "Tiktok username": "Different display name",
    }),
    `member:${memberId}`,
  );
  await owner.query(
    'INSERT INTO "Member" (id,"displayIgn","canonicalIgn",verified) VALUES ($1,$2,$3,true)',
    [memberId, ign, ign.toLowerCase()],
  );
  await owner.query(
    'INSERT INTO "MemberPrivate" ("memberId","originalIgn","registrationEncrypted") VALUES ($1,$2,$3)',
    [memberId, ign, encrypted],
  );
  const originalTournament = (
    await owner.query(
      "SELECT * FROM \"Tournament\" WHERE slug='pailangz-solo-team'",
    )
  ).rows[0];
  const tournament = { id: randomUUID() };
  await owner.query('UPDATE "Tournament" SET slug=$1 WHERE id=$2', [
    `previous-${originalTournament.id}`,
    originalTournament.id,
  ]);
  await owner.query(
    "INSERT INTO \"Tournament\" (id,slug,name,overview,status,configuration,\"registrationEnabled\") VALUES ($1,'pailangz-solo-team','Participation test','Test','DRAFT',$2,true)",
    [tournament.id, JSON.stringify(newTournamentConfiguration)],
  );
  await owner.query(
    "INSERT INTO \"Category\" (id,\"tournamentId\",kind,capacity) VALUES ($1,$2,'SOLO',32),($3,$2,'TEAM',8)",
    [randomUUID(), tournament.id, randomUUID()],
  );
  await owner.query(
    "UPDATE \"IntegrationSetting\" SET value=$1 WHERE key='officialSeedTournament'",
    [JSON.stringify(tournament.id)],
  );
  const input = { ign, tiktokId };
  try {
    await check(
      "participation link follows the selected event and ignores seed provenance",
      async () => {
        assert.equal(await participationStatus(), "OPEN");
        await owner.query('UPDATE "Tournament" SET slug=$1 WHERE id=$2', [
          `unavailable-${tournament.id}`,
          tournament.id,
        ]);
        assert.equal(await participationStatus(), "CLOSED");
        await owner.query(
          "UPDATE \"Tournament\" SET slug='pailangz-solo-team' WHERE id=$1",
          [tournament.id],
        );
        await owner.query(
          "UPDATE \"IntegrationSetting\" SET value=$1 WHERE key='officialSeedTournament'",
          [JSON.stringify(originalTournament.id)],
        );
        assert.equal(await participationStatus(), "OPEN");
        await owner.query(
          "UPDATE \"IntegrationSetting\" SET value=$1 WHERE key='officialSeedTournament'",
          [JSON.stringify(tournament.id)],
        );
        assert.equal(await participationStatus(), "OPEN");
      },
    );
    await check(
      "participation rejects unknown, mismatched, missing, unapproved and archived identities",
      async () => {
        for (const bad of [
          { ...input, ign: "Unknown player" },
          { ...input, tiktokId: "incorrect" },
          { ...input, tiktokId: "Different_display_name" },
        ])
          await assert.rejects(submitParticipation(bad), /VERIFICATION_FAILED/);
        for (const change of ["verified=false", "archived=true"]) {
          await owner.query(`UPDATE "Member" SET ${change} WHERE id=$1`, [
            memberId,
          ]);
          await assert.rejects(
            submitParticipation(input),
            /VERIFICATION_FAILED/,
          );
          await owner.query(
            'UPDATE "Member" SET verified=true,archived=false WHERE id=$1',
            [memberId],
          );
        }
        await owner.query(
          'UPDATE "MemberPrivate" SET "registrationEncrypted"=$1 WHERE "memberId"=$2',
          [
            encrypt(JSON.stringify({ "Tiktok ID": "" }), `member:${memberId}`),
            memberId,
          ],
        );
        await assert.rejects(submitParticipation(input), /VERIFICATION_FAILED/);
        await owner.query(
          'UPDATE "MemberPrivate" SET "registrationEncrypted"=$1 WHERE "memberId"=$2',
          [encrypted, memberId],
        );
        assert.equal(
          (
            await owner.query(
              'SELECT * FROM "ParticipationRequest" WHERE "memberId"=$1',
              [memberId],
            )
          ).rowCount,
          0,
        );
      },
    );
    await check(
      "active members are automatically approved once with a SOLO slot and immediate team access",
      async () => {
        const counts = async () =>
          (
            await owner.query(
              'SELECT (SELECT count(*) FROM "Participant")::int solo,(SELECT count(*) FROM "TeamMembership")::int team',
            )
          ).rows[0];
        const before = await counts();
        await submitParticipation({
          ign: ign.toUpperCase(),
          tiktokId: tiktokId.slice(1).toLowerCase(),
        });
        await Promise.all([
          submitParticipation(input),
          submitParticipation(input),
        ]);
        assert.deepEqual(await counts(), {
          solo: before.solo + 1,
          team: before.team,
        });
        const slots = (
          await owner.query(
            'SELECT * FROM "Participant" WHERE "tournamentId"=$1 AND "memberId"=$2',
            [tournament.id, memberId],
          )
        ).rows;
        assert.equal(slots.length, 1);
        assert.equal(slots[0].eligible, true);
        assert.equal(slots[0].provisional, false);
        assert.equal(slots[0].code, "P01");
        assert.equal(await participationStatus(), "OPEN");
        const { startMemberAccess, teamState, endMemberAccess } =
          await import("../src/lib/team-portal");
        const token = await startMemberAccess(input);
        assert.equal(
          (await teamState(token, "pailangz-solo-team"))?.approved,
          true,
        );
        await endMemberAccess(token);
        const rows = await privateTx(actor, (tx) =>
          tx.participationRequest.findMany({ where: { memberId } }),
        );
        assert.equal(rows.length, 1);
        assert.equal(rows[0].tournamentId, tournament.id);
        const audit = (
          await owner.query('SELECT * FROM "AuditEvent" WHERE "entityId"=$1', [
            rows[0].id,
          ])
        ).rows;
        assert.equal(audit.length, 2);
        assert.deepEqual(
          audit.find((a) => a.action === "PARTICIPATION_SUBMIT").changes,
          { categories: ["SOLO", "TEAM"] },
        );
        assert.deepEqual(
          audit.find((a) => a.action === "PARTICIPATION_AUTO_APPROVE").changes,
          { categories: ["SOLO", "TEAM"], eligible: true, code: "P01" },
        );
        assert.ok(!JSON.stringify({ rows, audit }).includes(tiktokId));
        await assert.rejects(
          submitParticipation({ ...input, tiktokId: "incorrect" }),
          /VERIFICATION_FAILED/,
        );
      },
    );
    await check(
      "32-player application limit serializes the final slot and accepts retries at capacity",
      async () => {
        const createdIds: string[] = [];
        try {
          const count = Number(
            (
              await owner.query(
                'SELECT count(*) FROM "ParticipationRequest" WHERE "tournamentId"=$1',
                [tournament.id],
              )
            ).rows[0].count,
          );
          for (let i = count; i < 31; i++) {
            const id = randomUUID();
            createdIds.push(id);
            await owner.query(
              'INSERT INTO "Member" (id,"displayIgn","canonicalIgn",verified) VALUES ($1,$1,$1,true)',
              [id],
            );
            await owner.query(
              'INSERT INTO "ParticipationRequest" (id,"tournamentId","memberId") VALUES ($1,$2,$3)',
              [randomUUID(), tournament.id, id],
            );
          }
          const candidates = [];
          for (let i = 0; i < 2; i++) {
            const id = randomUUID();
            createdIds.push(id);
            await owner.query(
              'INSERT INTO "Member" (id,"displayIgn","canonicalIgn",verified) VALUES ($1,$1,$1,true)',
              [id],
            );
            await owner.query(
              'INSERT INTO "MemberPrivate" ("memberId","originalIgn","registrationEncrypted") VALUES ($1,$1,$2)',
              [
                id,
                encrypt(
                  JSON.stringify({ "Tiktok ID": "capacity_player" }),
                  `member:${id}`,
                ),
              ],
            );
            candidates.push({ ign: id, tiktokId: "capacity_player" });
          }
          assert.equal(await participationStatus(), "OPEN");
          const results = await Promise.allSettled(
            candidates.map(submitParticipation),
          );
          assert.equal(await participationStatus(), "FULL");
          assert.equal(
            results.filter((r) => r.status === "fulfilled").length,
            1,
          );
          const rejected = results.find((r) => r.status === "rejected");
          assert.ok(rejected?.status === "rejected");
          assert.equal(rejected.reason.message, "FULL");
          assert.equal(rejected.reason.status, 409);
          await submitParticipation(input);
          const auditBefore = (
            await owner.query(
              "SELECT count(*) FROM \"AuditEvent\" WHERE action='PARTICIPATION_SUBMIT'",
            )
          ).rows[0].count;
          const overflow =
            candidates[results.findIndex((r) => r.status === "rejected")];
          await assert.rejects(submitParticipation(overflow), /FULL/);
          assert.equal(
            (
              await owner.query(
                "SELECT count(*) FROM \"AuditEvent\" WHERE action='PARTICIPATION_SUBMIT'",
              )
            ).rows[0].count,
            auditBefore,
          );
          assert.equal(
            Number(
              (
                await owner.query(
                  'SELECT count(*) FROM "ParticipationRequest" WHERE "tournamentId"=$1',
                  [tournament.id],
                )
              ).rows[0].count,
            ),
            32,
          );
        } finally {
          await owner.query(
            'DELETE FROM "Participant" WHERE "memberId"=ANY($1::text[])',
            [createdIds],
          );
          await owner.query(
            'DELETE FROM "ParticipationRequest" WHERE "memberId"=ANY($1::text[])',
            [createdIds],
          );
          await owner.query(
            'DELETE FROM "MemberPrivate" WHERE "memberId"=ANY($1::text[])',
            [createdIds],
          );
          await owner.query('DELETE FROM "Member" WHERE id=ANY($1::text[])', [
            createdIds,
          ]);
          assert.equal(await participationStatus(), "OPEN");
        }
      },
    );
    await check(
      "existing active applications are backfilled without approving archived members or creating fixtures",
      async () => {
        const ids = [randomUUID(), randomUUID()];
        try {
          for (const [i, id] of ids.entries()) {
            await owner.query(
              'INSERT INTO "Member" (id,"displayIgn","canonicalIgn",verified,archived) VALUES ($1,$1,$1,true,$2)',
              [id, i === 1],
            );
            await owner.query(
              'INSERT INTO "MemberPrivate" ("memberId","originalIgn","registrationEncrypted") VALUES ($1,$1,$2)',
              [
                id,
                encrypt(
                  JSON.stringify({ "Tiktok ID": "backfill_player" }),
                  `member:${id}`,
                ),
              ],
            );
            await owner.query(
              'INSERT INTO "ParticipationRequest" (id,"tournamentId","memberId") VALUES ($1,$2,$3)',
              [randomUUID(), tournament.id, id],
            );
          }
          const migration = await readFile(
            "prisma/migrations/202610080017_automatic_participation_approval/migration.sql",
            "utf8",
          );
          await owner.query(migration);
          const slots = (
            await owner.query(
              'SELECT * FROM "Participant" WHERE "memberId"=ANY($1::text[])',
              [ids],
            )
          ).rows;
          assert.equal(slots.length, 1);
          assert.equal(slots[0].memberId, ids[0]);
          assert.equal(slots[0].eligible, true);
          assert.equal(slots[0].provisional, false);
          const audits = (
            await owner.query('SELECT count(*) FROM "AuditEvent"')
          ).rows[0].count;
          await owner.query(migration);
          assert.equal(
            (await owner.query('SELECT count(*) FROM "AuditEvent"')).rows[0]
              .count,
            audits,
          );
          assert.equal(
            (
              await owner.query(
                'SELECT * FROM "Match" m JOIN "Round" r ON r.id=m."roundId" JOIN "Stage" s ON s.id=r."stageId" JOIN "Category" c ON c.id=s."categoryId" WHERE c."tournamentId"=$1',
                [tournament.id],
              )
            ).rowCount,
            0,
          );
        } finally {
          const latest = await readFile(
            "prisma/migrations/202610080020_moderator_tournament_setup/migration.sql",
            "utf8",
          );
          const wrapper = latest.slice(
            latest.indexOf(
              "CREATE OR REPLACE FUNCTION app_submit_participation(request_id",
            ),
            latest.indexOf(
              "CREATE OR REPLACE FUNCTION category_capacity_guard",
            ),
          );
          await owner.query(wrapper);
          await owner.query(
            'DELETE FROM "Participant" WHERE "memberId"=ANY($1::text[])',
            [ids],
          );
          await owner.query(
            'DELETE FROM "ParticipationRequest" WHERE "memberId"=ANY($1::text[])',
            [ids],
          );
          await owner.query(
            'DELETE FROM "MemberPrivate" WHERE "memberId"=ANY($1::text[])',
            [ids],
          );
          await owner.query('DELETE FROM "Member" WHERE id=ANY($1::text[])', [
            ids,
          ]);
        }
      },
    );
    await check(
      "automatic approvals respect existing staff-assigned slots and roll back when their audit fails",
      async () => {
        const ids: string[] = [];
        try {
          for (let i = 0; i < 32; i++) {
            const id = randomUUID();
            ids.push(id);
            await owner.query(
              'INSERT INTO "Member" (id,"displayIgn","canonicalIgn",verified) VALUES ($1,$1,$1,true)',
              [id],
            );
            if (i < 31)
              await owner.query(
                'INSERT INTO "Participant" (id,"tournamentId","memberId",code,eligible,provisional) VALUES ($1,$2,$3,$4,true,false)',
                [randomUUID(), tournament.id, id, `P${i + 2}`],
              );
          }
          const id = ids[31];
          await owner.query(
            'INSERT INTO "MemberPrivate" ("memberId","originalIgn","registrationEncrypted") VALUES ($1,$1,$2)',
            [
              id,
              encrypt(
                JSON.stringify({ "Tiktok ID": "full_roster" }),
                `member:${id}`,
              ),
            ],
          );
          const candidate = { ign: id, tiktokId: "full_roster" };
          assert.equal(await participationStatus(), "FULL");
          await assert.rejects(submitParticipation(candidate), /FULL/);
          assert.equal(
            (
              await owner.query(
                'SELECT * FROM "ParticipationRequest" WHERE "memberId"=$1',
                [id],
              )
            ).rowCount,
            0,
          );
          await owner.query('DELETE FROM "Participant" WHERE "memberId"=$1', [
            ids[0],
          ]);
          assert.equal(await participationStatus(), "OPEN");
          const countBefore = (
            await owner.query('SELECT count(*) FROM "AuditEvent"')
          ).rows[0].count;
          await owner.query(
            `CREATE FUNCTION test_reject_automatic_approval() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='PARTICIPATION_AUTO_APPROVE' THEN RAISE EXCEPTION 'Test audit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER test_reject_automatic_approval BEFORE INSERT ON "AuditEvent" FOR EACH ROW EXECUTE FUNCTION test_reject_automatic_approval()`,
          );
          try {
            await assert.rejects(
              submitParticipation(candidate),
              /Test audit failure/,
            );
          } finally {
            await owner.query(
              'DROP TRIGGER test_reject_automatic_approval ON "AuditEvent"; DROP FUNCTION test_reject_automatic_approval()',
            );
          }
          assert.equal(
            (await owner.query('SELECT count(*) FROM "AuditEvent"')).rows[0]
              .count,
            countBefore,
          );
          assert.equal(
            (
              await owner.query(
                'SELECT * FROM "ParticipationRequest" WHERE "memberId"=$1',
                [id],
              )
            ).rowCount,
            0,
          );
          assert.equal(
            (
              await owner.query(
                'SELECT * FROM "Participant" WHERE "memberId"=$1',
                [id],
              )
            ).rowCount,
            0,
          );
          await submitParticipation(candidate);
          assert.equal(await participationStatus(), "FULL");
          assert.equal(
            (
              await owner.query(
                'SELECT code FROM "Participant" WHERE "memberId"=$1',
                [id],
              )
            ).rows[0].code,
            "P33",
          );
          assert.equal(
            Number(
              (
                await owner.query(
                  'SELECT count(*) FROM "Participant" WHERE "tournamentId"=$1',
                  [tournament.id],
                )
              ).rows[0].count,
            ),
            32,
          );
        } finally {
          await owner.query(
            'DELETE FROM "Participant" WHERE "memberId"=ANY($1::text[])',
            [ids],
          );
          await owner.query(
            'DELETE FROM "ParticipationRequest" WHERE "memberId"=ANY($1::text[])',
            [ids],
          );
          await owner.query(
            'DELETE FROM "MemberPrivate" WHERE "memberId"=ANY($1::text[])',
            [ids],
          );
          await owner.query('DELETE FROM "Member" WHERE id=ANY($1::text[])', [
            ids,
          ]);
        }
      },
    );
    await check(
      "participation enforces event lifecycle and deadline",
      async () => {
        for (const status of [
          "REGISTRATION_CLOSED",
          "IN_PROGRESS",
          "COMPLETED",
          "ARCHIVED",
        ]) {
          await owner.query('UPDATE "Tournament" SET status=$1 WHERE id=$2', [
            status,
            tournament.id,
          ]);
          assert.equal(await participationStatus(), "CLOSED");
          await assert.rejects(submitParticipation(input), /CLOSED/);
        }
        await owner.query(
          "UPDATE \"Tournament\" SET status='REGISTRATION_OPEN',\"registrationDeadline\"=now()-interval '1 second' WHERE id=$1",
          [tournament.id],
        );
        await assert.rejects(submitParticipation(input), /CLOSED/);
        assert.equal(await participationStatus(), "CLOSED");
        await owner.query(
          'UPDATE "Tournament" SET "registrationDeadline"=now()+interval \'1 day\' WHERE id=$1',
          [tournament.id],
        );
        await submitParticipation(input);
        assert.equal(await participationStatus(), "OPEN");
        await owner.query(
          'UPDATE "Tournament" SET published=true WHERE id=$1',
          [tournament.id],
        );
        await assert.rejects(submitParticipation(input), /CLOSED/);
        assert.equal(await participationStatus(), "CLOSED");
        await owner.query(
          'UPDATE "Tournament" SET published=false WHERE id=$1',
          [tournament.id],
        );
      },
    );
    await check(
      "participation table stays private and stale verification cannot submit",
      async () => {
        await owner.query("BEGIN");
        try {
          await owner.query("SET LOCAL ROLE pailangz_app");
          assert.equal(
            (await owner.query("SELECT app_participation_status() AS status"))
              .rows[0].status,
            "OPEN",
          );
          assert.equal(
            (await owner.query('SELECT * FROM "ParticipationRequest"'))
              .rowCount,
            0,
          );
          const result = await owner.query(
            "SELECT app_submit_participation($1,$2,$3,$4,$5) result",
            [
              randomUUID(),
              memberId,
              ign.toLowerCase(),
              "stale-ciphertext",
              randomUUID(),
            ],
          );
          assert.equal(result.rows[0].result, "VERIFICATION_FAILED");
          await assert.rejects(
            owner.query(
              'INSERT INTO "ParticipationRequest" (id,"tournamentId","memberId") VALUES ($1,$2,$3)',
              [randomUUID(), tournament.id, memberId],
            ),
            /permission denied|row-level security/,
          );
        } finally {
          await owner.query("ROLLBACK");
        }
      },
    );
  } finally {
    await owner.query('UPDATE "Tournament" SET slug=$1 WHERE id=$2', [
      `participation-test-${tournament.id}`,
      tournament.id,
    ]);
    await owner.query(
      "UPDATE \"Tournament\" SET slug='pailangz-solo-team' WHERE id=$1",
      [originalTournament.id],
    );
    await owner.query(
      "UPDATE \"IntegrationSetting\" SET value=$1 WHERE key='officialSeedTournament'",
      [JSON.stringify(originalTournament.id)],
    );
  }
}
