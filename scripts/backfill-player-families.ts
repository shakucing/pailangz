import "dotenv/config";
import { pathToFileURL } from "node:url";
import pg from "pg";
import { decrypt } from "../src/lib/crypto";
import { publicFamilyDetails } from "../src/lib/member-fields";

// Explicit operator action: never called from application startup or builds.
export async function backfillPlayerFamilies(client: pg.Client) {
  await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
  try {
    const rows = (
      await client.query<{
        id: string;
        isMember: boolean;
        publicFamilyName: string | null;
        registrationEncrypted: string | null;
      }>(`SELECT m.id,m."isMember",m."publicFamilyName",p."registrationEncrypted"
      FROM "Member" m LEFT JOIN "MemberPrivate" p ON p."memberId"=m.id`)
    ).rows;
    let updated = 0;
    for (const row of rows) {
      const fields = row.registrationEncrypted
        ? JSON.parse(decrypt(row.registrationEncrypted, `member:${row.id}`))
        : {};
      const family = publicFamilyDetails(row.isMember, fields);
      if (
        family.isMember === row.isMember &&
        family.publicFamilyName === row.publicFamilyName
      )
        continue;
      await client.query(
        'UPDATE "Member" SET "isMember"=$1,"publicFamilyName"=$2 WHERE id=$3',
        [family.isMember, family.publicFamilyName, row.id],
      );
      updated++;
    }
    await client.query("COMMIT");
    return { profiles: rows.length, updated };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function main() {
  const tier = process.env.DATABASE_ENV;
  if (
    !tier ||
    !["development", "preview", "production"].includes(tier) ||
    process.env.APP_ENV !== tier
  )
    throw new Error(
      "Set matching APP_ENV and DATABASE_ENV for the intended database.",
    );
  if (!process.env.MIGRATION_DATABASE_URL)
    throw new Error("An operator database connection is required.");
  const client = new pg.Client({
    connectionString: process.env.MIGRATION_DATABASE_URL,
  });
  await client.connect();
  try {
    const actual = (
      await client.query('SELECT tier FROM "DeploymentEnvironment"')
    ).rows[0]?.tier;
    if (actual !== tier)
      throw new Error(
        "Actual database tier does not match the requested environment.",
      );
    const owner = (
      await client.query(
        `SELECT current_user=pg_get_userbyid(relowner) AS allowed FROM pg_class WHERE oid='"Member"'::regclass`,
      )
    ).rows[0]?.allowed;
    if (!owner)
      throw new Error("Run the backfill with the database owner connection.");
    console.log(JSON.stringify(await backfillPlayerFamilies(client)));
  } finally {
    await client.end();
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await main();
