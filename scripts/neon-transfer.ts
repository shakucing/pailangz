import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import {
  access,
  chmod,
  mkdir,
  readFile,
  readdir,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { parse } from "dotenv";
import pg from "pg";

type Row = Record<string, unknown>;
export type Query = (
  sql: string,
  parameters?: unknown[],
) => Promise<{ rows: Row[] }>;
type Migration = { name: string; checksum: string };
type Table = { columns: string[]; rows: Row[] };
export type DeploymentTier = "preview" | "production";
export function deploymentTier(value: string): DeploymentTier {
  if (value !== "preview" && value !== "production")
    throw new Error("NEON_DEPLOYMENT_TIER must be preview or production.");
  return value;
}
export type Snapshot = {
  format: "pailangz-local-v1";
  capturedAt: string;
  migrations: Migration[];
  encryptionKeyringChecksum: string;
  tables: Record<string, Table>;
  checksum: string;
};

const directory = path.resolve(
  process.env.NEON_TRANSFER_DIR ?? ".local/neon-transfer",
);
const snapshotPath = () =>
  path.resolve(process.env.NEON_SNAPSHOT_FILE ?? `${directory}/snapshot.json`);
const ignoredTables = new Set(["local_migrations", "_prisma_migrations"]);
const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;
const relation = (table: string) => `public.${quote(table)}`;

export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
const digest = (value: unknown) =>
  createHash("sha256").update(canonical(value)).digest("hex");
const sortedRows = (rows: Row[]) => rows.map(canonical).sort();

// Copy plaintext faithfully while giving test an independent keyring. These
// contexts must match the corresponding writes in src/lib; IDs never change.
export const encryptedFields = [
  ["MemberPrivate", "registrationEncrypted", "member", "memberId"],
  ["MemberPrivate", "phoneEncrypted", "member-phone", "memberId"],
  ["RegistrationSubmission", "payloadEncrypted", "submission", "id"],
  ["RegistrationSubmission", "phoneEncrypted", "submission-phone", "id"],
  ["SubmissionDecision", "reason", "decision", "submissionId"],
  ["SubmissionDecision", "noteEncrypted", "decision", "submissionId"],
  ["ResultVersion", "reason", "match", "matchId"],
  ["Dispute", "reasonEncrypted", "match", "matchId"],
  ["Dispute", "resolutionEncrypted", "dispute", "id"],
  ["BracketDependency", "resolutionReason", "dependency", "id"],
  ["ConfigurationRevision", "reasonEncrypted", "tournament", "tournamentId"],
  ["ConfigurationRevision", "resolutionEncrypted", "revision", "id"],
] as const;

export function rekeySnapshot(
  source: Snapshot,
  sourceKeys: Record<string, string>,
  targetKeys: Record<string, string>,
  activeKey: string,
): Snapshot {
  const target = Buffer.from(targetKeys[activeKey] ?? "", "base64");
  if (target.length !== 32) throw new Error("Invalid test encryption key.");
  const snapshot = structuredClone(source);
  for (const [table, field, purpose, identifier] of encryptedFields) {
    for (const row of snapshot.tables[table]?.rows ?? []) {
      if (row[field] == null) continue;
      try {
        const [version, iv, tag, data] = String(row[field]).split(".");
        const context = Buffer.from(`${purpose}:${row[identifier]}`);
        const decipher = createDecipheriv(
          "aes-256-gcm",
          Buffer.from(sourceKeys[version] ?? "", "base64"),
          Buffer.from(iv, "base64url"),
        );
        decipher.setAAD(context);
        decipher.setAuthTag(Buffer.from(tag, "base64url"));
        const plain = Buffer.concat([
          decipher.update(Buffer.from(data, "base64url")),
          decipher.final(),
        ]);
        const nextIv = randomBytes(12);
        const cipher = createCipheriv("aes-256-gcm", target, nextIv);
        cipher.setAAD(context);
        const sealed = Buffer.concat([cipher.update(plain), cipher.final()]);
        row[field] = [
          activeKey,
          nextIv.toString("base64url"),
          cipher.getAuthTag().toString("base64url"),
          sealed.toString("base64url"),
        ].join(".");
      } catch {
        throw new Error(
          `Cannot re-encrypt ${table}.${field}; no snapshot was written.`,
        );
      }
    }
  }
  snapshot.encryptionKeyringChecksum = digest(targetKeys);
  const { checksum, ...payload } = snapshot;
  snapshot.checksum = digest(payload);
  return snapshot;
}

export async function migrations(): Promise<Migration[]> {
  const names = (await readdir("prisma/migrations"))
    .filter((name) => /^\d/.test(name))
    .sort();
  return Promise.all(
    names.map(async (name) => ({
      name,
      checksum: createHash("sha256")
        .update(await readFile(`prisma/migrations/${name}/migration.sql`))
        .digest("hex"),
    })),
  );
}

async function schema(query: Query) {
  const result = await query(
    `SELECT table_name, column_name FROM information_schema.columns
     WHERE table_schema='public' AND table_name IN
       (SELECT tablename FROM pg_tables WHERE schemaname='public')
     ORDER BY table_name, ordinal_position`,
  );
  const tables: Record<string, string[]> = {};
  for (const row of result.rows) {
    const table = String(row.table_name);
    if (!ignoredTables.has(table))
      (tables[table] ??= []).push(String(row.column_name));
  }
  return tables;
}

export function validateSnapshot(snapshot: Snapshot, expected: Migration[]) {
  const { checksum, ...payload } = snapshot;
  if (snapshot.format !== "pailangz-local-v1" || digest(payload) !== checksum)
    throw new Error("Snapshot format or checksum is invalid.");
  if (canonical(snapshot.migrations) !== canonical(expected))
    throw new Error("Snapshot migrations do not match this checkout.");
  if (snapshot.tables.Evidence?.rows.length)
    throw new Error("Evidence files require a separate storage transfer.");
  if (
    snapshot.tables.DeploymentEnvironment?.rows.length !== 1 ||
    snapshot.tables.DeploymentEnvironment.rows[0].tier !== "development"
  )
    throw new Error("Expected a local development snapshot.");
}

export async function captureSnapshot(
  query: Query,
  expected: Migration[],
  encryptionKeyringChecksum = "",
): Promise<Snapshot> {
  await query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  try {
    await query("SET LOCAL TIME ZONE 'UTC'");
    const applied = await query(
      "SELECT name,checksum FROM local_migrations ORDER BY name",
    );
    if (canonical(applied.rows) !== canonical(expected))
      throw new Error("Local database migrations do not match this checkout.");
    const tables: Record<string, Table> = {};
    for (const [name, columns] of Object.entries(await schema(query))) {
      const result = await query(
        `SELECT to_jsonb(t) AS row FROM ${relation(name)} t`,
      );
      tables[name] = { columns, rows: result.rows.map((r) => r.row as Row) };
    }
    const payload = {
      format: "pailangz-local-v1" as const,
      capturedAt: new Date().toISOString(),
      migrations: expected,
      encryptionKeyringChecksum,
      tables,
    };
    const snapshot = { ...payload, checksum: digest(payload) };
    validateSnapshot(snapshot, expected);
    await query("COMMIT");
    return snapshot;
  } catch (error) {
    await query("ROLLBACK");
    throw error;
  }
}

async function requireEmpty(query: Query, tables: string[]) {
  let bootstrapAudit = false;
  for (const table of tables) {
    if (table === "DeploymentEnvironment") continue;
    if (table === "AuditEvent") {
      const result = await query(
        'SELECT to_jsonb(t) AS row FROM "AuditEvent" t',
      );
      if (result.rows.length === 1) {
        const { id, createdAt, correlationId, ...event } = result.rows[0]
          .row as Row;
        const expected = {
          actorId: null,
          actorRole: "SYSTEM",
          action: "STAFF_AUTHENTICATION_POLICY_CHANGE",
          entityType: "SECURITY",
          entityId: "staff-login",
          tournamentId: null,
          stageId: null,
          changes: {
            authenticationMethod: "password",
            authenticatorRequired: false,
            priorSessionsRevoked: true,
          },
          reason:
            "User requested removal of the authenticator requirement; existing passwords and staff roles are preserved.",
          source: "MIGRATION",
          outcome: "SUCCESS",
          relatedIds: [],
        };
        if (canonical(event) === canonical(expected)) {
          bootstrapAudit = true;
          continue;
        }
      }
    }
    const result = await query(
      `SELECT EXISTS(SELECT 1 FROM ${relation(table)}) AS occupied`,
    );
    if (result.rows[0].occupied)
      throw new Error(
        `Target ${table} contains data. Use a fresh Neon database.`,
      );
  }
  return bootstrapAudit;
}

export async function verifySnapshot(
  query: Query,
  snapshot: Snapshot,
  tier: DeploymentTier = "production",
) {
  deploymentTier(tier);
  // TIMESTAMPTZ renders in the session timezone when converted to JSON.
  await query("SET TIME ZONE 'UTC'");
  for (const [name, table] of Object.entries(snapshot.tables)) {
    const actual = await query(
      `SELECT to_jsonb(t) AS row FROM ${relation(name)} t`,
    );
    const expected = table.rows.map((row) =>
      name === "DeploymentEnvironment" ? { ...row, tier } : row,
    );
    if (
      canonical(sortedRows(actual.rows.map((r) => r.row as Row))) !==
      canonical(sortedRows(expected))
    )
      throw new Error(`Transferred rows do not match the snapshot: ${name}.`);
  }
}

// The destination is migrated and empty. Changes to triggers and FK deferral
// exist only inside this transaction and return to their original definitions.
export async function restoreSnapshot(
  query: Query,
  snapshot: Snapshot,
  tier: DeploymentTier = "production",
) {
  deploymentTier(tier);
  await query("BEGIN");
  try {
    await query("SET LOCAL TIME ZONE 'UTC'");
    await query("SET LOCAL lock_timeout = '10s'");
    const targetSchema = await schema(query);
    const sourceSchema = Object.fromEntries(
      Object.entries(snapshot.tables).map(([name, table]) => [
        name,
        table.columns,
      ]),
    );
    if (canonical(targetSchema) !== canonical(sourceSchema))
      throw new Error("Source and destination table columns differ.");
    const tables = Object.keys(targetSchema);
    await query(
      `LOCK TABLE ${tables.map(relation).join(",")} IN ACCESS EXCLUSIVE MODE`,
    );
    const bootstrapAudit = await requireEmpty(query, tables);
    const triggers = await query(
      `SELECT c.relname AS table_name,t.tgname AS name,t.tgenabled AS enabled
       FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
       JOIN pg_namespace n ON n.oid=c.relnamespace
       WHERE n.nspname='public' AND NOT t.tgisinternal`,
    );
    const constraints = await query(
      `SELECT c.relname AS table_name,k.conname AS name,k.condeferrable AS deferrable
       FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid
       JOIN pg_namespace n ON n.oid=c.relnamespace
       WHERE n.nspname='public' AND k.contype='f'`,
    );
    for (const trigger of triggers.rows)
      if (trigger.enabled !== "D")
        await query(
          `ALTER TABLE ${relation(String(trigger.table_name))} DISABLE TRIGGER ${quote(String(trigger.name))}`,
        );
    // Migration 008 creates one bootstrap policy event even on an empty DB.
    // Replace that disposable duplicate with the original local audit history.
    if (bootstrapAudit) await query('DELETE FROM "AuditEvent"');
    for (const constraint of constraints.rows)
      if (!constraint.deferrable)
        await query(
          `ALTER TABLE ${relation(String(constraint.table_name))} ALTER CONSTRAINT ${quote(String(constraint.name))} DEFERRABLE INITIALLY IMMEDIATE`,
        );
    await query("SET CONSTRAINTS ALL DEFERRED");
    for (const [name, table] of Object.entries(snapshot.tables)) {
      if (name === "DeploymentEnvironment" || !table.rows.length) continue;
      await query(
        `INSERT INTO ${relation(name)} SELECT * FROM jsonb_populate_recordset(NULL::${relation(name)},$1::jsonb)`,
        [JSON.stringify(table.rows)],
      );
    }
    await query('UPDATE "DeploymentEnvironment" SET tier=$1', [tier]);
    // Validate all references before restoring normal constraint definitions.
    await query("SET CONSTRAINTS ALL IMMEDIATE");
    for (const constraint of constraints.rows)
      if (!constraint.deferrable)
        await query(
          `ALTER TABLE ${relation(String(constraint.table_name))} ALTER CONSTRAINT ${quote(String(constraint.name))} NOT DEFERRABLE`,
        );
    for (const trigger of triggers.rows) {
      const action = { O: "ENABLE", R: "ENABLE REPLICA", A: "ENABLE ALWAYS" }[
        String(trigger.enabled)
      ];
      if (action)
        await query(
          `ALTER TABLE ${relation(String(trigger.table_name))} ${action} TRIGGER ${quote(String(trigger.name))}`,
        );
    }
    await verifySnapshot(query, snapshot, tier);
    await query("COMMIT");
  } catch (error) {
    await query("ROLLBACK");
    throw error;
  }
}

export function neonUrl(value: string | undefined) {
  if (
    !value?.trim() ||
    value.trim() === "PASTE_DIRECT_NEON_OWNER_CONNECTION_HERE"
  )
    throw new Error(
      `Set NEON_DATABASE_URL in ${directory}/target.env to your direct Neon owner connection string before importing.`,
    );
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error(
      "NEON_DATABASE_URL is not a valid URL. Paste only the postgresql:// connection string, without a psql command or surrounding shell syntax.",
    );
  }
  if (
    !["postgresql:", "postgres:"].includes(url.protocol) ||
    !url.hostname.endsWith(".neon.tech") ||
    url.hostname.includes("-pooler.") ||
    !["require", "verify-full"].includes(
      url.searchParams.get("sslmode") ?? "",
    ) ||
    decodeURIComponent(url.username) === "pailangz_app"
  )
    throw new Error(
      "NEON_DATABASE_URL must be a direct Neon owner URL with TLS.",
    );
  return url;
}

