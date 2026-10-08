import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createServer } from "node:net";
import pg from "pg";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { encrypt } from "../src/lib/crypto";
const native = process.env.TEST_PG_BIN_DIR;
const directory = await mkdtemp(path.join(tmpdir(), "pailangz-test-"));
const probe = createServer();
await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
const port = (probe.address() as { port: number }).port;
await new Promise<void>((resolve) => probe.close(() => resolve()));
let wasm: PGlite | undefined, socket: PGLiteSocketServer | undefined;
if (native) {
  execFileSync(
    path.join(native, "initdb"),
    [
      "-D",
      directory,
      "-U",
      "postgres",
      "-A",
      "trust",
      "--encoding=UTF8",
      "--locale=C",
    ],
    { stdio: "ignore" },
  );
  execFileSync(
    path.join(native, "pg_ctl"),
    [
      "-D",
      directory,
      "-l",
      path.join(directory, "server.log"),
      "-o",
      `-h 127.0.0.1 -p ${port} -k ${directory}`,
      "-w",
      "start",
    ],
    { stdio: "ignore" },
  );
} else {
  wasm = await PGlite.create();
  await wasm.exec("SET TIME ZONE 'UTC'");
  socket = new PGLiteSocketServer({
    db: wasm,
    host: "127.0.0.1",
    port,
    maxConnections: 20,
  });
  await socket.start();
}
const ownerUrl = `postgresql://postgres@127.0.0.1:${port}/postgres?sslmode=disable`;
const runtimePassword = randomBytes(24).toString("hex");
process.env.DATABASE_URL = native
  ? `postgresql://pailangz_app:${runtimePassword}@127.0.0.1:${port}/postgres?sslmode=disable`
  : ownerUrl;
