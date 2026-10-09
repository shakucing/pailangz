import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { z } from "zod";
import { db, ensureRuntime, type Tx } from "./db";
import { decrypt } from "./crypto";
import { canonicalIgn, DomainError } from "./domain";
import {
  participationFormSchema,
  canonicalTiktokId,
  savedTiktokId,
} from "./participation-form";
import { resizeTeamAvatar } from "./team-avatar";

export const memberCookie = "pailangz_member";
export const memberAccessSchema = participationFormSchema;
export const teamActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("CREATE"),
    name: z
      .string()
      .trim()
      .min(2)
      .max(80)
      .refine((v) => !/[\p{Cc}\p{Cf}]/u.test(v)),
  }),
  z.object({
    action: z.literal("APPLY"),
    teamSlug: z
      .string()
      .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/)
      .max(120),
  }),
  z.object({
    action: z.enum(["APPROVE", "REJECT"]),
    teamSlug: z
      .string()
      .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/)
      .max(120),
    applicationId: z.string().uuid(),
  }),
]);
export type TeamAction = z.infer<typeof teamActionSchema>;
export type TeamEvent = {
  slug: string;
  name: string;
  status: string;
  registrationDeadline: Date | null;
  capacity: number;
  published: boolean;
  format: "SOLO" | "TEAM" | null;
  teamRosterManagement: "PLAYER" | "STAFF";
};
export type PublicTeam = {
  avatarImage: string | null;
  tournamentSlug: string;
  slug: string;
  name: string;
  code: string;
  acceptsApplications: boolean;
  ownerIgn: string | null;
  playerCount: number;
  roster: { ign: string; owner: boolean }[];
};
export type TeamState = {
  ign: string;
  approved: boolean;
  teamSlug: string | null;
  isOwner: boolean;
  application: "PENDING" | "APPROVED" | "REJECTED" | null;
  requests: { id: string; ign: string; status: string; createdAt: string }[];
};
const digest = (s: string) => createHash("sha256").update(s).digest("hex");
const equal = (a: string, b: string) =>
  timingSafeEqual(Buffer.from(digest(a), "hex"), Buffer.from(digest(b), "hex"));
async function portalTx<T>(fn: (tx: Tx) => Promise<T>) {
  await ensureRuntime();
  return db.$transaction(async (tx) => {
    if (process.env.LOCAL_PGLITE === "true")
      await tx.$executeRawUnsafe("SET LOCAL ROLE pailangz_app");
    return fn(tx);
  });
}

export async function startMemberAccess(input: unknown) {
  const fields = memberAccessSchema.parse(input);
  return portalTx(async (tx) => {
    const [record] = await tx.$queryRaw<
      { member_id: string; encrypted_record: string }[]
    >`
      SELECT * FROM app_participation_identity(${canonicalIgn(fields.ign)})
    `;
    const saved: Record<string, unknown> = record
      ? JSON.parse(
          decrypt(record.encrypted_record, `member:${record.member_id}`),
        )
      : {};
    const tiktokMatches = equal(
      savedTiktokId(saved) ?? "",
      canonicalTiktokId(fields.tiktokId),
    );
    if (!record || !tiktokMatches)
      throw new DomainError("VERIFICATION_FAILED", 422);
    const token = randomBytes(32).toString("base64url");
    const [result] = await tx.$queryRaw<{ accepted: boolean }[]>`
      SELECT app_team_start_session(${record.member_id},${record.encrypted_record},${digest(token)}) AS accepted
    `;
    if (!result?.accepted) throw new DomainError("VERIFICATION_FAILED", 422);
    return token;
  });
}
export async function endMemberAccess(token: string) {
  await portalTx(
    (tx) => tx.$executeRaw`SELECT app_team_end_session(${digest(token)})`,
  );
}
export async function teamState(
  token: string | undefined,
  slug: string,
  teamSlug = "",
) {
  if (!token) return null;
  return portalTx(async (tx) => {
    const [result] = await tx.$queryRaw<
      { state: TeamState | null }[]
    >`SELECT app_team_state(${digest(token)},${slug},${teamSlug}) AS state`;
    return result?.state ?? null;
  });
}
export async function mutateTeam(
  token: string | undefined,
  slug: string,
  input: unknown,
  image?: File,
) {
  if (!token) throw new DomainError("SIGN_IN", 401);
  const fields = teamActionSchema.parse(input);
  const event = await publicTeamEvent(slug);
  if (event?.teamRosterManagement === "STAFF")
    throw new DomainError("STAFF_MANAGED", 403);
  let avatarImage: string | null = null;
  if (image) {
    if (fields.action !== "CREATE") throw new DomainError("INVALID_IMAGE", 400);
    // Authorize before decoding an uploaded image; SQL rechecks at commit time.
    const member = await teamState(token, slug);
    if (!member) throw new DomainError("SIGN_IN", 401);
    if (!member.approved) throw new DomainError("NOT_APPROVED", 403);
    if (member.teamSlug) throw new DomainError("ALREADY_IN_TEAM", 409);
    avatarImage = await resizeTeamAvatar(image);
  }
  const id = randomUUID();
  const teamSlug =
    fields.action === "CREATE"
      ? `${
          fields.name
            .normalize("NFKD")
            .replace(/[\u0300-\u036f]/g, "")
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-|-$/g, "")
            .slice(0, 80)
            .replace(/-$/, "") || "team"
        }-${id.slice(0, 8)}`
      : fields.teamSlug;
  return portalTx(async (tx) => {
    type Result = { result: { error?: string; slug: string; status: string } };
    const [row] =
      fields.action === "CREATE"
        ? await tx.$queryRaw<Result[]>`
        SELECT app_team_create_with_avatar(${digest(token)},${slug},${teamSlug},${fields.name},${id},${randomUUID()},${avatarImage}) AS result
      `
        : await tx.$queryRaw<Result[]>`
      SELECT app_team_action(${digest(token)},${slug},${fields.action},${teamSlug},'',${"applicationId" in fields ? fields.applicationId : ""},${id},${randomUUID()}) AS result
    `;
    if (!row) throw new Error("Team action unavailable");
    if (row.result.error)
      throw new DomainError(
        row.result.error,
        row.result.error === "SIGN_IN"
          ? 401
          : ["NOT_APPROVED", "OWNER_ONLY", "STAFF_MANAGED"].includes(
                row.result.error,
              )
            ? 403
            : row.result.error === "NOT_FOUND"
              ? 404
              : 409,
      );
    return row.result;
  });
}
export async function publicTeamEvent(slug: string) {
  if (!process.env.DATABASE_URL) return null;
  await ensureRuntime();
  const rows = await db.$queryRaw<
    TeamEvent[]
  >`SELECT * FROM "PublicTeamEvent" WHERE slug=${slug}`;
  return rows[0] ?? null;
}
export async function publicTeams(slug: string) {
  if (!process.env.DATABASE_URL) return [];
  await ensureRuntime();
  return db.$queryRaw<
    PublicTeam[]
  >`SELECT * FROM "PublicTeamDirectory" WHERE "tournamentSlug"=${slug} ORDER BY code`;
}
export function teamRegistrationOpen(event: TeamEvent) {
  return (
    event.teamRosterManagement !== "STAFF" &&
    !event.published &&
    ["DRAFT", "REGISTRATION_OPEN"].includes(event.status) &&
    (!event.registrationDeadline ||
      new Date(event.registrationDeadline).getTime() > Date.now())
  );
}
