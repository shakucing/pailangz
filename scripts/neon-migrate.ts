import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { parse } from "dotenv";
import pg from "pg";
import { migrations, neonUrl } from "./neon-transfer";
import {
  applyNeonDataUpgrade,
  dataUpgradeCompleted,
} from "./neon-data-upgrade";

class UpgradeError extends Error {}
type Migration = { name: string; checksum: string };
type AppliedMigration = {
  migration_name: string;
  checksum: string;
  finished_at: Date | null;
  rolled_back_at: Date | null;
};

export function upgradePlan(
  applied: AppliedMigration[],
  expected: Migration[],
): Migration[] {
  const active = applied.filter((row) => !row.rolled_back_at);
  if (!active.length)
    throw new UpgradeError(
      "No existing Prisma migration history found. Use the initial Neon import for a fresh database.",
    );
  if (active.some((row) => !row.finished_at))
    throw new UpgradeError(
      "An unfinished migration requires operator recovery before upgrading.",
    );
  const names = new Set<string>();
  for (const row of active) {
    const migration = expected.find((item) => item.name === row.migration_name);
    if (
      !migration ||
      migration.checksum !== row.checksum ||
      names.has(row.migration_name)
    )
      throw new UpgradeError(
        "The database migration history differs from this checkout. Resolve the mismatch before upgrading.",
      );
    names.add(row.migration_name);
  }
  const completed = expected.filter((item) => names.has(item.name));
  if (completed.some((item, index) => item.name !== expected[index].name))
    throw new UpgradeError(
      "The database migration history has a gap. Resolve it before upgrading.",
    );
  return expected.filter((item) => !names.has(item.name));
}

async function upgradeNeon() {
  const directory = path.resolve(
    process.env.NEON_TRANSFER_DIR ?? ".local/neon-transfer",
  );
  const target = parse(
    await readFile(process.env.NEON_ENV_FILE ?? `${directory}/target.env`),
  );
  const url = neonUrl(
    process.env.NEON_DATABASE_URL ?? target.NEON_DATABASE_URL,
  );
  // Preserve certificate verification without the pg SSL compatibility warning.
  url.searchParams.set("sslmode", "verify-full");
  const client = new pg.Client({ connectionString: url.toString() });
  await client.connect();
  try {
    const environment = await client.query(
      `SELECT current_user AS role, tier, current_user=pg_get_userbyid(c.relowner) AS owner
       FROM "DeploymentEnvironment", pg_class c WHERE c.oid='public."Tournament"'::regclass`,
    );
    if (
      environment.rows.length !== 1 ||
      environment.rows[0].tier !== "production" ||
      environment.rows[0].role === "pailangz_app" ||
      !environment.rows[0].owner
    )
      throw new UpgradeError(
        "Upgrade requires the owner connection to the existing production database.",
      );
    const expected = await migrations();
    const history = async () =>
      (
        await client.query<AppliedMigration>(
          'SELECT migration_name, checksum, finished_at, rolled_back_at FROM "_prisma_migrations" ORDER BY migration_name',
        )
      ).rows;
    const pending = upgradePlan(await history(), expected);
    if (process.argv.includes("--check")) {
      console.log(
        `Verified migration checksums. Pending SQL migrations: ${pending.length}.`,
      );
      console.log(
        (await dataUpgradeCompleted(client.query.bind(client)))
          ? "The one-time 32-player reset is complete."
          : "Pending data upgrade: empty 32-player / eight-team tournament reset.",
      );
      return;
    }
    if (!pending.length) {
      console.log("Neon database migrations are already current.");
    } else {
      console.log(`Applying ${pending.length} pending Neon migration(s)...`);
      const result = spawnSync(
        process.execPath,
        [
          path.resolve("node_modules/prisma/build/index.js"),
          "migrate",
          "deploy",
        ],
        {
          env: {
            ...process.env,
            MIGRATION_DATABASE_URL: url.toString(),
            DATABASE_URL: url.toString(),
          },
          encoding: "utf8",
        },
      );
      if (result.status !== 0)
        throw new UpgradeError(
          "Prisma migration failed. Check migration status with the owner connection before retrying. No import or seed was run.",
        );
      if (upgradePlan(await history(), expected).length)
        throw new UpgradeError("Neon migration verification failed.");
      console.log("Verified Neon schema upgrade.");
    }
    try {
      await applyNeonDataUpgrade(
        client.query.bind(client),
        url.toString(),
        directory,
      );
    } catch (error) {
      throw new UpgradeError(
        error instanceof Error &&
          (error.message.startsWith("The tournament reset") ||
            error.message.startsWith("Production environment") ||
            error.message.startsWith("Could not generate"))
          ? error.message
          : "The data upgrade did not complete. Check the matching private vercel.env encryption settings and backup permissions; schema migrations remain applied. Retry this command after resolving the issue.",
      );
    }
    console.log("Push the app changes and redeploy Vercel Production next.");
  } finally {
    await client.end();
  }
}

if (
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
) {
  try {
    await upgradeNeon();
  } catch (error) {
    console.error(
      error instanceof UpgradeError
        ? error.message
        : "Neon upgrade failed. Check the private target.env owner URL, connectivity and migration permissions. No credentials or row contents were logged.",
    );
    process.exitCode = 1;
  }
}
