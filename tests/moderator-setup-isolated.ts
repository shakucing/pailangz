import { randomBytes, randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { createServer } from "node:net";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import pg from "pg";

// Synthetic database only: never read working database credentials or records.
const probe = createServer();
await new Promise<void>((resolve, reject) => {
  probe.once("error", reject);
  probe.listen(0, "127.0.0.1", resolve);
});
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
Object.assign(process.env, {
  APP_ENV: "development",
  DATABASE_ENV: "development",
  LOCAL_PGLITE: "true",
  VERCEL_ENV: "",
  VERCEL: "",
  DATABASE_URL: `postgresql://postgres@127.0.0.1:${port}/postgres?sslmode=disable`,
  DATA_ENCRYPTION_KEYS: JSON.stringify({
    test: randomBytes(32).toString("base64"),
  }),
  ACTIVE_ENCRYPTION_KEY: "test",
});
const owner = new pg.Client({ connectionString: process.env.DATABASE_URL });
await owner.connect();
try {
  await wasm.exec("SET TIME ZONE 'UTC'");
  for (const name of (await readdir("prisma/migrations"))
    .filter((n) => /^\d/.test(n))
    .sort())
    await wasm.exec(
      await readFile(`prisma/migrations/${name}/migration.sql`, "utf8"),
    );
  const id = randomUUID(),
    sessionId = randomUUID();
  await owner.query(
    "INSERT INTO \"StaffUser\" (id,email,name,\"passwordHash\",role) VALUES ($1,$2,'Test moderator','not-a-login-password','MODERATOR')",
    [id, `${id}@synthetic.invalid`],
  );
  await owner.query(
    'INSERT INTO "StaffSession" (id,"userId","expiresAt") VALUES ($1,$2,now()+interval \'1 hour\')',
    [sessionId, id],
  );
  const { checkModeratorSetup } = await import("./moderator-setup-integration");
  const { checkTeamRosterRegistration } =
    await import("./team-roster-integration");
  let passed = 0;
  await checkModeratorSetup(
    owner,
    { id, sessionId, role: "MODERATOR", authenticatedAt: new Date() },
    async (name, fn) => {
      await fn();
      passed++;
      console.log(`PASS ${name}`);
    },
  );
  await checkTeamRosterRegistration(
    owner,
    { id, sessionId, role: "MODERATOR", authenticatedAt: new Date() },
    async (name, fn) => {
      await fn();
      passed++;
      console.log(`PASS ${name}`);
    },
  );
  console.log(`${passed} moderator setup and team roster checks passed.`);
  if (process.env.TEST_REGISTRATION_REGRESSIONS === "true") {
    const { saveTournament } = await import("../src/lib/competition");
    const { newTournamentConfiguration } =
      await import("../src/lib/tournament-config");
    const actor = {
      id,
      sessionId,
      role: "MODERATOR" as const,
      authenticatedAt: new Date(),
    };
    const original = await saveTournament(actor, {
      name: "Original synthetic event",
      slug: "pailangz-solo-team",
      overview: "Test",
      status: "DRAFT",
      configuration: newTournamentConfiguration,
    });
    await owner.query(
      "INSERT INTO \"IntegrationSetting\" (key,value) VALUES ('officialSeedTournament',$1)",
      [JSON.stringify(original.id)],
    );
    const check = async (name: string, fn: () => Promise<void>) => {
      await fn();
      passed++;
      console.log(`PASS ${name}`);
    };
    const { checkParticipation } = await import("./participation-integration");
    await checkParticipation(owner, actor, check);
    const { checkTeamPortal } = await import("./team-portal-integration");
    await checkTeamPortal(owner, check);
    console.log(
      `${passed} moderator and registration regression checks passed.`,
    );
  }
} finally {
  const { db } = await import("../src/lib/db");
  await db.$disconnect();
  await owner.end();
  await socket.stop();
  await wasm.close();
}
