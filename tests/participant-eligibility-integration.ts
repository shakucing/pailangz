import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type pg from "pg";
import type { Actor } from "../src/lib/db";

export async function checkBulkParticipantEligibility(
  owner: pg.Client,
  actor: Actor,
  check: (name: string, fn: () => Promise<void>) => Promise<void>,
) {
  const { bulkParticipantEligibility } = await import("../src/lib/operations");
  const tournamentId = randomUUID(),
    otherTournamentId = randomUUID();
  for (const id of [tournamentId, otherTournamentId])
    await owner.query(
      "INSERT INTO \"Tournament\" (id,slug,name,overview) VALUES ($1,$1,'Bulk eligibility test','Synthetic test')",
      [id],
    );
  const ids: string[] = [];
  const memberIds: string[] = [];
  for (let n = 0; n < 33; n++) {
    const memberId = randomUUID(),
      id = randomUUID();
    memberIds.push(memberId);
    ids.push(id);
    await owner.query(
      'INSERT INTO "Member" (id,"displayIgn","canonicalIgn",verified) VALUES ($1,$1,$1,true)',
      [memberId],
    );
    await owner.query(
      'INSERT INTO "Participant" (id,"tournamentId","memberId",code) VALUES ($1,$2,$3,$4)',
      [
        id,
        n < 32 ? tournamentId : otherTournamentId,
        memberId,
        `P${String(n + 1).padStart(2, "0")}`,
      ],
    );
  }
  const chosen = ids.slice(0, 32);
  const rows = async () =>
    (
      await owner.query(
        'SELECT id,eligible,provisional FROM "Participant" WHERE "tournamentId"=$1 ORDER BY code',
        [tournamentId],
      )
    ).rows;
  const unchangedAfter = async (
    fn: () => Promise<unknown>,
    message?: RegExp,
  ) => {
    const before = await rows();
    if (message) await assert.rejects(fn, message);
    else await assert.rejects(fn);
    assert.deepEqual(await rows(), before);
  };

  await check(
    "moderator bulk eligibility changes all 32 entrants and records the selection in one audit event",
    async () => {
      assert.deepEqual(
        await bulkParticipantEligibility(actor, {
          tournamentId,
          ids: chosen,
          eligible: true,
        }),
        { count: 32 },
      );
      assert.ok((await rows()).every((p) => p.eligible && p.provisional));
      const log = (
        await owner.query(
          'SELECT * FROM "AuditEvent" WHERE action=\'PARTICIPANTS_ELIGIBILITY\' AND "entityId"=$1',
          [tournamentId],
        )
      ).rows;
      assert.equal(log.length, 1);
      assert.equal(log[0].actorId, actor.id);
      assert.equal(log[0].tournamentId, tournamentId);
      assert.deepEqual(log[0].relatedIds, chosen);
      assert.deepEqual(log[0].changes, { eligible: true, playerCount: 32 });
    },
  );
  await check(
    "bulk ineligible changes only the selected entrants and respects confirmed player mapping",
    async () => {
      await owner.query(
        'UPDATE "Tournament" SET "mappingConfirmed"=true WHERE id=$1',
        [tournamentId],
      );
      await bulkParticipantEligibility(actor, {
        tournamentId,
        ids: chosen.slice(0, 2),
        eligible: false,
        reason: "Test eligibility change",
      });
      const current = await rows();
      assert.ok(
        current.slice(0, 2).every((p) => !p.eligible && !p.provisional),
      );
      assert.ok(current.slice(2).every((p) => p.eligible));
      await bulkParticipantEligibility(actor, {
        tournamentId,
        ids: chosen,
        eligible: true,
      });
    },
  );
  await check(
    "published tournaments, withdrawn entrants and unverified or archived members reject the entire selection",
    async () => {
      await owner.query('UPDATE "Tournament" SET published=true WHERE id=$1', [
        tournamentId,
      ]);
      await unchangedAfter(
        () =>
          bulkParticipantEligibility(actor, {
            tournamentId,
            ids: chosen,
            eligible: false,
          }),
        /Unpublish/,
      );
      await owner.query('UPDATE "Tournament" SET published=false WHERE id=$1', [
        tournamentId,
      ]);
      await owner.query(
        'UPDATE "Participant" SET withdrawn=true,eligible=false WHERE id=$1',
        [chosen[1]],
      );
      await unchangedAfter(
        () =>
          bulkParticipantEligibility(actor, {
            tournamentId,
            ids: chosen,
            eligible: false,
          }),
        /withdrawn/,
      );
      await owner.query(
        'UPDATE "Participant" SET withdrawn=false,eligible=true WHERE id=$1',
        [chosen[1]],
      );
      for (const field of ["verified", "archived"]) {
        await owner.query(`UPDATE "Member" SET ${field}=$1 WHERE id=$2`, [
          field === "archived",
          memberIds[1],
        ]);
        await unchangedAfter(
          () =>
            bulkParticipantEligibility(actor, {
              tournamentId,
              ids: chosen,
              eligible: true,
            }),
          /Approve and verify/,
        );
        await owner.query(`UPDATE "Member" SET ${field}=$1 WHERE id=$2`, [
          field === "verified",
          memberIds[1],
        ]);
      }
    },
  );
  await check(
    "foreign, missing, duplicate, empty and oversized player selections cannot update any entrants",
    async () => {
      for (const selection of [
        [chosen[0], ids[32]],
        [chosen[0], randomUUID()],
        [chosen[0], chosen[0]],
        [],
        Array.from({ length: 257 }, () => randomUUID()),
      ])
        await unchangedAfter(() =>
          bulkParticipantEligibility(actor, {
            tournamentId,
            ids: selection,
            eligible: false,
          }),
        );
    },
  );
  await check(
    "bulk eligibility rolls back if activity history cannot be written",
    async () => {
      await owner.query(`CREATE FUNCTION reject_bulk_eligibility_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='PARTICIPANTS_ELIGIBILITY' THEN RAISE EXCEPTION 'Bulk audit unavailable'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER reject_bulk_eligibility_audit BEFORE INSERT ON "AuditEvent" FOR EACH ROW EXECUTE FUNCTION reject_bulk_eligibility_audit();`);
      try {
        await unchangedAfter(
          () =>
            bulkParticipantEligibility(actor, {
              tournamentId,
              ids: chosen,
              eligible: false,
            }),
          /Bulk audit unavailable/,
        );
      } finally {
        await owner.query(
          'DROP TRIGGER reject_bulk_eligibility_audit ON "AuditEvent"; DROP FUNCTION reject_bulk_eligibility_audit();',
        );
      }
    },
  );
  await check(
    "a revoked staff session cannot change bulk eligibility",
    async () => {
      await unchangedAfter(
        () =>
          bulkParticipantEligibility(
            { ...actor, sessionId: randomUUID() },
            { tournamentId, ids: chosen, eligible: false },
          ),
        /Staff access has been revoked/,
      );
    },
  );
}
