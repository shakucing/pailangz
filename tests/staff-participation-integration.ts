import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type pg from "pg";
import type { Actor } from "../src/lib/db";

export async function checkStaffParticipation(
  owner: pg.Client,
  actor: Actor,
  check: (name: string, fn: () => Promise<void>) => Promise<void>,
) {
  const { privateTx } = await import("../src/lib/db");
  const { saveTournament } = await import("../src/lib/competition");
  const { assignParticipants } = await import("../src/lib/configuration");
  const { staffParticipation } = await import("../src/lib/staff-participation");
  const { newTournamentConfiguration } =
    await import("../src/lib/tournament-config");
  const prefix = `participation-${randomUUID()}`;
  const event = await saveTournament(actor, {
    name: "Participation roster test",
    slug: prefix,
    overview: "Synthetic test",
    status: "DRAFT",
    configuration: newTournamentConfiguration,
  });
  const memberIds = Array.from({ length: 33 }, () => randomUUID());
  for (let n = 0; n < memberIds.length; n++) {
    const name = `${prefix} player ${String(n + 1).padStart(2, "0")}${n === 32 ? " literal %_ ' name" : ""}`;
    await owner.query(
      'INSERT INTO "Member" (id,"displayIgn","canonicalIgn",verified) VALUES ($1,$2,$2,true)',
      [memberIds[n], name],
    );
  }
  await assignParticipants(actor, {
    id: event.id,
    memberIds: memberIds.slice(0, 32),
    eligible: true,
    reason: "",
  });
  const signupIds = [randomUUID(), randomUUID()];
  for (let n = 0; n < 2; n++)
    await owner.query(
      'INSERT INTO "ParticipationRequest" (id,"tournamentId","memberId","createdAt") VALUES ($1,$2,$3,\'2030-01-01T00:00:00Z\')',
      [signupIds[n], event.id, memberIds[n]],
    );
  const read = (page = 1, search = prefix) =>
    privateTx(actor, (tx) => staffParticipation(tx, { page, search }));

  await check(
    "participation includes 32 draft assignments even when only two signup requests exist",
    async () => {
      const result = await read();
      assert.equal(result.total, 32);
      assert.equal(result.rows.length, 32);
      assert.equal(
        new Set(result.rows.map((row) => `${row.tournamentId}:${row.memberId}`))
          .size,
        32,
      );
      assert.equal(result.rows.filter((row) => row.receivedAt).length, 2);
      assert.equal(result.rows.filter((row) => !row.receivedAt).length, 30);
      assert.ok(
        result.rows.every(
          (row) =>
            row.member.participants.find((p) => p.tournamentId === event.id)
              ?.eligible,
        ),
      );
      for (const id of signupIds)
        assert.ok(
          result.rows.some(
            (row) =>
              row.id === id &&
              row.receivedAt?.toISOString() === "2030-01-01T00:00:00.000Z",
          ),
        );
      assert.equal(
        (
          await owner.query(
            'SELECT count(*)::int n FROM "ParticipationRequest" WHERE "tournamentId"=$1',
            [event.id],
          )
        ).rows[0].n,
        2,
        "Reading staff assignments must not fabricate signup requests",
      );
    },
  );
  await check(
    "participation preserves draft-only withdrawal, eligibility and team status",
    async () => {
      await owner.query(
        'UPDATE "Participant" SET withdrawn=true,eligible=false WHERE "tournamentId"=$1 AND "memberId"=$2',
        [event.id, memberIds[31]],
      );
      const category = (
        await owner.query(
          'SELECT id FROM "Category" WHERE "tournamentId"=$1 AND kind=\'TEAM\'',
          [event.id],
        )
      ).rows[0];
      const teamId = randomUUID();
      await owner.query(
        "INSERT INTO \"Team\" (id,\"categoryId\",name,code,slug) VALUES ($1,$2,'Roster team','T01','roster-test')",
        [teamId, category.id],
      );
      await owner.query(
        'INSERT INTO "TeamMembership" (id,"teamId","categoryId","memberId") VALUES ($1,$2,$3,$4)',
        [randomUUID(), teamId, category.id, memberIds[0]],
      );
      const result = await read();
      const withdrawn = result.rows.find(
        (row) => row.memberId === memberIds[31],
      );
      assert.equal(withdrawn?.member.participants[0].withdrawn, true);
      assert.equal(withdrawn?.member.participants[0].eligible, false);
      assert.equal(
        result.rows.find((row) => row.memberId === memberIds[0])?.member
          .memberships[0].team.name,
        "Roster team",
      );
      assert.equal(result.total, 32);
    },
  );

  const secondEvent = await saveTournament(actor, {
    name: "Second participation event",
    slug: `${prefix}-second`,
    overview: "Synthetic test",
    status: "DRAFT",
    configuration: newTournamentConfiguration,
  });
  await assignParticipants(actor, {
    id: secondEvent.id,
    memberIds: memberIds.slice(0, 24),
    eligible: true,
    reason: "",
  });
  for (const memberId of [memberIds[0], memberIds[32]])
    await owner.query(
      'INSERT INTO "ParticipationRequest" (id,"tournamentId","memberId") VALUES ($1,$2,$3)',
      [randomUUID(), secondEvent.id, memberId],
    );

  await check(
    "participation deduplicates each player within a tournament while retaining separate tournaments and signup-only players",
    async () => {
      const first = await read(),
        second = await read(2);
      const all = [...first.rows, ...second.rows];
      assert.equal(first.total, 57);
      assert.equal(second.total, 57);
      assert.equal(first.rows.length, 50);
      assert.equal(second.rows.length, 7);
      assert.equal(
        new Set(all.map((row) => `${row.tournamentId}:${row.memberId}`)).size,
        57,
      );
      assert.equal(
        all.filter((row) => row.memberId === memberIds[0]).length,
        2,
      );
      assert.equal(
        all.find((row) => row.memberId === memberIds[32])?.member.participants
          .length,
        0,
      );
      assert.equal(all.filter((row) => row.receivedAt).length, 4);
      assert.equal((await read(3)).rows.length, 0);
      assert.deepEqual(
        (await read()).rows.map((row) => row.id),
        first.rows.map((row) => row.id),
        "Pagination order must be stable",
      );
    },
  );
  await check(
    "participation searches both sources case-insensitively and treats punctuation as literal text",
    async () => {
      const result = await read(1, `${prefix.toUpperCase()} PLAYER 01`);
      assert.equal(result.total, 2);
      assert.equal(result.rows.length, 2);
      assert.equal((await read(1, "%_ '")).total, 1);
      assert.equal((await read(1, "' OR true --")).total, 0);
    },
  );
  await check(
    "revoked sessions cannot read the combined participation list",
    async () => {
      await assert.rejects(
        privateTx({ ...actor, sessionId: randomUUID() }, (tx) =>
          staffParticipation(tx, { page: 1 }),
        ),
        /Staff access has been revoked/,
      );
    },
  );
}
