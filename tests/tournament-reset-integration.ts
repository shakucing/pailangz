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
  const { newTournamentConfiguration, generateLeague, validateLeague } =
    await import("../src/lib/tournament-config");
  await seed({ legacyFixtures: true });
  const tournament = await owner.tournament.findUniqueOrThrow({
    where: { slug: "pailangz-solo-team" },
  });
  const members = await owner.member.findMany({ orderBy: { id: "asc" } });
  await owner.participationRequest.create({
    data: { tournamentId: tournament.id, memberId: members[0].id },
  });
  const requests = await owner.participationRequest.findMany();
  const beforeAuditCount = await owner.auditEvent.count();
  const noBackup = async () => {
    throw new Error("Backup should not run");
  };
  const preview = await resetOfficialTournament(owner, false, noBackup);
  assert.equal(preview.fixtures, 192);
  assert.equal(preview.players, 64);
  assert.equal(await owner.match.count(), 192);
  await assert.rejects(
    resetOfficialTournament(owner, true, async () => {
      throw new Error("Backup unavailable");
    }),
    /Backup unavailable/,
  );
  assert.equal(await owner.match.count(), 192);
  assert.equal(await owner.participant.count(), 64);
  await owner.tournament.update({
    where: { id: tournament.id },
    data: { published: true },
  });
  await assert.rejects(
    resetOfficialTournament(owner, true, noBackup),
    /unplayed event/,
  );
  await owner.tournament.update({
    where: { id: tournament.id },
    data: { published: false },
  });
  let saved: unknown;
  const result = await resetOfficialTournament(
    owner,
    true,
    async (snapshot) => {
      saved = snapshot;
    },
  );
  assert.ok(saved);
  assert.equal(result.applied, true);
  assert.equal(result.applicationsRetained, 1);
  assert.deepEqual(
    await owner.member.findMany({ orderBy: { id: "asc" } }),
    members,
  );
  assert.deepEqual(await owner.participationRequest.findMany(), requests);
  assert.equal(await owner.participant.count(), 0);
  assert.equal(await owner.match.count(), 0);
  assert.equal(await owner.round.count(), 0);
  assert.equal(await owner.stage.count(), 4);
  assert.equal(await owner.auditEvent.count(), beforeAuditCount + 1);
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
    (await resetOfficialTournament(owner, true, noBackup)).applied,
    false,
  );
  await seed();
  assert.equal(await owner.match.count(), 0);
  assert.equal(await owner.participant.count(), 0);
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
  assert.deepEqual(fresh.configuration, newTournamentConfiguration);
  assert.equal(fresh.participants.length, 0);
  assert.equal(await owner.match.count(), 0);
  console.log(
    "PASS tournament reset: backup/rollback, protected play, preserved members/applications, 32-player formula, seed rerun and fresh seed.",
  );
} finally {
  await owner.$disconnect();
  await socket.stop();
  await wasm.close();
}
