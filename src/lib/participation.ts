import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { db, ensureRuntime } from "./db";
import { decrypt, encrypt } from "./crypto";
import {
  completeParticipationProfile,
  missingParticipationFields,
} from "./participation-profile";
import { phoneInfo } from "./imports";
import { canonicalIgn, DomainError } from "./domain";
import {
  canonicalTiktokId,
  participationSubmissionSchema,
  savedTiktokId,
} from "./participation-form";

export async function submitParticipation(input: unknown) {
  const fields = participationSubmissionSchema.parse(input);
  await ensureRuntime();
  return db.$transaction(async (tx) => {
    if (process.env.LOCAL_PGLITE === "true")
      await tx.$executeRawUnsafe("SET LOCAL ROLE pailangz_app");
    // Only this exact member's ciphertext is available to the server. Neither
    // it nor any saved contact details are returned through the public API.
    const [member] = await tx.$queryRaw<
      { member_id: string; encrypted_record: string }[]
    >`
      SELECT * FROM app_participation_identity(${canonicalIgn(fields.ign)})
    `;
    const payload: Record<string, unknown> = member
      ? JSON.parse(
          decrypt(member.encrypted_record, `member:${member.member_id}`),
        )
      : {};
    const saved = savedTiktokId(payload);
    const digest = (value: string) =>
      createHash("sha256").update(value).digest();
    const matches = timingSafeEqual(
      digest(saved ?? ""),
      digest(canonicalTiktokId(fields.tiktokId)),
    );
    if (!member || !saved || !matches)
      throw new DomainError("VERIFICATION_FAILED", 422);
    if (fields.action === "CHECK") {
      const [status] = await tx.$queryRaw<
        { status: string }[]
      >`SELECT app_participation_status(${fields.tournamentSlug}) AS status`;
      if (status?.status === "CLOSED") throw new DomainError("CLOSED", 409);
      if (status?.status === "FULL") throw new DomainError("FULL", 409);
      return { missingFields: missingParticipationFields(payload) };
    }
    // Validate after the entry function checks lifecycle/capacity. Any missing
    // answer rolls the whole transaction back, including the reserved slot.
    const [locked] = await tx.$queryRaw<{ accepted: boolean }[]>`
      SELECT app_lock_participation_identity(${member.member_id}, ${canonicalIgn(fields.ign)}, ${member.encrypted_record}) AS accepted
    `;
    if (!locked?.accepted) throw new DomainError("VERIFICATION_FAILED", 422);
    const [result] = await tx.$queryRaw<{ result: string }[]>`
      SELECT app_submit_participation(
        ${fields.tournamentSlug}, ${randomUUID()}, ${member.member_id}, ${canonicalIgn(fields.ign)},
        ${member.encrypted_record}, ${randomUUID()}
      ) AS result
    `;
    if (result?.result === "WITHDRAWN") throw new DomainError("WITHDRAWN", 409);
    if (result?.result === "CLOSED") throw new DomainError("CLOSED", 409);
    if (result?.result === "FULL") throw new DomainError("FULL", 409);
    if (result?.result !== "ACCEPTED")
      throw new DomainError("VERIFICATION_FAILED", 422);
    const [event] = await tx.$queryRaw<{ format: string | null }[]>`
      SELECT format FROM "PublicTournamentRegistration" WHERE slug=${fields.tournamentSlug}
    `;
    if (event?.format === "SOLO") {
      const required = (
        ["soloTermsRead", "soloIgnDisplayConsent"] as const
      ).filter((name) => !fields[name]);
      if (required.length)
        throw new z.ZodError(
          required.map((name) => ({
            code: "custom",
            path: [name],
            message: "Required acknowledgment",
          })),
        );
    }
    const completed = completeParticipationProfile(payload, fields.profile);
    if (completed.changedFields.length) {
      const phoneChanged = completed.changedFields.includes("whatsapp");
      const phone = phoneInfo(
        fields.profile.whatsapp ?? "",
        String(payload.Country ?? ""),
      );
      await tx.$executeRaw`SELECT app_complete_participation_profile(
        ${member.member_id}, ${member.encrypted_record},
        ${encrypt(JSON.stringify(completed.payload), `member:${member.member_id}`)},
        ${phoneChanged}, ${phoneChanged && phone.phone ? encrypt(phone.phone, `member-phone:${member.member_id}`) : null},
        ${phone.lastFour}, ${phone.issue}, ${completed.changedFields}::text[], ${randomUUID()}
      )`;
    }
    return { accepted: true as const };
  });
}
