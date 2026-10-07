import { PrismaClient, Prisma } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { DomainError } from "./domain";
import { randomUUID } from "node:crypto";
export type Tx = Prisma.TransactionClient;
export type Actor = {
  id: string;
  role: "ADMIN" | "MODERATOR";
  sessionId: string;
  authenticatedAt: Date;
};
export function assertEnvironment() {
  const app =
    process.env.VERCEL_ENV === "preview"
      ? "preview"
      : (process.env.APP_ENV ?? "development");
  if (
    process.env.LOCAL_PGLITE === "true" &&
    (app !== "development" || process.env.VERCEL)
  )
    throw new Error(
      "PGlite owner access is only permitted in synthetic local development.",
    );
  if (
    (app === "preview" || app === "development") &&
    process.env.DATABASE_ENV === "production"
  )
    throw new Error("Non-production cannot access the production database.");
  if (app === "production") {
    if (process.env.DATABASE_ENV !== "production")
      throw new Error("Production database environment is required.");
    if (
      new URL(process.env.NEXTAUTH_URL ?? "http://localhost").protocol !==
      "https:"
    )
      throw new Error("Production authentication requires HTTPS.");
    const url = new URL(process.env.DATABASE_URL ?? "");
    if (
      !["require", "verify-full"].includes(
        url.searchParams.get("sslmode") ?? "",
      )
    )
      throw new Error("Production database TLS is required.");
    if (process.env.EVIDENCE_STORAGE !== "s3")
      throw new Error(
        "Production requires persistent private S3 evidence storage.",
      );
  }
}
assertEnvironment();
const globalDb = globalThis as unknown as { pailangzDb?: PrismaClient };
export const db =
  globalDb.pailangzDb ??
  new PrismaClient({
    adapter: new PrismaPg({
      options: "-c timezone=UTC",
      connectionString:
        process.env.DATABASE_URL ?? "postgresql://localhost:5432/pailangz",
      max: process.env.LOCAL_PGLITE === "true" ? 1 : 5,
    }),
  });
if (process.env.NODE_ENV !== "production") globalDb.pailangzDb = db;
let runtimeCheck: Promise<void> | undefined;
let runtimeCheckKey = "";
export async function ensureRuntime() {
  assertEnvironment();
  const key = [
    process.env.APP_ENV,
    process.env.VERCEL_ENV,
    process.env.DATABASE_URL,
  ].join("|");
  if (key !== runtimeCheckKey) {
    runtimeCheck = undefined;
    runtimeCheckKey = key;
  }
  if (!runtimeCheck)
    runtimeCheck = (async () => {
      const rows = await db.$queryRaw<
        { role: string; tier: string; bypass: boolean }[]
      >`SELECT current_user AS role,tier,(SELECT rolbypassrls FROM pg_roles WHERE rolname=current_user) AS bypass FROM "DeploymentEnvironment"`;
      const row = rows[0],
        tier =
          process.env.VERCEL_ENV === "preview"
            ? "preview"
            : (process.env.APP_ENV ?? "development");
      if (!row || row.tier !== tier)
        throw new Error(
          "Actual database environment does not match the deployment.",
        );
      if (
        process.env.LOCAL_PGLITE !== "true" &&
        (row.role !== "pailangz_app" || row.bypass)
      )
        throw new Error("Runtime must use the non-owner pailangz_app role.");
    })();
  try {
    await runtimeCheck;
  } catch (e) {
    runtimeCheck = undefined;
    throw e;
  }
}
export async function privateTx<T>(actor: Actor, fn: (tx: Tx) => Promise<T>) {
  await ensureRuntime();
  return db.$transaction(
    async (tx) => {
      if (process.env.LOCAL_PGLITE === "true")
        await tx.$executeRawUnsafe("SET LOCAL ROLE pailangz_app");
      await tx.$executeRaw`SELECT set_config('app.actor_id', ${actor.id}, true),set_config('app.session_id', ${actor.sessionId}, true)`;
      const valid = await tx.$queryRaw<
        { allowed: boolean }[]
      >`SELECT app_staff_allowed() AS allowed`;
      if (!valid[0]?.allowed)
        throw new DomainError("Staff access has been revoked.", 403);
      return fn(tx);
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      timeout: 20000,
    },
  );
}
export async function serializable<T>(fn: (tx: Tx) => Promise<T>) {
  return db.$transaction(fn, {
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    timeout: 20000,
  });
}
function scrub(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(scrub);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [
        k,
        /password|secret|token|phone|whatsapp|payload|registration|note|contact|email|discord|tiktok|province|country/i.test(
          k,
        )
          ? "[redacted]"
          : scrub(v),
      ]),
    );
  if (typeof value === "string")
    return value.replace(/\+?\d[\d\s()-]{7,}\d/g, "[redacted]");
  return value;
}
export async function audit(
  tx: Tx,
  actor: Actor | null,
  action: string,
  entityType: string,
  entityId: string,
  changes: unknown = {},
  reason?: string,
  extra: {
    source?: string;
    tournamentId?: string;
    stageId?: string;
    outcome?: string;
    relatedIds?: string[];
  } = {},
) {
  await tx.auditEvent.create({
    data: {
      actorId: actor?.id,
      actorRole: actor?.role ?? "SYSTEM",
      action,
      entityType,
      entityId,
      changes: scrub(changes) as Prisma.InputJsonValue,
      reason: reason ? (scrub(reason) as string) : undefined,
      correlationId: randomUUID(),
      source: extra.source ?? "UI",
      ...extra,
    },
  });
}
export async function securityEvent(
  action: string,
  entityId: string,
  actorId?: string,
  outcome = "FAILURE",
) {
  // Auth events may be written without a staff session, but cannot be read back.
  await db.auditEvent.createMany({
    data: {
      actorId,
      actorRole: "AUTH",
      action,
      entityType: "SECURITY",
      entityId,
      changes: {},
      correlationId: randomUUID(),
      source: "AUTH",
      outcome,
    },
  });
}
export async function rateLimit(key: string, limit: number, seconds: number) {
  const rows = await db.$queryRaw<
    { count: number }[]
  >`INSERT INTO "AuthThrottle" (key,count,"windowStart") VALUES (${key},1,now()) ON CONFLICT (key) DO UPDATE SET count=CASE WHEN "AuthThrottle"."windowStart" < now()-make_interval(secs=>${seconds}) THEN 1 ELSE "AuthThrottle".count+1 END,"windowStart"=CASE WHEN "AuthThrottle"."windowStart" < now()-make_interval(secs=>${seconds}) THEN now() ELSE "AuthThrottle"."windowStart" END RETURNING count`;
  if (rows[0].count > limit)
    throw new DomainError("Too many attempts. Try again later.", 429);
}
