import { randomUUID } from "node:crypto";
import { db, ensureRuntime } from "./db";
import { encrypt } from "./crypto";
import { canonicalIgn } from "./domain";
import { phoneInfo } from "./imports";
import {
  registrationFormSchema,
  registrationPayload,
} from "./registration-form";

export async function submitRegistration(input: unknown) {
  const fields = registrationFormSchema.parse(input);
  const payload = registrationPayload(fields);
  const phone = phoneInfo(fields.whatsapp, fields.country);
  const id = fields.requestId;
  await ensureRuntime();
  // This insert-only database function cannot read private records, approve a
  // member, alter an existing member, or create staff/tournament access.
  await db.$transaction(async (tx) => {
    if (process.env.LOCAL_PGLITE === "true")
      await tx.$executeRawUnsafe("SET LOCAL ROLE pailangz_app");
    await tx.$queryRaw`SELECT app_submit_registration(
      ${id}, ${randomUUID()}, ${fields.ign}, ${canonicalIgn(fields.ign)},
      ${encrypt(JSON.stringify(payload), `submission:${id}`)},
      ${phone.phone ? encrypt(phone.phone, `submission-phone:${id}`) : null},
      ${phone.lastFour}, ${phone.issue}, ${randomUUID()}, ${randomUUID()}
    )`;
  });
}
