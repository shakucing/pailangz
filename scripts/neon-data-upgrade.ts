import { readFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { parse } from "dotenv";
import type { Query } from "./neon-transfer";

export const emptyTournamentUpgrade = "20261008_empty_32_player_tournament";

export async function dataUpgradeCompleted(query: Query) {
  const result = await query(
    `SELECT id FROM "AuditEvent" WHERE action='TOURNAMENT_APPLICATION_RESET'
      AND source='OPERATOR' AND outcome='SUCCESS' AND changes->>'upgradeId'=$1 LIMIT 1`,
    [emptyTournamentUpgrade],
  );
  return result.rows.length === 1;
}

export function resetEnvironment(
  production: Record<string, string>,
  ownerUrl: string,
  backupDirectory: string,
): NodeJS.ProcessEnv & { TOURNAMENT_RESET_BACKUP_DIR: string } {
  const owner = new URL(ownerUrl);
  const runtime = new URL(production.DATABASE_URL);
  const hostname = (url: URL) => url.hostname.replace("-pooler.", ".");
  if (
    hostname(owner) !== hostname(runtime) ||
    owner.pathname !== runtime.pathname ||
    production.APP_ENV !== "production" ||
    production.DATABASE_ENV !== "production" ||
    !production.DATA_ENCRYPTION_KEYS ||
    !production.ACTIVE_ENCRYPTION_KEY
  )
    throw new Error(
      "Production environment does not match the selected Neon database.",
    );
  return {
    ...process.env,
    ...production,
    DATABASE_URL: ownerUrl,
    MIGRATION_DATABASE_URL: ownerUrl,
    APP_ENV: "production",
    DATABASE_ENV: "production",
    LOCAL_PGLITE: "false",
    VERCEL: undefined,
    VERCEL_ENV: "production",
    TOURNAMENT_RESET_BACKUP_DIR: backupDirectory,
  };
}

// Called even when every SQL migration was already applied in the SQL Editor.
export async function applyNeonDataUpgrade(
  query: Query,
  ownerUrl: string,
  directory: string,
) {
  if (await dataUpgradeCompleted(query)) {
    console.log(
      "The one-time 32-player tournament reset is already complete; later entries are retained.",
    );
    return;
  }
  const production = parse(await readFile(`${directory}/vercel.env`, "utf8"));
  const env = resetEnvironment(
    production,
    ownerUrl,
    path.join(directory, "tournament-reset"),
  );
  const generated = spawnSync(
    process.execPath,
    [path.resolve("node_modules/prisma/build/index.js"), "generate"],
    { env, encoding: "utf8" },
  );
  if (generated.status !== 0)
    throw new Error(
      "Could not generate the database client for the data upgrade.",
    );
  console.log(
    "Applying the one-time empty 32-player / eight-team reset with a private backup...",
  );
  const result = spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      path.resolve("scripts/reset-official-tournament.ts"),
      "--apply",
      "--neon-upgrade",
    ],
    { env, encoding: "utf8" },
  );
  if (result.status !== 0)
    throw new Error(
      "The tournament reset was rolled back. Check the event is unplayed, has at most 32 applications, the saved production encryption keys are valid, and the backup directory is writable.",
    );
  if (!(await dataUpgradeCompleted(query)))
    throw new Error(
      "The tournament reset completion record could not be verified.",
    );
  console.log(
    "Verified the one-time reset. SOLO capacity is 32 and TEAM capacity is 8; the roster and fixtures were cleared, teams archived, and member records retained.",
  );
  console.log(
    `Private pre-reset backup directory: ${env.TOURNAMENT_RESET_BACKUP_DIR}`,
  );
}
