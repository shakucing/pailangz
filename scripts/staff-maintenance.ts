import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import { stdin, stdout } from "node:process";
import { hash, truncates } from "bcryptjs";
import { parse } from "dotenv";
import pg from "pg";
import { canonical } from "./neon-transfer";

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

export function maintenanceTarget(flags: string[]) {
  const choices = flags.filter((flag) =>
    ["--local", "--test", "--production", "--neon"].includes(flag),
  );
  if (choices.length !== 1)
    throw new Error(
      "Choose exactly one of --local, --test or --production (--neon is a production alias).",
    );
  const local = choices[0] === "--local";
  const test = choices[0] === "--test";
  return {
    local,
    tier: local ? "development" : test ? "preview" : "production",
    label: local ? "local development" : test ? "Neon test" : "Neon production",
    file: local
      ? ".env"
      : path.join(
          test ? ".local/test-transfer" : ".local/neon-transfer",
          "target.env",
        ),
  };
}

const cleanupTables = [
  "StaffUser",
  "StaffSession",
  "AuthThrottle",
  "AuditEvent",
  "DevelopmentAuditActor",
];
type CleanupState = Record<string, Record<string, unknown>[]>;
const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;
const sorted = (rows: Record<string, unknown>[]) => rows.map(canonical).sort();
const sameRows = (a: Record<string, unknown>[], b: Record<string, unknown>[]) =>
  canonical(sorted(a)) === canonical(sorted(b));

export async function qaCleanupState(query: Query): Promise<CleanupState> {
  const state: CleanupState = {};
  for (const name of cleanupTables) {
    const result = await query(
      `SELECT to_jsonb(t) AS row FROM public.${quote(name)} t`,
    );
    state[name] = result.rows.map(
      (item) => item.row as Record<string, unknown>,
    );
  }
  return state;
}

function eventAccounts(event: Record<string, unknown>) {
  const changes = event.changes as Record<string, unknown> | null;
  return Array.isArray(changes?.accountIds)
    ? changes.accountIds.filter((id): id is string => typeof id === "string")
    : [];
}

export function qaCleanupPlan(state: CleanupState) {
  const staff = state.StaffUser as StaffAccount[];
  const accounts = staff.filter(disposableQa);
  const accountIds = new Set(accounts.map((account) => account.id));
  const realIds = new Set(
    staff
      .filter((account) => !accountIds.has(account.id))
      .map((account) => account.id),
  );
  const verifiedIds = new Set([
    ...accountIds,
    ...state.DevelopmentAuditActor.map((row) => String(row.id)).filter(
      (id) => !realIds.has(id),
    ),
  ]);
  const related = (event: Record<string, unknown>) => {
    const ids = eventAccounts(event);
    const references = Array.isArray(event.relatedIds)
      ? (event.relatedIds as string[])
      : [];
    return (
      verifiedIds.has(String(event.actorId)) ||
      (["STAFF", "SECURITY"].includes(String(event.entityType)) &&
        verifiedIds.has(String(event.entityId))) ||
      ids.some((id) => verifiedIds.has(id)) ||
      references.some((id) => verifiedIds.has(id))
    );
  };
  const mixed = (event: Record<string, unknown>) => {
    const ids = eventAccounts(event);
    const references = Array.isArray(event.relatedIds)
      ? (event.relatedIds as string[])
      : [];
    return (
      (ids.some((id) => verifiedIds.has(id)) &&
        ids.some((id) => !verifiedIds.has(id))) ||
      (references.some((id) => verifiedIds.has(id)) &&
        references.some((id) => realIds.has(id)))
    );
  };
  const audit = state.AuditEvent.filter(
    (event) => related(event) && !mixed(event),
  );
  const auditIds = new Set(audit.map((event) => String(event.id)));
  const remainingAudit = state.AuditEvent.filter(
    (event) => !auditIds.has(String(event.id)),
  );
  const markerIds = state.DevelopmentAuditActor.map((row) =>
    String(row.id),
  ).filter(
    (id) =>
      verifiedIds.has(id) &&
      !remainingAudit.some(
        (event) =>
          event.actorId === id ||
          event.entityId === id ||
          eventAccounts(event).includes(id) ||
          (Array.isArray(event.relatedIds) && event.relatedIds.includes(id)),
      ),
  );
  const throttles = new Set(accounts.map((account) => loginKey(account.email)));
  return {
    accounts,
    accountIds: [...accountIds],
    auditIds: [...auditIds],
    markerIds,
    throttleKeys: [...throttles],
    counts: {
      staff: accounts.length,
      sessions: state.StaffSession.filter((row) =>
        accountIds.has(String(row.userId)),
      ).length,
      throttles: state.AuthThrottle.filter((row) =>
        throttles.has(String(row.key)),
      ).length,
      audit: audit.length,
      markers: markerIds.length,
      mixedAuditRetained: state.AuditEvent.filter(
        (event) => related(event) && mixed(event),
      ).length,
    },
  };
}

