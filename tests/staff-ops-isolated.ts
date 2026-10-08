import { randomBytes, randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { createServer } from "node:net";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import pg from "pg";
import { checkRoutineStaffOperations } from "./staff-ops-integration";
import type { Actor } from "../src/lib/db";

// All credentials and records belong to a disposable in-memory database.
const wasm = await PGlite.create();
const probe = createServer();
await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
const port = (probe.address() as { port: number }).port;
await new Promise<void>((resolve) => probe.close(() => resolve()));
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
  VERCEL: "",
  VERCEL_ENV: "",
  DATABASE_URL: `postgresql://postgres@127.0.0.1:${port}/postgres?sslmode=disable`,
  DATA_ENCRYPTION_KEYS: JSON.stringify({
    test: randomBytes(32).toString("base64"),
  }),
  ACTIVE_ENCRYPTION_KEY: "test",
  PHONE_DEFAULT_COUNTRY: "MY",
});
const owner = new pg.Client({ connectionString: process.env.DATABASE_URL });
try {
  await owner.connect();
  await wasm.exec("SET TIME ZONE 'UTC'");
  for (const name of (await readdir("prisma/migrations"))
    .filter((n) => /^\d/.test(n))
    .sort())
    await wasm.exec(
      await readFile(`prisma/migrations/${name}/migration.sql`, "utf8"),
    );
  await owner.query(
    'INSERT INTO "IntegrationSetting" (key,value) VALUES ($1,$2)',
    [
      "formMapping",
      { ign: "IGN", phone: "Whatsapp Number", country: "Country" },
    ],
  );
  const actors: Actor[] = [];
  for (const role of ["ADMIN", "MODERATOR"] as const) {
    const id = randomUUID(),
      sessionId = randomUUID();
    await owner.query(
      'INSERT INTO "StaffUser" (id,email,name,"passwordHash",role) VALUES ($1,$2,$3,$4,$5)',
      [
        id,
        `${id}@synthetic.invalid`,
        "Test staff",
        "not-a-login-password",
        role,
      ],
    );
    await owner.query(
      'INSERT INTO "StaffSession" (id,"userId","expiresAt") VALUES ($1,$2,now()+interval \'1 hour\')',
      [sessionId, id],
    );
    actors.push({ id, sessionId, role, authenticatedAt: new Date() });
  }
  let passed = 0;
  await checkRoutineStaffOperations(
    owner,
    actors[0],
    actors[1],
    async (name, fn) => {
      await fn();
      passed++;
      console.log(`PASS ${name}`);
    },
  );
  console.log(`${passed} isolated staff operation checks passed.`);
} finally {
  const { db } = await import("../src/lib/db");
  await db.$disconnect();
  await owner.end();
  await socket.stop();
  await wasm.close();
}