async function privateFile(filename: string, contents: string, fresh = true) {
  await mkdir(path.dirname(filename), { recursive: true, mode: 0o700 });
  await chmod(path.dirname(filename), 0o700);
  await writeFile(filename, contents, {
    mode: 0o600,
    flag: fresh ? "wx" : "w",
  });
  await chmod(filename, 0o600);
}
export const envText = (values: Record<string, string>) =>
  Object.entries(values)
    .map(([key, value]) => {
      const delimiter = ["'", '"', "`"].find(
        (candidate) => !value.includes(candidate),
      );
      if (
        !delimiter ||
        /[\r\n]/.test(value) ||
        (delimiter === '"' && /\\[nr]/.test(value))
      )
        throw new Error(
          `Cannot serialize ${key} to an env file without changing its value.`,
        );
      return `${key}=${delimiter}${value}${delimiter}`;
    })
    .join("\n") + "\n";

async function exportLocal() {
  const tier = deploymentTier(process.env.NEON_DEPLOYMENT_TIER ?? "production");
  for (const filename of [
    snapshotPath(),
    `${directory}/target.env`,
    `${directory}/vercel.env`,
    `${directory}/summary.json`,
    ...(tier === "preview" ? [`${directory}/storage.env`] : []),
  ]) {
    let exists = false;
    try {
      await access(filename);
      exists = true;
    } catch (error) {
      if ((error as { code?: string }).code !== "ENOENT") throw error;
    }
    if (exists)
      throw new Error(
        "Transfer files already exist. Set NEON_TRANSFER_DIR to a new ignored .local directory for a new snapshot.",
      );
  }
  const local = parse(await readFile(".env"));
  const source =
    process.env.SOURCE_DATABASE_URL ?? local.MIGRATION_DATABASE_URL;
  if (
    !source ||
    !["localhost", "127.0.0.1", "[::1]"].includes(new URL(source).hostname)
  )
    throw new Error("Export requires the loopback local owner connection.");
  const keys: Record<string, string> = JSON.parse(
    local.DATA_ENCRYPTION_KEYS ?? "{}",
  );
  if (
    !Object.keys(keys).length ||
    Object.values(keys).some(
      (key) =>
        typeof key !== "string" || Buffer.from(key, "base64").length !== 32,
    ) ||
    !keys[local.ACTIVE_ENCRYPTION_KEY]
  )
    throw new Error("Local encryption keyring is invalid.");
  const client = new pg.Client({ connectionString: source });
  await client.connect();
  try {
    const captured = await captureSnapshot(
      client.query.bind(client),
      await migrations(),
      digest(keys),
    );
    const activeKey =
      tier === "preview" ? "test_v1" : local.ACTIVE_ENCRYPTION_KEY;
    const targetKeys =
      tier === "preview"
        ? { [activeKey]: randomBytes(32).toString("base64") }
        : keys;
    const snapshot =
      tier === "preview"
        ? rekeySnapshot(captured, keys, targetKeys, activeKey)
        : captured;
    await privateFile(snapshotPath(), JSON.stringify(snapshot, null, 2) + "\n");
    await privateFile(
      `${directory}/target.env`,
      envText({
        NEON_DATABASE_URL: "PASTE_DIRECT_NEON_OWNER_CONNECTION_HERE",
        NEON_RUNTIME_PASSWORD: randomBytes(32).toString("base64url"),
      }),
    );
    await privateFile(
      `${directory}/vercel.env`,
      envText({
        APP_ENV: tier,
        DATABASE_ENV: tier,
        LOCAL_PGLITE: "false",
        DATABASE_URL: "FILLED_AFTER_NEON_IMPORT",
        NEXTAUTH_URL:
          tier === "preview"
            ? "https://pailangz-test.vercel.app"
            : "https://YOUR_DOMAIN",
        NEXTAUTH_SECRET: randomBytes(48).toString("base64url"),
        DATA_ENCRYPTION_KEYS: JSON.stringify(targetKeys),
        ACTIVE_ENCRYPTION_KEY: activeKey,
        PHONE_DEFAULT_COUNTRY: local.PHONE_DEFAULT_COUNTRY ?? "MY",
        PRIVATE_EXPORT_ENABLED: "false",
        EVIDENCE_STORAGE: "s3",
        S3_ENDPOINT: "",
        S3_REGION: "",
        S3_BUCKET: "",
        S3_ACCESS_KEY_ID: "",
        S3_SECRET_ACCESS_KEY: "",
      }),
    );
    if (tier === "preview")
      await privateFile(
        `${directory}/storage.env`,
        envText({
          S3_BUCKET: "pailangz-test-evidence",
          AWS_ENDPOINT_URL_S3: "",
          AWS_REGION: "ap-southeast-1",
          AWS_ACCESS_KEY_ID: "",
          AWS_SECRET_ACCESS_KEY: "",
        }),
      );
    await privateFile(
      `${directory}/summary.json`,
      JSON.stringify(
        {
          capturedAt: snapshot.capturedAt,
          deploymentTier: tier,
          checksum: snapshot.checksum,
          counts: Object.fromEntries(
            Object.entries(snapshot.tables).map(([name, table]) => [
              name,
              table.rows.length,
            ]),
          ),
        },
        null,
        2,
      ) + "\n",
    );
    console.log(`Local snapshot prepared: ${snapshotPath()}`);
    console.log(
      `Edit ${directory}/target.env with your direct Neon owner URL.`,
    );
    console.log(
      "Snapshot and encryption keys are private, ignored by Git, and mode 0600.",
    );
  } finally {
    await client.end();
  }
}