export type QaCleanupBackup = {
  format: "pailangz-qa-cleanup-v1";
  capturedAt: string;
  tier: string;
  tables: CleanupState;
  counts: ReturnType<typeof qaCleanupPlan>["counts"];
  checksum: string;
};

async function otherTableDigests(query: Query) {
  const tables = await query(
    "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename",
  );
  const result: Record<string, string> = {};
  for (const row of tables.rows) {
    const name = String(row.tablename);
    if (cleanupTables.includes(name)) continue;
    const records = await query(
      `SELECT to_jsonb(t) AS row FROM public.${quote(name)} t`,
    );
    result[name] = createHash("sha256")
      .update(
        canonical(
          sorted(
            records.rows.map((item) => item.row as Record<string, unknown>),
          ),
        ),
      )
      .digest("hex");
  }
  return result;
}

export async function purgeDisposableStaff(
  query: Query,
  expectedTier: string,
  saveBackup: (backup: QaCleanupBackup) => Promise<void>,
) {
  await query("BEGIN ISOLATION LEVEL SERIALIZABLE");
  try {
    await query("SET LOCAL TIME ZONE 'UTC'");
    await query("SET LOCAL lock_timeout = '10s'");
    await query(
      `LOCK TABLE ${cleanupTables.map(quote).join(",")} IN ACCESS EXCLUSIVE MODE`,
    );
    const identity = await query(
      'SELECT tier,(SELECT pg_get_userbyid(relowner)=current_user FROM pg_class WHERE oid=\'"StaffUser"\'::regclass) AS owns_staff,(SELECT pg_get_userbyid(relowner)=current_user FROM pg_class WHERE oid=\'"AuditEvent"\'::regclass) AS owns_audit FROM "DeploymentEnvironment"',
    );
    if (
      identity.rows[0]?.tier !== expectedTier ||
      !identity.rows[0]?.owns_staff ||
      !identity.rows[0]?.owns_audit
    )
      throw new Error(
        "QA audit purge requires the owner of both tables in the selected environment.",
      );
    const before = await qaCleanupState(query);
    const plan = qaCleanupPlan(before);
    if (!plan.counts.staff && !plan.counts.audit && !plan.counts.markers) {
      await query("COMMIT");
      return {
        counts: plan.counts,
        before: Object.fromEntries(
          cleanupTables.map((name) => [name, before[name].length]),
        ),
        after: Object.fromEntries(
          cleanupTables.map((name) => [name, before[name].length]),
        ),
        changed: false,
      };
    }
    const trigger = await query(
      "SELECT tgenabled FROM pg_trigger WHERE tgrelid='\"AuditEvent\"'::regclass AND tgname='immutable_audit' AND NOT tgisinternal",
    );
    const triggerMode = String(trigger.rows[0]?.tgenabled);
    const restore = (
      { O: "ENABLE", R: "ENABLE REPLICA", A: "ENABLE ALWAYS" } as Record<
        string,
        string
      >
    )[triggerMode];
    if (!restore)
      throw new Error(
        "Audit immutability must already be enabled before an operator purge.",
      );
    const untouched = await otherTableDigests(query);
    const payload = {
      format: "pailangz-qa-cleanup-v1" as const,
      capturedAt: new Date().toISOString(),
      tier: expectedTier,
      tables: before,
      counts: plan.counts,
    };
    const backup = {
      ...payload,
      checksum: createHash("sha256").update(canonical(payload)).digest("hex"),
    };
    // A failed backup aborts before any records or protections change.
    await saveBackup(backup);
    await query('DELETE FROM "StaffSession" WHERE "userId"=ANY($1::text[])', [
      plan.accountIds,
    ]);
    await query('DELETE FROM "AuthThrottle" WHERE key=ANY($1::text[])', [
      plan.throttleKeys,
    ]);
    await query('DELETE FROM "StaffUser" WHERE id=ANY($1::text[])', [
      plan.accountIds,
    ]);
    await query('ALTER TABLE "AuditEvent" DISABLE TRIGGER immutable_audit');
    await query('DELETE FROM "AuditEvent" WHERE id=ANY($1::text[])', [
      plan.auditIds,
    ]);
    await query(`ALTER TABLE "AuditEvent" ${restore} TRIGGER immutable_audit`);
    await query(
      'DELETE FROM "DevelopmentAuditActor" WHERE id=ANY($1::text[])',
      [plan.markerIds],
    );
    const receiptId = randomUUID();
    await query(
      "INSERT INTO \"AuditEvent\" (id,\"actorRole\",action,\"entityType\",\"entityId\",changes,reason,\"correlationId\",source,outcome) VALUES ($1,'SYSTEM','STAFF_QA_CLEANUP','STAFF','staff-maintenance',$2::jsonb,'Operator requested removal of verified disposable staff and their QA audit history.',$3,'CLI','SUCCESS')",
      [
        receiptId,
        JSON.stringify({
          removedStaff: plan.counts.staff,
          removedSessions: plan.counts.sessions,
          removedLoginThrottles: plan.counts.throttles,
          removedAuditEvents: plan.counts.audit,
          retainedMixedAuditEvents: plan.counts.mixedAuditRetained,
          backupChecksum: backup.checksum,
        }),
        randomUUID(),
      ],
    );
    const after = await qaCleanupState(query);
    const expected: CleanupState = {
      StaffUser: before.StaffUser.filter(
        (row) => !plan.accountIds.includes(String(row.id)),
      ),
      StaffSession: before.StaffSession.filter(
        (row) => !plan.accountIds.includes(String(row.userId)),
      ),
      AuthThrottle: before.AuthThrottle.filter(
        (row) => !plan.throttleKeys.includes(String(row.key)),
      ),
      AuditEvent: before.AuditEvent.filter(
        (row) => !plan.auditIds.includes(String(row.id)),
      ),
      DevelopmentAuditActor: before.DevelopmentAuditActor.filter(
        (row) => !plan.markerIds.includes(String(row.id)),
      ),
    };
    for (const name of cleanupTables) {
      const actual =
        name === "AuditEvent"
          ? after[name].filter((row) => row.id !== receiptId)
          : after[name];
      if (!sameRows(expected[name], actual))
        throw new Error(
          `QA purge verification failed for ${name}; transaction rolled back.`,
        );
    }
    if (
      after.AuditEvent.filter((row) => row.id === receiptId).length !== 1 ||
      canonical(await otherTableDigests(query)) !== canonical(untouched)
    )
      throw new Error(
        "QA purge verification failed; other application records must be unchanged.",
      );
    const finalTrigger = await query(
      "SELECT tgenabled FROM pg_trigger WHERE tgrelid='\"AuditEvent\"'::regclass AND tgname='immutable_audit'",
    );
    if (finalTrigger.rows[0]?.tgenabled !== triggerMode)
      throw new Error(
        "Audit immutability was not restored; transaction rolled back.",
      );
    await query("COMMIT");
    return {
      counts: plan.counts,
      before: Object.fromEntries(
        cleanupTables.map((name) => [name, before[name].length]),
      ),
      after: Object.fromEntries(
        cleanupTables.map((name) => [name, after[name].length]),
      ),
      changed: true,
    };
  } catch (error) {
    await query("ROLLBACK");
    throw error;
  }
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
    flags.some(
      (flag) =>
        ![
          "--neon",
          "--production",
          "--test",
          "--local",
          "--apply",
          "--purge-audit",
        ].includes(flag),
    ) ||
    ((flags.includes("--apply") || flags.includes("--purge-audit")) &&
      action !== "cleanup")
  )
    throw new Error(
      "Choose --local, --test or --production. Only cleanup accepts --apply and --purge-audit. Passwords are prompted privately, never passed as arguments.",
    );
  const target = maintenanceTarget(flags);
  const neon = !target.local;
  const env = parse(await readFile(target.file));
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
    if (identity.rows[0]?.tier !== target.tier || !identity.rows[0]?.owns_staff)
      throw new Error(
        "The connection must be the table owner in the selected database environment.",
      );
    if (action === "cleanup" && flags.includes("--purge-audit")) {
      await query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      let state: CleanupState;
      try {
        await query("SET LOCAL TIME ZONE 'UTC'");
        state = await qaCleanupState(query);
        await query("COMMIT");
      } catch (error) {
        await query("ROLLBACK");
        throw error;
      }
      const plan = qaCleanupPlan(state);
      const describe = (counts: Record<string, number>) =>
        Object.entries(counts)
          .map(([name, count]) => `${name}=${count}`)
          .join(", ");
      console.log(`Target: ${target.label} (${target.tier}).`);
      console.log(
        `Before: ${describe(Object.fromEntries(cleanupTables.map((name) => [name, state[name].length])))}`,
      );
      console.log(`Plan: ${describe(plan.counts)}`);
      if (!flags.includes("--apply")) {
        console.log(
          "Preview only. Add --apply to back up and remove verified QA staff and QA-only audit history. Mixed staff history is retained.",
        );
        return;
      }
      let backupFile = "";
      const result = await purgeDisposableStaff(
        query,
        target.tier,
        async (backup) => {
          const directory = path.resolve(".local/qa-cleanup", target.tier);
          await mkdir(directory, { recursive: true, mode: 0o700 });
          await chmod(directory, 0o700);
          backupFile = path.join(
            directory,
            `${backup.capturedAt.replace(/[:.]/g, "-")}-${randomUUID()}.json`,
          );
          const text = JSON.stringify(backup, null, 2) + "\n";
          await writeFile(backupFile, text, { mode: 0o600, flag: "wx" });
          await chmod(backupFile, 0o600);
          if (
            canonical(JSON.parse(await readFile(backupFile, "utf8"))) !==
            canonical(backup)
          )
            throw new Error(
              "Private backup verification failed; no cleanup was applied.",
            );
          console.log(`Backup: ${backupFile} (mode 0600).`);
        },
      );
      console.log(`Removed: ${describe(result.counts)}`);
      console.log(`After: ${describe(result.after)}`);
      console.log(
        result.changed
          ? "Verified retained staff, sessions, throttles and audit rows; all other application records unchanged; audit immutability restored. One cleanup receipt retained."
          : "No verified QA accounts or QA-only audit records remain; no changes made.",
      );
      return;
    }
    const all = (
      await query(
        `SELECT ${columns} FROM "StaffUser" ORDER BY suspended,name,id`,
      )
    ).rows as StaffAccount[];
    const qa = all.filter(disposableQa);
    const active = all.filter((account) => !account.suspended);
    console.log(
      `Target: ${target.label}. ${active.length} active staff; ${qa.length} suspended disposable QA accounts.`,
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
