import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { createServer } from "node:net";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import pg from "pg";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";

// Never load .env here: every database URL and test secret is generated below.
await readFile(".next/BUILD_ID").catch(() => {
  throw new Error("Run pnpm build before the isolated HTTP checks.");
});
async function freePort() {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const port = (probe.address() as { port: number }).port;
  await new Promise<void>((resolve, reject) =>
    probe.close((e) => (e ? reject(e) : resolve())),
  );
  return port;
}
function run(
  script: string,
  env: NodeJS.ProcessEnv,
  args: string[] = [],
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--import", "tsx", script, ...args],
      {
        env,
        stdio: "inherit",
      },
    );
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0
        ? resolve()
        : reject(new Error("Isolated HTTP check process failed.")),
    );
  });
}
const directory = await mkdtemp(path.join(tmpdir(), "pailangz-web-test-"));
const native = process.env.TEST_PG_BIN_DIR;
const port = await freePort(),
  webPort = await freePort();
const runtimePassword = randomBytes(24).toString("hex");
const ownerUrl = `postgresql://postgres@127.0.0.1:${port}/postgres?sslmode=disable`;
let wasm: PGlite | undefined, socket: PGLiteSocketServer | undefined;
let owner: pg.Client | undefined, web: ChildProcess | undefined;
let nativeStarted = false;
try {
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
        path.join(directory, "postgres.log"),
        "-o",
        `-h 127.0.0.1 -p ${port} -k ${directory}`,
        "-w",
        "start",
      ],
      { stdio: "ignore" },
    );
    nativeStarted = true;
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
  owner = new pg.Client({ connectionString: ownerUrl });
  await owner.connect();
  for (const name of (await readdir("prisma/migrations"))
    .filter((n) => /^\d/.test(n))
    .sort())
    await owner.query(
      await readFile(`prisma/migrations/${name}/migration.sql`, "utf8"),
    );
  await owner.query(
    `ALTER ROLE pailangz_app LOGIN PASSWORD '${runtimePassword}'`,
  );
  const origin = `http://127.0.0.1:${webPort}`;
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    APP_ENV: "development",
    DATABASE_ENV: "development",
    NODE_ENV: "production",
    VERCEL: undefined,
    VERCEL_ENV: "",
    LOCAL_PGLITE: native ? "false" : "true",
    DATABASE_URL: native
      ? `postgresql://pailangz_app:${runtimePassword}@127.0.0.1:${port}/postgres?sslmode=disable`
      : ownerUrl,
    MIGRATION_DATABASE_URL: ownerUrl,
    NEXTAUTH_URL: origin,
    NEXTAUTH_SECRET: randomBytes(32).toString("base64url"),
    DATA_ENCRYPTION_KEYS: JSON.stringify({
      test: randomBytes(32).toString("base64"),
    }),
    ACTIVE_ENCRYPTION_KEY: "test",
    PHONE_DEFAULT_COUNTRY: "MY",
    EVIDENCE_STORAGE: "local",
    EVIDENCE_LOCAL_DIR: path.join(directory, "evidence"),
    REGISTRATION_WEBHOOK_SECRET: "",
    PAILANGZ_ISOLATED_WEB_TEST: "true",
  };
  // Empty markers override any developer .env rather than selecting cloud mode.
  Object.assign(env, { VERCEL: "", VERCEL_ENV: "" });
  // Seed in its own process as the synthetic database owner, never runtime.
  await run(
    "prisma/seed.ts",
    {
      ...env,
      DATABASE_URL: ownerUrl,
      LOCAL_PGLITE: "true",
    },
    ["--legacy-test-fixtures"],
  );
  web = spawn(
    process.execPath,
    [
      "node_modules/next/dist/bin/next",
      "start",
      "--hostname",
      "127.0.0.1",
      "--port",
      String(webPort),
    ],
    { env, stdio: "inherit" },
  );
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (web.exitCode !== null)
      throw new Error("Isolated test server stopped before becoming ready.");
    try {
      ready = (
        await fetch(`${origin}/api/auth/csrf`, {
          signal: AbortSignal.timeout(1000),
        })
      ).ok;
    } catch {
      /* next start is still starting */
    }
    if (ready) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!ready) throw new Error("Isolated test server did not become ready.");
  await run(
    process.argv.includes("--team-rosters")
      ? "tests/web-team-rosters.ts"
      : process.argv.includes("--landing-highlights")
        ? "tests/web-landing-highlights.ts"
        : process.argv.includes("--announcements")
          ? "tests/web-announcements.ts"
          : process.argv.includes("--tournament-formats")
            ? "tests/web-tournament-formats.ts"
            : process.argv.includes("--readiness-dialogs")
              ? "tests/web-readiness-dialogs.ts"
              : "tests/web-smoke.ts",
    env,
  );
} finally {
  if (web && web.exitCode === null) {
    const exited = new Promise<void>((resolve) =>
      web!.once("exit", () => resolve()),
    );
    web.kill("SIGTERM");
    await Promise.race([
      exited,
      new Promise((resolve) => setTimeout(resolve, 5000)),
    ]);
    if (web.exitCode === null) {
      web.kill("SIGKILL");
      await exited;
    }
  }
  await owner?.end().catch(() => {});
  if (native && nativeStarted)
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
  console.log(
    "Isolated HTTP database, server, credentials and test uploads removed.",
  );
}