process.env.MIGRATION_DATABASE_URL = ownerUrl;
process.env.APP_ENV = "development";
process.env.DATABASE_ENV = "development";
process.env.LOCAL_PGLITE = native ? "false" : "true";
process.env.DATA_ENCRYPTION_KEYS = JSON.stringify({
  test: randomBytes(32).toString("base64"),
});
process.env.ACTIVE_ENCRYPTION_KEY = "test";
process.env.PHONE_DEFAULT_COUNTRY = "MY";
const owner = new pg.Client({ connectionString: ownerUrl });
await owner.connect();
let passed = 0;
async function check(name: string, fn: () => Promise<void>) {
  await fn();
  passed++;
  console.log(`PASS ${name}`);
}
try {
  for (const name of (await readdir("prisma/migrations"))
    .sort()
    .filter((n) => /^\d/.test(n)))
    await owner.query(
      await readFile(`prisma/migrations/${name}/migration.sql`, "utf8"),
    );
  await owner.query(
    `ALTER ROLE pailangz_app LOGIN PASSWORD '${runtimePassword}'`,
  );
  const { seed } = await import("../prisma/seed");
  await seed({ legacyFixtures: true });
  await seed();
  const { db, privateTx, audit, ensureRuntime } = await import("../src/lib/db");
  const { ingest, decideRegistration } = await import("../src/lib/imports");
  const {
    submitResult,
    reviewResult,
    freezeRankings,
    resolveDispute,
    standingsFor,
    confirmRules,
    publishTournament,
  } = await import("../src/lib/competition");
  const { teamUpdate, staffUpdate, resolveDependency } =
    await import("../src/lib/operations");
  await ensureRuntime();
  const adminId = randomUUID(),
    moderatorId = randomUUID(),
    sessionId = randomUUID(),
    modSessionId = randomUUID();
  for (const [id, role, sid] of [
    [adminId, "ADMIN", sessionId],
    [moderatorId, "MODERATOR", modSessionId],
  ]) {
    await owner.query(
      'INSERT INTO "StaffUser"(id,email,name,"passwordHash",role,"createdAt") VALUES($1,$2,$3,$4,$5,now())',
      [
        id,
        `${id}@synthetic.invalid`,
        "Integration operator",
        "not-a-login-password",
        role,
      ],
    );
    await owner.query(
      'INSERT INTO "StaffSession"(id,"userId","expiresAt") VALUES($1,$2,now()+interval \'1 hour\')',
      [sid, id],
    );
  }
  const actor = {
      id: adminId,
      role: "ADMIN" as const,
      sessionId,
      authenticatedAt: new Date(),
    },
    mod = {
      id: moderatorId,
      role: "MODERATOR" as const,
      sessionId: modSessionId,
      authenticatedAt: new Date(),
    };
  await check(
    "Prisma session expirations remain future UTC instants",
    async () => {
      const session = await db.staffSession.create({
        data: {
          userId: adminId,
          expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        },
      });
      const row = (
        await owner.query(
          'SELECT "expiresAt">now() AS future FROM "StaffSession" WHERE id=$1',
          [session.id],
        )
      ).rows[0];
      assert.equal(row.future, true);
    },
  );
  const tournament = (await owner.query('SELECT id FROM "Tournament" LIMIT 1'))
    .rows[0];
  const league = (
    await owner.query("SELECT id FROM \"Stage\" WHERE key='league' LIMIT 1")
  ).rows[0];
  await check(
    "idempotent official seed preserves 64 players / 192 empty results",
    async () => {
      const counts = (
        await owner.query(
          'SELECT (SELECT count(*) FROM "Member")::int members,(SELECT count(*) FROM "Match")::int matches,(SELECT count(*) FROM "ResultVersion")::int results',
        )
      ).rows[0];
      assert.deepEqual(counts, { members: 64, matches: 192, results: 0 });
    },
  );
  let submissionId = "";
  await check(
    "anonymous event preview uses saved codes and hides player names and draft results",
    async () => {
      await owner.query("BEGIN");
      try {
        const saved = (
          await owner.query(
            'SELECT id,code FROM "Participant" WHERE "tournamentId"=$1',
            [tournament.id],
          )
        ).rows;
        const labels = new Map(saved.map((p) => [p.id, p.code]));
        const expected = (
          await owner.query(
            'SELECT m.id,m."sideAId",m."sideBId" FROM "Match" m JOIN "Round" r ON r.id=m."roundId" JOIN "Stage" s ON s.id=r."stageId" WHERE s.id=$1',
            [league.id],
          )
        ).rows;
        await owner.query(
          'UPDATE "Member" SET "displayIgn"=$1 WHERE id=(SELECT "memberId" FROM "Participant" WHERE "tournamentId"=$2 LIMIT 1)',
          ["PRIVATE_PREVIEW_IGN_CANARY", tournament.id],
        );
        await owner.query("SET LOCAL ROLE pailangz_app");
        const preview = (
          await owner.query('SELECT data FROM "PublicEventPreview"')
        ).rows[0].data;
        assert.ok(
          !JSON.stringify(preview).includes("PRIVATE_PREVIEW_IGN_CANARY"),
        );
        assert.deepEqual(
          preview.participants.map((p: { code: string }) => p.code).sort(),
          saved.map((p) => p.code).sort(),
        );
        const matches = preview.categories.flatMap(
          (c: {
            stages: {
              rounds: {
                matches: {
                  id: string;
                  a: string;
                  b: string;
                  result: unknown;
                }[];
              }[];
            }[];
          }) => c.stages.flatMap((s) => s.rounds.flatMap((r) => r.matches)),
        );
        assert.equal(matches.length, expected.length);
        for (const match of matches) {
          const record = expected.find((m) => m.id === match.id);
          assert.equal(match.a, labels.get(record.sideAId));
          assert.equal(match.b, labels.get(record.sideBId));
          assert.equal(match.result, null);
        }
        assert.equal(
          (await owner.query('SELECT id FROM "Participant"')).rows.length,
          0,
          "Anonymous role still cannot read the underlying draft participants",
        );
      } finally {
        await owner.query("ROLLBACK");
      }
    },
  );
  await check(
    "landing name view exposes only original SOLO roster names and excludes archived members",
    async () => {
      await owner.query("BEGIN");
      try {
        const saved = (
          await owner.query(
            'SELECT p.code,m.id AS "memberId",m."displayIgn" AS ign FROM "Participant" p JOIN "Member" m ON m.id=p."memberId" WHERE p."tournamentId"=$1 ORDER BY p.code',
            [tournament.id],
          )
        ).rows;
        await owner.query(
          'INSERT INTO "Tournament"(id,slug,name,overview) VALUES($1,$2,$3,$4)',
          ["other-name-event", "other-name-event", "Other event", "Test"],
        );
        await owner.query(
          'INSERT INTO "Participant"(id,"tournamentId","memberId",code) VALUES($1,$2,$3,$4)',
          ["other-name-player", "other-name-event", saved[0].memberId, "P99"],
        );
        await owner.query("SET LOCAL ROLE pailangz_app");
        const names = (
          await owner.query(
            'SELECT * FROM "PublicEventPlayerName" ORDER BY code',
          )
        ).rows;
        assert.equal(names.length, saved.length);
        assert.deepEqual(
          names.map(({ code, ign }) => ({ code, ign })),
          saved.map(({ code, ign }) => ({ code, ign })),
        );
        assert.deepEqual(Object.keys(names[0]).sort(), ["code", "ign", "slug"]);
        assert.ok(names.every((p) => p.slug === "pailangz-solo-team"));
        assert.equal(
          (await owner.query('SELECT id FROM "Member"')).rows.length,
          0,
        );
        await owner.query("RESET ROLE");
        await owner.query('UPDATE "Member" SET archived=true WHERE id=$1', [
          saved[0].memberId,
        ]);
        await owner.query("SET LOCAL ROLE pailangz_app");
        assert.equal(
          (
            await owner.query(
              'SELECT code FROM "PublicEventPlayerName" WHERE code=$1',
              [saved[0].code],
            )
          ).rows.length,
          0,
        );
        await owner.query("RESET ROLE");
        await owner.query(
          "UPDATE \"Tournament\" SET status='ARCHIVED' WHERE id=$1",
          [tournament.id],
        );
        await owner.query("SET LOCAL ROLE pailangz_app");
        assert.equal(
          (await owner.query('SELECT * FROM "PublicEventPlayerName"')).rows
            .length,
          0,
        );
      } finally {
        await owner.query("ROLLBACK");
      }
    },
  );
  await check(
    "CSV ingestion is idempotent; status cannot grant staff",
    async () => {
      const rows = [
        {
          response_id: "stable-1",
          IGN: "Synthetic Integration Player",
          "Whatsapp Number": "PRIVATE_PHONE_CANARY",
          Country: "MY",
          status: "ADMIN",
        },
      ];
      const first = await ingest(actor, rows, "TEST");
      const second = await ingest(actor, rows, "TEST");
      assert.equal(first.created, 1);
      assert.equal(second.skipped, 1);
      submissionId = (
        await privateTx(actor, (tx) =>
          tx.registrationSubmission.findFirstOrThrow({
            where: { source: "TEST" },
          }),
        )
      ).id;
      assert.equal(
        (await owner.query('SELECT count(*)::int n FROM "StaffUser"')).rows[0]
          .n,
        2,
      );
    },
  );
  await check(
    "private data is ciphertext; raw canary absent from audits",
    async () => {
      const stored = (
        await owner.query(
          'SELECT "payloadEncrypted","phoneEncrypted" FROM "RegistrationSubmission" WHERE id=$1',
          [submissionId],
        )
      ).rows[0];
      assert.ok(!JSON.stringify(stored).includes("PRIVATE_PHONE_CANARY"));
      const audits = (
        await owner.query('SELECT changes,reason FROM "AuditEvent"')
      ).rows;
      assert.ok(!JSON.stringify(audits).includes("PRIVATE_PHONE_CANARY"));
    },
  );
  await check(
    "approval creates a member without staff or tournament eligibility",
    async () => {
      await decideRegistration(actor, {
        id: submissionId,
        action: "APPROVE",
        reason: "Synthetic verification",
      });
      const counts = (
        await owner.query(
          'SELECT (SELECT count(*) FROM "StaffUser")::int staff,(SELECT count(*) FROM "Participant")::int participants',
        )
      ).rows[0];
      assert.deepEqual(counts, { staff: 2, participants: 64 });
    },
  );
  await check(
    "concurrent Unicode duplicate approvals cannot create duplicate members",
    async () => {
      await ingest(
        actor,
        [
          { response_id: "duplicate-1", IGN: "Synthetic Straße" },
          { response_id: "duplicate-2", IGN: "Synthetic STRASSE" },
        ],
        "TEST",
      );
      const subs = await privateTx(actor, (tx) =>
        tx.registrationSubmission.findMany({
          where: { sourceResponseId: { in: ["duplicate-1", "duplicate-2"] } },
        }),
      );
      const results = await Promise.allSettled(
        subs.map((s) =>
          decideRegistration(actor, {
            id: s.id,
            action: "APPROVE",
            reason: "Race verification",
          }),
        ),
      );
      assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
      assert.equal(
        (
          await owner.query(
            'SELECT count(*)::int n FROM "Member" WHERE "canonicalIgn"=$1',
            ["synthetic strasse"],
          )
        ).rows[0].n,
        1,
      );
    },
  );
  await check(
    "anonymous or forged context cannot query private registration fields",
    async () => {
      await owner.query("BEGIN");
      try {
        await owner.query("SET LOCAL ROLE pailangz_app");
        await owner.query(
          "SELECT set_config('app.actor_id','forged',true),set_config('app.session_id','forged',true),set_config('app.role','ADMIN',true)",
        );
        const rows = await owner.query('SELECT * FROM "MemberPrivate"');
        assert.equal(rows.rowCount, 0);
        assert.equal(
          (await owner.query('SELECT * FROM "RegistrationSubmission"'))
            .rowCount,
          0,
        );
      } finally {
        await owner.query("ROLLBACK");
      }
    },
  );
  await check("database rejects direct role elevation", async () => {
    await owner.query("BEGIN");
    try {
      await owner.query("SET LOCAL ROLE pailangz_app");
      await assert.rejects(
        owner.query("UPDATE \"StaffUser\" SET role='ADMIN' WHERE id=$1", [
          moderatorId,
        ]),
      );
    } finally {
      await owner.query("ROLLBACK");
    }
  });
  await check("moderators cannot edit staff permissions", async () => {
    await assert.rejects(
      staffUpdate(mod, {
        id: adminId,
        role: "MODERATOR",
        suspended: false,
        reason: "Forbidden attempt",
      }),
    );
  });
  await check(
    "business mutations roll back with failed immutable audit writes",
    async () => {
      const before = (
        await owner.query('SELECT count(*)::int n FROM "Announcement"')
      ).rows[0].n;
      await assert.rejects(
        privateTx(actor, async (tx) => {
          await tx.announcement.create({
            data: { title: "Must roll back", body: "Synthetic rollback" },
          });
          const event = await tx.auditEvent.findFirstOrThrow();
          await tx.auditEvent.update({
            where: { id: event.id },
            data: { reason: "Attempted edit" },
          });
        }),
      );
      assert.equal(
        (await owner.query('SELECT count(*)::int n FROM "Announcement"'))
          .rows[0].n,
        before,
      );
    },
  );
  await check(
    "audit edits / deletion fail even through owner connection",
    async () => {
      await assert.rejects(
        owner.query("UPDATE \"AuditEvent\" SET reason='altered'"),
      );
      await assert.rejects(owner.query('DELETE FROM "AuditEvent"'));
    },
  );
  await check("incomplete readiness blocks publication", async () => {
    await assert.rejects(
      publishTournament(actor, {
        id: tournament.id,
        published: true,
        reason: "Incomplete readiness",
      }),
    );
  });
  await confirmRules(actor, {
    stageId: league.id,
    rules: {
      seriesPoints: true,
      drawPolicy: "no_draws",
      tiebreakers: ["differential"],
    },
    confirmedRules: ["seriesPoints", "drawPolicy", "tiebreakers"],
    reason: "Synthetic scoring test only",
  });
  const match = (
    await owner.query(
      'SELECT m.* FROM "Match" m JOIN "Round" r ON r.id=m."roundId" WHERE r."stageId"=$1 ORDER BY r.number,m."order" LIMIT 1',
      [league.id],
    )
  ).rows[0];
  let resultId = "";
  await check(
    "result submission and acceptance are idempotent and series-scored",
    async () => {
      const key = randomUUID(),
        input = {
          matchId: match.id,
          idempotencyKey: key,
          outcome: "A_WIN",
          games: [
            { scoreA: 3, scoreB: 1 },
            { scoreA: 4, scoreB: 2 },
          ],
          reason: "Synthetic result",
        };
      const result = await submitResult(actor, input);
      resultId = result.id;
      assert.equal((await submitResult(actor, input)).id, result.id);
      await privateTx(actor, async (tx) => {
        await tx.evidence.create({
          data: {
            resultId: result.id,
            storageKey: randomUUID(),
            mime: "image/png",
            size: 8,
            uploadedBy: actor.id,
          },
        });
      });
      await reviewResult(actor, {
        id: result.id,
        action: "ACCEPT",
        reason: "Evidence checked",
      });
      await reviewResult(actor, {
        id: result.id,
        action: "ACCEPT",
        reason: "Repeated request",
      });
      const rows = (await privateTx(actor, (tx) => standingsFor(tx, league.id)))
        .rows;
      assert.equal(rows.find((r) => r.id === match.sideAId)?.points, 3);
      assert.equal(rows.find((r) => r.id === match.sideAId)?.played, 1);
    },
  );
  let dependencyId = "";
  await check(
    "corrections retain versions and mark snapshots / downstream matches stale",
    async () => {
      const snapshot = await privateTx(actor, async (tx) => {
        const snap = await tx.rankingSnapshot.create({
          data: {
            stageId: league.id,
            version: 1,
            rankings: [],
            frozenBy: actor.id,
          },
        });
        const next = await tx.match.findFirstOrThrow({
          where: { id: { not: match.id } },
        });
        const dep = await tx.bracketDependency.create({
          data: { snapshotId: snap.id, matchId: next.id },
        });
        dependencyId = dep.id;
        return snap;
      });
      const correction = await submitResult(actor, {
        matchId: match.id,
        idempotencyKey: randomUUID(),
        outcome: "B_WIN",
        games: [
          { scoreA: 1, scoreB: 3 },
          { scoreA: 2, scoreB: 4 },
        ],
        reason: "Corrected synthetic evidence",
      });
      await privateTx(actor, (tx) =>
        tx.evidence.create({
          data: {
            resultId: correction.id,
            storageKey: randomUUID(),
            mime: "image/png",
            size: 8,
            uploadedBy: actor.id,
          },
        }),
      );
      await reviewResult(actor, {
        id: correction.id,
        action: "ACCEPT",
        reason: "Correction verified",
      });
      const state = await privateTx(actor, async (tx) => ({
        snapshot: await tx.rankingSnapshot.findUniqueOrThrow({
          where: { id: snapshot.id },
        }),
        dep: await tx.bracketDependency.findUniqueOrThrow({
          where: { id: dependencyId },
        }),
        versions: await tx.resultVersion.count({
          where: { matchId: match.id },
        }),
        rows: (await standingsFor(tx, league.id)).rows,
      }));
      assert.equal(state.snapshot.stale, true);
      assert.equal(state.dep.stale, true);
      assert.equal(state.versions, 2);
      assert.equal(state.rows.find((r) => r.id === match.sideAId)?.points, 0);
      assert.equal(state.rows.find((r) => r.id === match.sideBId)?.points, 3);
    },
  );
  await check(
    "started downstream matches cannot have opponents silently replaced",
    async () => {
      await owner.query(
        'UPDATE "Match" SET status=\'IN_PROGRESS\' WHERE id=(SELECT "matchId" FROM "BracketDependency" WHERE id=$1)',
        [dependencyId],
      );
      await assert.rejects(
        resolveDependency(actor, {
          id: dependencyId,
          sideAId: match.sideBId,
          reason: "Unsafe replacement",
        }),
      );
    },
  );
  await check(
    "team roster membership is unique and limited to four",
    async () => {
      const ids = (
        await owner.query('SELECT id FROM "Member" LIMIT 5')
      ).rows.map((r) => r.id);
      await owner.query(
        'UPDATE "Member" SET verified=true WHERE id=ANY($1::text[])',
        [ids],
      );
      const category = (
        await owner.query(
          "SELECT id FROM \"Category\" WHERE kind='TEAM' LIMIT 1",
        )
      ).rows[0];
      await teamUpdate(actor, {
        categoryId: category.id,
        name: "Synthetic team one",
        memberIds: ids.slice(0, 4),
        reason: "Roster constraint test",
      });
      await assert.rejects(
        teamUpdate(actor, {
          categoryId: category.id,
          name: "Synthetic team two",
          memberIds: [ids[0]],
          reason: "Duplicate roster test",
        }),
      );
      await assert.rejects(
        teamUpdate(actor, {
          categoryId: category.id,
          name: "Synthetic oversized team",
          memberIds: ids,
          reason: "Roster size test",
        }),
      );
    },
  );
  await check(
    "seed rerun preserves accepted results and confirmed rules",
    async () => {
      await seed();
      assert.equal(
        (
          await owner.query(
            'SELECT count(*)::int n FROM "ResultVersion" WHERE "matchId"=$1',
            [match.id],
          )
        ).rows[0].n,
        2,
      );
      assert.equal(
        (
          await owner.query('SELECT "ruleVersion" FROM "Stage" WHERE id=$1', [
            league.id,
          ])
        ).rows[0].ruleVersion,
        2,
      );
    },
  );
  await check(
    "team codes survive renames and archives and are allocated without reusing old codes",
    async () => {
      await owner.query("BEGIN");
      try {
        const category = (
          await owner.query(
            'SELECT id FROM "Category" WHERE "tournamentId"=$1 AND kind=\'TEAM\'',
            [tournament.id],
          )
        ).rows[0];
        const max = (
          await owner.query(
            'SELECT coalesce(max(substring(code FROM 2)::integer),0)::int n FROM "Team" WHERE "categoryId"=$1',
            [category.id],
          )
        ).rows[0].n;
        const create = async (name: string) =>
          (
            await owner.query(
              'INSERT INTO "Team"(id,"categoryId",name) VALUES($1,$2,$3) RETURNING id,code',
              [randomUUID(), category.id, name],
            )
          ).rows[0];
        const first = await create("Public team name");
        assert.equal(first.code, `T${String(max + 1).padStart(2, "0")}`);
        await owner.query(
          'UPDATE "Team" SET name=$1,archived=true WHERE id=$2',
          ["Renamed public team", first.id],
        );
        const second = await create("Another public team");
        assert.equal(second.code, `T${String(max + 2).padStart(2, "0")}`);
        assert.equal(
          (await owner.query('SELECT code FROM "Team" WHERE id=$1', [first.id]))
            .rows[0].code,
          first.code,
        );
        const preview = (
          await owner.query('SELECT data FROM "PublicEventPreview"')
        ).rows[0].data;
        const publicTeam = preview.categories
          .find((c: { kind: string }) => c.kind === "TEAM")
          .teams.find((team: { code: string }) => team.code === second.code);
        assert.equal(publicTeam.name, "Another public team");
        assert.equal(publicTeam.playerCount, 0);
        await assert.rejects(
          owner.query("UPDATE \"Team\" SET code='T99' WHERE id=$1", [
            second.id,
          ]),
          /permanent/,
        );
      } finally {
        await owner.query("ROLLBACK");
      }
    },
  );
  await check("empty qualification rankings cannot be finalized", async () => {
    const q = (
      await owner.query(
        "SELECT id FROM \"Stage\" WHERE key='qualification' LIMIT 1",
      )
    ).rows[0];
    await assert.rejects(
      freezeRankings(actor, {
        stageId: q.id,
        rankedIds: [],
        reason: "Reject missing stage entrants",
      }),
    );
  });
  await check(
    "accepted result disputes remove points until an audited resolution",
    async () => {
      const m = (
        await owner.query('SELECT "currentResultId" FROM "Match" WHERE id=$1', [
          match.id,
        ])
      ).rows[0];
      await reviewResult(actor, {
        id: m.currentResultId,
        action: "DISPUTE",
        reason: "Synthetic score verification dispute",
      });
      const before = await privateTx(actor, (tx) =>
        standingsFor(tx, league.id),
      );
      assert.equal(before.rows.find((r) => r.id === match.sideAId)!.played, 0);
      const dispute = (
        await owner.query(
          'SELECT id FROM "Dispute" WHERE "matchId"=$1 AND resolved=false',
          [match.id],
        )
      ).rows[0];
      await resolveDispute(actor, {
        id: dispute.id,
        uphold: true,
        reason: "Synthetic evidence checked and result upheld",
      });
      const after = await privateTx(actor, (tx) => standingsFor(tx, league.id));
      assert.equal(after.rows.find((r) => r.id === match.sideAId)!.played, 1);
      await assert.rejects(
        resolveDispute(actor, {
          id: dispute.id,
          uphold: true,
          reason: "No repeat resolution",
        }),
      );
    },
  );
  const { checkConfigurations } = await import("./configuration-integration");
  await checkConfigurations(
    owner,
    actor,
    mod,
    check,
    tournament.id,
    match.id,
    seed,
  );
  const { runStaffAccountIntegration } =
    await import("./staff-accounts-integration");
  await runStaffAccountIntegration(owner, actor, mod, check);
  const { checkRoutineStaffOperations } =
    await import("./staff-ops-integration");
  await checkRoutineStaffOperations(owner, actor, mod, check);
  const { checkWebRegistration } = await import("./registration-integration");
  await checkWebRegistration(owner, actor, check);
  const { checkModeratorSetup } = await import("./moderator-setup-integration");
  await checkModeratorSetup(owner, mod, check);
  const { checkParticipation } = await import("./participation-integration");
  await checkParticipation(owner, actor, check);
  const { checkTeamPortal } = await import("./team-portal-integration");
  await checkTeamPortal(owner, check);
  await check(
    "suspension and demotion revoke current private-data access",
    async () => {
      await staffUpdate(actor, {
        id: moderatorId,
        role: "MODERATOR",
        suspended: true,
        reason: "Immediate revocation test",
      });
      await assert.rejects(privateTx(mod, (tx) => tx.memberPrivate.findMany()));
      await owner.query(
        "UPDATE \"StaffUser\" SET suspended=false,role='MODERATOR' WHERE id=$1",
        [moderatorId],
      );
      await assert.rejects(privateTx(mod, (tx) => tx.memberPrivate.findMany()));
    },
  );
  await check(
    "preview environment cannot connect to this development database",
    async () => {
      process.env.APP_ENV = "preview";
      const row = (
        await owner.query('SELECT tier FROM "DeploymentEnvironment"')
      ).rows[0];
      assert.notEqual(row.tier, process.env.APP_ENV);
      await assert.rejects(ensureRuntime());
      process.env.APP_ENV = "development";
    },
  );
  await db.$disconnect();
  console.log(
    `${passed} integration checks passed on ${native ? "native PostgreSQL (concurrent connections)" : "PGlite (serialized development connections)"}.`,
  );
} finally {
  await owner.end();
  if (native)
    execFileSync(
      path.join(native, "pg_ctl"),
      ["-D", directory, "-m", "fast", "-w", "stop"],
      { stdio: "ignore" },
    );
  else {
    await socket?.stop();
    await wasm?.close();
  }
  await rm(directory, { recursive: true, force: true });
}
