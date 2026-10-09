import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { createServer } from "node:net";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

const probe = createServer();
await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
const port = (probe.address() as { port: number }).port;
await new Promise<void>((resolve) => probe.close(() => resolve()));
const wasm = await PGlite.create();
const socket = new PGLiteSocketServer({
  db: wasm,
  host: "127.0.0.1",
  port,
  maxConnections: 20,
});
await socket.start();
const url = `postgresql://postgres@127.0.0.1:${port}/postgres?sslmode=disable`;
Object.assign(process.env, {
  APP_ENV: "development",
  DATABASE_ENV: "development",
  LOCAL_PGLITE: "true",
  DATABASE_URL: url,
  MIGRATION_DATABASE_URL: url,
  VERCEL_ENV: "",
  VERCEL: "",
  DATA_ENCRYPTION_KEYS: JSON.stringify({
    test: randomBytes(32).toString("base64"),
  }),
  ACTIVE_ENCRYPTION_KEY: "test",
});
const owner = new PrismaClient({
  adapter: new PrismaPg({ connectionString: url, max: 1 }),
});
try {
  for (const name of (await readdir("prisma/migrations"))
    .filter((n) => /^\d/.test(n))
    .sort())
    await wasm.exec(
      await readFile(`prisma/migrations/${name}/migration.sql`, "utf8"),
    );
  const { seed } = await import("../prisma/seed");
  const { resetOfficialTournament } =
    await import("../scripts/reset-official-tournament");
  const { emptyTournamentUpgrade } =
    await import("../scripts/neon-data-upgrade");
  const { encrypt, decrypt } = await import("../src/lib/crypto");
  const once = { upgradeId: emptyTournamentUpgrade, production: true };
  const {
    newTournamentConfiguration: soloDefaults,
    generateLeague,
    validateLeague,
  } = await import("../src/lib/tournament-config");
  const { format: _format, ...newTournamentConfiguration } = soloDefaults;
  await seed({ legacyFixtures: true });
  const tournament = await owner.tournament.findUniqueOrThrow({
    where: { slug: "pailangz-solo-team" },
  });
  const firstMember = await owner.member.findFirstOrThrow();
  await owner.member.update({
    where: { id: firstMember.id },
    data: { verified: true },
  });
  const members = await owner.member.findMany({ orderBy: { id: "asc" } });
  await owner.memberPrivate.create({
    data: {
      memberId: firstMember.id,
      originalIgn: firstMember.displayIgn,
      registrationEncrypted: encrypt(
        "private registration retained",
        `member:${firstMember.id}`,
      ),
    },
  });
  const privateMembers = await owner.memberPrivate.findMany();
  const teamCategory = await owner.category.findUniqueOrThrow({
    where: {
      tournamentId_kind: { tournamentId: tournament.id, kind: "TEAM" },
    },
  });
  const oldTeam = await owner.team.create({
    data: { categoryId: teamCategory.id, name: "Old team" },
  });
  await owner.teamMembership.create({
    data: {
      teamId: oldTeam.id,
      categoryId: teamCategory.id,
      memberId: firstMember.id,
    },
  });
  const teamApplication = await owner.teamApplication.create({
    data: {
      teamId: oldTeam.id,
      memberId: firstMember.id,
    },
  });
  await owner.participationRequest.create({
    data: { tournamentId: tournament.id, memberId: members[0].id },
  });
  const requests = await owner.participationRequest.findMany();
  const beforeAuditCount = await owner.auditEvent.count();
  const noBackup = async () => {
    throw new Error("Backup should not run");
  };
  const markerCount = () =>
    owner.auditEvent.count({
      where: {
        action: "TOURNAMENT_APPLICATION_RESET",
        changes: { path: ["upgradeId"], equals: emptyTournamentUpgrade },
      },
    });
  await assert.rejects(
    resetOfficialTournament(owner, true, noBackup, once),
    /production table owner/,
  );
  await owner.$executeRaw`UPDATE "DeploymentEnvironment" SET tier='production'`;
  const preview = await resetOfficialTournament(owner, false, noBackup);
  assert.equal(preview.fixtures, 192);
  assert.equal(preview.players, 64);
  assert.equal(preview.teams, 1);
  assert.equal(await owner.match.count(), 192);
  await assert.rejects(
    resetOfficialTournament(
      owner,
      true,
      async () => {
        throw new Error("Backup unavailable");
      },
      once,
    ),
    /Backup unavailable/,
  );
  assert.equal(await owner.match.count(), 192);
  assert.equal(await owner.participant.count(), 64);
  assert.equal(await markerCount(), 0);
  const keys = process.env.DATA_ENCRYPTION_KEYS;
  process.env.DATA_ENCRYPTION_KEYS = JSON.stringify({
    test: randomBytes(32).toString("base64"),
  });
  await assert.rejects(resetOfficialTournament(owner, true, noBackup, once));
  process.env.DATA_ENCRYPTION_KEYS = keys;
  assert.equal(await owner.match.count(), 192);
  assert.equal(await markerCount(), 0);
  await owner.tournament.update({
    where: { id: tournament.id },
    data: { published: true },
  });
  await assert.rejects(
    resetOfficialTournament(owner, true, noBackup, once),
    /unplayed event/,
  );
  await owner.tournament.update({
    where: { id: tournament.id },
    data: { published: false },
  });
  const firstMatch = await owner.match.findFirstOrThrow();
  await owner.match.update({
    where: { id: firstMatch.id },
    data: { status: "IN_PROGRESS" },
  });
  await assert.rejects(
    resetOfficialTournament(owner, true, noBackup, once),
    /unplayed event/,
  );
  await owner.match.update({
    where: { id: firstMatch.id },
    data: { status: "SCHEDULED" },
  });
  await owner.$executeRawUnsafe(`CREATE FUNCTION reject_reset_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF NEW.action='TOURNAMENT_APPLICATION_RESET' THEN RAISE EXCEPTION 'Audit unavailable'; END IF;
    RETURN NEW; END $$`);
  await owner.$executeRawUnsafe(
    `CREATE TRIGGER reject_reset_audit BEFORE INSERT ON "AuditEvent" FOR EACH ROW EXECUTE FUNCTION reject_reset_audit()`,
  );
  await assert.rejects(
    resetOfficialTournament(owner, true, async () => {}, once),
  );
  assert.equal(await owner.participant.count(), 64);
  assert.equal(await owner.match.count(), 192);
  assert.equal(await owner.configurationRevision.count(), 0);
  assert.equal(await markerCount(), 0);
  await owner.$executeRawUnsafe(
    'DROP TRIGGER reject_reset_audit ON "AuditEvent"',
  );
  await owner.$executeRawUnsafe("DROP FUNCTION reject_reset_audit()");
  let saved: unknown;
  const result = await resetOfficialTournament(
    owner,
    true,
    async (snapshot) => {
      saved = snapshot;
    },
    once,
  );
  assert.ok(saved);
  assert.equal(result.applied, true);
  assert.equal(result.applicationsRetained, 1);
  assert.deepEqual(
    await owner.member.findMany({ orderBy: { id: "asc" } }),
    members,
  );
  assert.deepEqual(await owner.participationRequest.findMany(), requests);
  assert.deepEqual(await owner.memberPrivate.findMany(), privateMembers);
  assert.deepEqual(
    await owner.teamApplication.findUnique({
      where: { id: teamApplication.id },
    }),
    teamApplication,
  );
  assert.equal(
    (await owner.team.findUniqueOrThrow({ where: { id: oldTeam.id } }))
      .archived,
    true,
  );
  assert.equal(
    await owner.teamMembership.count({ where: { active: true } }),
    0,
  );
  assert.equal(await owner.participant.count(), 0);
  assert.equal(await owner.match.count(), 0);
  assert.equal(await owner.round.count(), 0);
  assert.equal(await owner.stage.count(), 4);
  assert.equal(await owner.auditEvent.count(), beforeAuditCount + 1);
  assert.equal(await markerCount(), 1);
  const appliedRevision = await owner.configurationRevision.findFirstOrThrow();
  assert.match(
    decrypt(appliedRevision.reasonEncrypted, `tournament:${tournament.id}`),
    /32 player/,
  );
  assert.match(
    decrypt(
      appliedRevision.resolutionEncrypted!,
      `revision:${appliedRevision.id}`,
    ),
    /32 player/,
  );
  assert.deepEqual(
    (await owner.tournament.findUniqueOrThrow({ where: { id: tournament.id } }))
      .configuration,
    newTournamentConfiguration,
  );
  assert.deepEqual(
    (await owner.category.findMany({ orderBy: { kind: "asc" } })).map(
      (c) => c.capacity,
    ),
    [32, 8],
  );
  assert.equal(
    (await resetOfficialTournament(owner, true, noBackup, once)).applied,
    false,
  );
  await seed();
  assert.equal(await owner.match.count(), 0);
  assert.equal(await owner.participant.count(), 0);
  // Subsequent migrations must not erase entrants or teams added after the reset,
  // even after publication or competition start would otherwise block a reset.
  const joined = await owner.participant.create({
    data: {
      tournamentId: tournament.id,
      memberId: firstMember.id,
      code: "P01",
      eligible: true,
      provisional: false,
    },
  });
  const newTeam = await owner.team.create({
    data: { categoryId: teamCategory.id, name: "New team" },
  });
  const newStage = await owner.stage.findFirstOrThrow({
    where: { key: "league" },
  });
  const newRound = await owner.round.create({
    data: { stageId: newStage.id, number: 1, name: "New round" },
  });
  const newMatch = await owner.match.create({
    data: {
      roundId: newRound.id,
      order: 1,
      sideAId: joined.id,
      bestOf: 3,
      status: "IN_PROGRESS",
    },
  });
  await owner.tournament.update({
    where: { id: tournament.id },
    data: { published: true },
  });
  assert.equal(
    (await resetOfficialTournament(owner, true, noBackup, once)).applied,
    false,
  );
  assert.equal(await markerCount(), 1);
  assert.equal(await owner.participant.count(), 1);
  assert.equal(await owner.team.count({ where: { archived: false } }), 1);
  assert.equal(await owner.match.count(), 1);
  await owner.tournament.update({
    where: { id: tournament.id },
    data: { published: false },
  });
  await owner.match.delete({ where: { id: newMatch.id } });
  await owner.round.delete({ where: { id: newRound.id } });
  await owner.participant.delete({ where: { id: joined.id } });
  await owner.team.update({
    where: { id: newTeam.id },
    data: { archived: true },
  });
  const ids = Array.from({ length: 32 }, (_, i) => `P${i + 1}`);
  assert.deepEqual(
    validateLeague(
      ids,
      generateLeague(ids, newTournamentConfiguration),
      newTournamentConfiguration,
    ),
    { matches: 96, rounds: 6, byes: 0 },
  );
  // Fresh installs also start with the 32-player formula and no prefilled roster.
  await owner.integrationSetting.delete({
    where: { key: "officialSeedTournament" },
  });
  await owner.tournament.update({
    where: { id: tournament.id },
    data: { slug: "reset-history" },
  });
  await seed();
  const fresh = await owner.tournament.findUniqueOrThrow({
    where: { slug: "pailangz-solo-team" },
    include: { participants: true },
  });
  assert.deepEqual(fresh.configuration, soloDefaults);
  assert.equal(fresh.participants.length, 0);
  assert.equal(await owner.match.count(), 0);
  const emptyOnce = { upgradeId: "test_already_empty_32", production: true };
  assert.equal(
    (await resetOfficialTournament(owner, true, noBackup, emptyOnce)).applied,
    false,
  );
  await owner.participant.create({
    data: { tournamentId: fresh.id, memberId: firstMember.id, code: "P01" },
  });
  assert.equal(
    (await resetOfficialTournament(owner, true, noBackup, emptyOnce)).applied,
    false,
  );
  assert.equal(
    await owner.participant.count({ where: { tournamentId: fresh.id } }),
    1,
  );
  console.log(
    "PASS tournament reset: production/key checks, backup/audit rollback, protected play, preserved members/applications, team archival, encrypted revisions, one-time completion, later-entry preservation, 32-player formula and seed reruns.",
  );
} finally {
  await owner.$disconnect();
  await socket.stop();
  await wasm.close();
}