async function importNeon() {
  const config = parse(
    await readFile(process.env.NEON_ENV_FILE ?? `${directory}/target.env`),
  );
  const ownerUrl = process.env.NEON_DATABASE_URL ?? config.NEON_DATABASE_URL;
  const url = neonUrl(ownerUrl);
  const password =
    process.env.NEON_RUNTIME_PASSWORD ?? config.NEON_RUNTIME_PASSWORD;
  if (!password || password.length < 32)
    throw new Error(
      "A runtime password of at least 32 characters is required.",
    );
  const snapshot = JSON.parse(
    await readFile(snapshotPath(), "utf8"),
  ) as Snapshot;
  validateSnapshot(snapshot, await migrations());
  const prepared = parse(await readFile(`${directory}/vercel.env`));
  const tier = deploymentTier(prepared.APP_ENV);
  if (
    prepared.DATABASE_ENV !== tier ||
    (process.env.NEON_DEPLOYMENT_TIER &&
      process.env.NEON_DEPLOYMENT_TIER !== tier)
  )
    throw new Error(
      "Prepared deployment tier does not match the requested import.",
    );
  if (
    digest(JSON.parse(prepared.DATA_ENCRYPTION_KEYS ?? "{}")) !==
    snapshot.encryptionKeyringChecksum
  )
    throw new Error(
      "The prepared encryption keyring does not match the snapshot.",
    );
  const client = new pg.Client({ connectionString: url.toString() });
  await client.connect();
  try {
    // Check before migrations: never initialize unrelated populated databases.
    const existing = await schema(client.query.bind(client));
    for (const name of Object.keys(existing))
      if (!(name in snapshot.tables))
        throw new Error(
          `Unexpected target table: ${name}. Use a fresh database.`,
        );
    await requireEmpty(client.query.bind(client), Object.keys(existing));
    console.log("Applying Prisma migrations to the empty Neon database...");
    const result = spawnSync(
      process.execPath,
      [path.resolve("node_modules/prisma/build/index.js"), "migrate", "deploy"],
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
      throw new Error(
        "Prisma migration failed. Check Neon owner permissions and migration status; no snapshot data was imported.",
      );
    const role =
      await client.query(`SELECT rolsuper,rolbypassrls,rolcreatedb,rolcreaterole,rolinherit,
      EXISTS(SELECT 1 FROM pg_auth_members WHERE member=r.oid) AS membership
      FROM pg_roles r WHERE rolname='pailangz_app'`);
    const attributes = role.rows[0];
    if (!attributes || Object.values(attributes).some(Boolean))
      throw new Error(
        "pailangz_app must be a SQL-created non-owner role without privileged memberships.",
      );
    const command = await client.query(
      "SELECT format('ALTER ROLE pailangz_app LOGIN PASSWORD %L', $1::text) AS sql",
      [password],
    );
    await client.query(command.rows[0].sql);
    await client.query(
      `GRANT CONNECT ON DATABASE ${quote(decodeURIComponent(url.pathname.slice(1)))} TO pailangz_app`,
    );
    console.log("Copying and comparing every row in one transaction...");
    await restoreSnapshot(client.query.bind(client), snapshot, tier);
    url.username = "pailangz_app";
    url.password = password;
    const runtime = new pg.Client({ connectionString: url.toString() });
    await runtime.connect();
    try {
      const check = await runtime.query(
        `SELECT current_user AS role,tier FROM "DeploymentEnvironment"`,
      );
      if (
        check.rows[0]?.role !== "pailangz_app" ||
        check.rows[0]?.tier !== tier
      )
        throw new Error("Runtime role/environment verification failed.");
    } finally {
      await runtime.end();
    }
    prepared.DATABASE_URL = url.toString();
    await privateFile(`${directory}/vercel.env`, envText(prepared), false);
    console.log(
      `Verified exact snapshot transfer. Vercel variables: ${directory}/vercel.env`,
    );
    console.log(
      "Fill NEXTAUTH_URL and S3 values before deploying. Do not run the original db:seed against this copy.",
    );
  } finally {
    await client.end();
  }
}

if (
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
) {
  const operation = process.argv[2];
  try {
    if (operation === "export") await exportLocal();
    else if (operation === "import") await importNeon();
    else throw new Error("Use export or import.");
  } catch (error) {
    // Do not print SQL error detail, snapshot records, passwords or stack traces.
    const databaseError = error as { code?: string };
    console.error(
      databaseError.code && /^\d|^[A-Z_]+$/.test(databaseError.code)
        ? `Database transfer failed (${databaseError.code}). No row contents were logged.`
        : error instanceof Error
          ? error.message
          : "Database transfer failed.",
    );
    process.exitCode = 1;
  }
}
