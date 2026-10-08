import { hash } from "bcryptjs";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { privateTx, audit, rateLimit, type Actor } from "./db";
import { DomainError } from "./domain";

const name = z.string().trim().min(1).max(100);
const email = z.string().trim().toLowerCase().pipe(z.email().max(254));
const role = z.enum(["ADMIN", "MODERATOR"]);
const password = z
  .string()
  .min(14)
  .max(200)
  .refine(
    (value) =>
      Buffer.byteLength(value, "utf8") <= 72 && !/[\r\n\u0000]/.test(value),
    "Use a password of at least 14 characters and at most 72 UTF-8 bytes, without line breaks.",
  );
export const staffCreateSchema = z.object({
  name,
  email,
  role,
  password,
});
export const staffResetPasswordSchema = z.object({
  id: z.string().uuid(),
  password,
});
export async function staffResetPassword(actor: Actor, value: unknown) {
  adminOnly(actor);
  const input = staffResetPasswordSchema.parse(value);
  if (input.id === actor.id)
    throw new DomainError(
      "Ask another admin or the site operator to reset your password.",
    );
  await rateLimit(`staff-password-reset:${actor.id}`, 10, 60);
  const passwordHash = await hash(input.password, 12);
  return privateTx(actor, async (tx) => {
    const target = await tx.staffUser.findUniqueOrThrow({
      where: { id: input.id },
      select: { name: true, role: true },
    });
    await tx.$executeRaw`SELECT app_reset_staff_password(${input.id},${passwordHash})`;
    await audit(tx, actor, "STAFF_PASSWORD_RESET", "STAFF", input.id, {
      name: target.name,
      role: target.role,
      sessionsRevoked: true,
    });
    return { id: input.id };
  });
}
export const staffEditSchema = z.object({
  id: z.string().uuid(),
  name: name.optional(),
  email: email.optional(),
  role,
  suspended: z.boolean(),
});
export const staffRemoveSchema = z.object({ id: z.string().uuid() });

function adminOnly(actor: Actor) {
  if (actor.role !== "ADMIN")
    throw new DomainError("Admin permission is required.", 403);
}
async function accountWrite(write: () => Promise<unknown>) {
  try {
    await write();
  } catch (e) {
    const error = e as {
      code?: string;
      meta?: {
        code?: string;
        driverAdapterError?: {
          cause?: { originalCode?: string; kind?: string };
        };
      };
    };
    const cause = error.meta?.driverAdapterError?.cause;
    if (
      error.code === "P2002" ||
      error.meta?.code === "23505" ||
      cause?.originalCode === "23505" ||
      cause?.kind === "UniqueConstraintViolation"
    )
      throw new DomainError("That staff email is already in use.", 409);
    throw e;
  }
}
export async function staffCreate(actor: Actor, value: unknown) {
  adminOnly(actor);
  const input = staffCreateSchema.parse(value);
  // Bound expensive password hashing before opening a database transaction.
  await rateLimit(`staff-create:${actor.id}`, 10, 60);
  const passwordHash = await hash(input.password, 12);
  const id = randomUUID();
  return privateTx(actor, async (tx) => {
    await accountWrite(
      () =>
        tx.$executeRaw`SELECT app_create_staff(${id},${input.email},${input.name},${passwordHash},${input.role}::"StaffRole")`,
    );
    await audit(tx, actor, "STAFF_CREATE", "STAFF", id, {
      name: input.name,
      role: input.role,
      suspended: false,
      authenticationMethod: "password",
    });
    return { id };
  });
}
export async function staffEdit(actor: Actor, value: unknown) {
  adminOnly(actor);
  const input = staffEditSchema.parse(value);
  if (input.id === actor.id)
    throw new DomainError("Manage your own account through the site operator.");
  return privateTx(actor, async (tx) => {
    const before = await tx.staffUser.findUniqueOrThrow({
      where: { id: input.id },
      select: { name: true, email: true, role: true, suspended: true },
    });
    const next = { ...before, ...input };
    await accountWrite(
      () =>
        tx.$executeRaw`SELECT app_edit_staff(${input.id},${next.email},${next.name},${next.role}::"StaffRole",${next.suspended})`,
    );
    await audit(tx, actor, "STAFF_PERMISSION_CHANGE", "STAFF", input.id, {
      before: {
        name: before.name,
        role: before.role,
        suspended: before.suspended,
      },
      after: { name: next.name, role: next.role, suspended: next.suspended },
      emailChanged: before.email !== next.email,
      sessionsRevoked: true,
    });
    return { id: input.id };
  });
}
export async function staffRemove(actor: Actor, value: unknown) {
  adminOnly(actor);
  const { id } = staffRemoveSchema.parse(value);
  if (id === actor.id)
    throw new DomainError("You cannot delete your own account.");
  return privateTx(actor, async (tx) => {
    const before = await tx.staffUser.findUniqueOrThrow({
      where: { id },
      select: { name: true, role: true, suspended: true },
    });
    await tx.$executeRaw`SELECT app_remove_staff(${id})`;
    await audit(tx, actor, "STAFF_DELETE", "STAFF", id, {
      before,
      sessionsRemoved: true,
    });
    return { id };
  });
}
