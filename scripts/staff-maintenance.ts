import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import { stdin, stdout } from "node:process";
import { hash, truncates } from "bcryptjs";
import { parse } from "dotenv";
import pg from "pg";

export type StaffAccount = {
  id: string;
  email: string;
  name: string;
  role: "ADMIN" | "MODERATOR";
  suspended: boolean;
  passwordHash: string;
  sessionVersion: number;
};
export type Query = (
  sql: string,
  parameters?: unknown[],
) => Promise<{
  rows: Record<string, unknown>[];
}>;
const columns = 'id,email,name,role,suspended,"passwordHash","sessionVersion"';
const loginKey = (email: string) =>
  `login:${createHash("sha256").update(email.trim().toLowerCase()).digest("hex")}`;

export function disposableQa(account: StaffAccount) {
  return (
    account.suspended &&
    /^[^@]+@synthetic\.invalid$/.test(account.email) &&
    /^Disposable (synthetic|browser) QA(?:\b|$)/.test(account.name)
  );
}

export function validateStaffPassword(password: string) {
  if (password.length < 14)
    throw new Error("Use at least 14 characters for each staff password.");
  if (truncates(password))
    throw new Error("Use a password no longer than 72 UTF-8 bytes.");
  if (/[\r\n\u0000]/.test(password))
    throw new Error("Passwords cannot contain line breaks or null characters.");
}

async function operatorAudit(
  query: Query,
  action: string,
  ids: string[],
  changes: Record<string, unknown>,
) {
  await query(
    'INSERT INTO "AuditEvent" (id,"actorRole",action,"entityType","entityId",changes,reason,"correlationId",source,outcome,"relatedIds") VALUES ($1,\'SYSTEM\',$2,\'STAFF\',\'staff-maintenance\',$3::jsonb,$4,$5,\'CLI\',\'SUCCESS\',$6::text[])',
    [
      randomUUID(),
      action,
      JSON.stringify(changes),
      "Operator requested staff account maintenance.",
      randomUUID(),
      ids,
    ],
  );
}

export async function updateStaffPasswords(
  query: Query,
  updates: { account: StaffAccount; passwordHash: string }[],
) {
  if (!updates.length) return;
  if (new Set(updates.map((item) => item.account.id)).size !== updates.length)
    throw new Error("Each staff account can only be updated once.");
  if (
    updates.some(
      (item) => !/^\$2[aby]\$12\$[./a-zA-Z0-9]{53}$/.test(item.passwordHash),
    )
  )
    throw new Error(
      "Staff password updates require bcrypt hashes with cost 12.",
    );
  await query("BEGIN ISOLATION LEVEL SERIALIZABLE");
  try {
    const locked = await query(
      `SELECT ${columns} FROM "StaffUser" WHERE id=ANY($1::text[]) FOR UPDATE`,
      [updates.map((item) => item.account.id)],
    );
    for (const { account, passwordHash } of updates) {
      const current = locked.rows.find((row) => row.id === account.id);
      if (
        !current ||
        current.suspended ||
        disposableQa(current as StaffAccount) ||
        current.email !== account.email ||
        current.passwordHash !== account.passwordHash ||
        current.sessionVersion !== account.sessionVersion
      )
        throw new Error(
          "A selected account changed or is not active. No passwords were updated; rerun the command.",
        );
      await query(
        'UPDATE "StaffUser" SET "passwordHash"=$1,"sessionVersion"="sessionVersion"+1 WHERE id=$2',
        [passwordHash, account.id],
      );
      await query('UPDATE "StaffSession" SET revoked=true WHERE "userId"=$1', [
        account.id,
      ]);
      await query('DELETE FROM "AuthThrottle" WHERE key=$1', [
        loginKey(account.email),
      ]);
    }
    const ids = updates.map((item) => item.account.id);
    await operatorAudit(query, "STAFF_PASSWORD_CHANGE", ids, {
      accountIds: ids,
      authenticationMethod: "password",
      priorSessionsRevoked: true,
    });
    await query("COMMIT");
  } catch (error) {
    await query("ROLLBACK");
    throw error;
  }
}

export async function removeDisposableStaff(query: Query, ids: string[]) {
  if (!ids.length) return 0;
  const unique = [...new Set(ids)];
  await query("BEGIN ISOLATION LEVEL SERIALIZABLE");
  try {
    const selected = await query(
      `SELECT ${columns} FROM "StaffUser" WHERE id=ANY($1::text[]) FOR UPDATE`,
      [unique],
    );
    if (
      selected.rows.length !== unique.length ||
      selected.rows.some((row) => !disposableQa(row as StaffAccount))
    )
      throw new Error(
        "Cleanup only removes suspended, named QA accounts with @synthetic.invalid emails. No staff accounts were removed.",
      );
    await query('DELETE FROM "StaffSession" WHERE "userId"=ANY($1::text[])', [
      unique,
    ]);
    await query('DELETE FROM "AuthThrottle" WHERE key=ANY($1::text[])', [
      selected.rows.map((row) => loginKey(String(row.email))),
    ]);
    await query('DELETE FROM "StaffUser" WHERE id=ANY($1::text[])', [unique]);
    await operatorAudit(query, "QA_STAFF_REMOVE", unique, {
      accountIds: unique,
      removed: unique.length,
      synthetic: true,
    });
    await query("COMMIT");
    return unique.length;
  } catch (error) {
    await query("ROLLBACK");
    throw error;
  }
}

async function hiddenPassword(prompt: string) {
  const silent = new Writable({
    write(_chunk, _encoding, done) {
      done();
    },
  });
  const rl = createInterface({ input: stdin, output: silent, terminal: true });
  const controller = new AbortController();
  rl.once("SIGINT", () => controller.abort());
  stdout.write(prompt);
  try {
    return await rl.question("", { signal: controller.signal });
  } finally {
    rl.close();
    silent.destroy();
    stdout.write("\n");
  }
}

async function main() {
  const [action, ...flags] = process.argv.slice(2);
  if (
    !["check", "passwords", "cleanup"].includes(action) ||
    flags.some((flag) => !["--neon", "--local", "--apply"].includes(flag)) ||
    flags.includes("--neon") === flags.includes("--local") ||
    (flags.includes("--apply") && action !== "cleanup")
  )
    throw new Error(
      "Choose --neon or --local. Only cleanup accepts --apply. Passwords are prompted privately, never passed as arguments.",
    );
  const neon = flags.includes("--neon");
  const directory = path.resolve(
    process.env.NEON_TRANSFER_DIR ?? ".local/neon-transfer",
  );
  const env = parse(
    await readFile(neon ? path.join(directory, "target.env") : ".env"),
  );
  const connection = neon ? env.NEON_DATABASE_URL : env.MIGRATION_DATABASE_URL;
  let url: URL;
  try {
    url = new URL(connection);
  } catch {
    throw new Error("The selected owner database URL is missing or invalid.");
  }
  if (neon) {
    if (
      !url.hostname.endsWith(".neon.tech") ||
      url.hostname.includes("-pooler.") ||
      !["require", "verify-full"].includes(
        url.searchParams.get("sslmode") ?? "",
      )
    )
      throw new Error(
        "Neon maintenance requires a direct TLS Neon owner connection in target.env.",
      );
    url.searchParams.set("sslmode", "verify-full");
  } else if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
    throw new Error("Local maintenance requires a loopback owner connection.");
  const client = new pg.Client({
    connectionString: url.toString(),
    connectionTimeoutMillis: 10_000,
  });
  const query: Query = async (sql, parameters) => client.query(sql, parameters);
  try {
    await client.connect();
    const identity = await query(
      'SELECT current_user AS role,tier,(SELECT pg_get_userbyid(relowner)=current_user FROM pg_class WHERE oid=\'"StaffUser"\'::regclass) AS owns_staff FROM "DeploymentEnvironment"',
    );
    if (
      identity.rows[0]?.tier !== (neon ? "production" : "development") ||
      !identity.rows[0]?.owns_staff
    )
      throw new Error(
        "The connection must be the table owner in the selected database environment.",
      );
    const all = (
      await query(
        `SELECT ${columns} FROM "StaffUser" ORDER BY suspended,name,id`,
      )
    ).rows as StaffAccount[];
    const qa = all.filter(disposableQa);
    const active = all.filter((account) => !account.suspended);
    console.log(
      `Target: ${neon ? "Neon production" : "local development"}. ${active.length} active staff; ${qa.length} suspended disposable QA accounts.`,
    );
    console.table(
      active.map(({ name, email, role }) => ({ name, email, role })),
    );
    if (action === "check") return;
    if (action === "cleanup") {
      console.table(qa.map(({ name, email, role }) => ({ name, email, role })));
      if (!flags.includes("--apply")) {
        console.log(
          "Preview only. Rerun with --apply to remove only these QA accounts and their sessions. Audit and tournament history are retained.",
        );
        return;
      }
      const removed = await removeDisposableStaff(
        query,
        qa.map((account) => account.id),
      );
      console.log(
        `Removed ${removed} disposable QA staff accounts. Real staff and audit history retained.`,
      );
      return;
    }
    if (!stdin.isTTY || !stdout.isTTY)
      throw new Error(
        "Password updates require your interactive terminal. Never send passwords through chat, arguments or environment variables.",
      );
    const updates: { account: StaffAccount; passwordHash: string }[] = [];
    for (const account of active) {
      console.log(`\n${account.name} (${account.email}, ${account.role})`);
      const password = await hiddenPassword(
        "New password (14+ characters; Enter skips this account): ",
      );
      if (!password) continue;
      validateStaffPassword(password);
      const confirmation = await hiddenPassword("Repeat new password: ");
      if (confirmation !== password)
        throw new Error(
          "Passwords did not match. No accounts were updated; rerun the command.",
        );
      updates.push({ account, passwordHash: await hash(password, 12) });
    }
    if (!updates.length) {
      console.log("No passwords changed.");
      return;
    }
    console.log(
      `\nReady to update ${updates.length} selected staff account(s) and revoke their old sessions.`,
    );
    const rl = createInterface({ input: stdin, output: stdout });
    let confirmation: string;
    try {
      confirmation = await rl.question("Type UPDATE to apply: ");
    } finally {
      rl.close();
    }
    if (confirmation !== "UPDATE") {
      console.log("Cancelled. No passwords changed.");
      return;
    }
    await updateStaffPasswords(query, updates);
    console.log(
      `Updated ${updates.length} staff password(s). Old sessions revoked and account login throttles cleared. Sign in with the new passwords.`,
    );
  } finally {
    await client.end();
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error: unknown) => {
    if (error instanceof Error && error.constructor === Error)
      console.error(error.message);
    else
      console.error(
        `Staff maintenance failed (${String((error as { code?: string }).code ?? "ERROR").replace(/[^A-Z0-9_]/gi, "")}). No passwords or hashes were logged.`,
      );
    process.exitCode = 1;
  });
}
