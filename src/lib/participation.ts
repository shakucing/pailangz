import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { db, ensureRuntime } from "./db";
import { decrypt } from "./crypto";
import { canonicalIgn, DomainError } from "./domain";
import {
  canonicalTiktokId,
  participationSubmissionSchema,
  savedTiktokId,
} from "./participation-form";

export async function submitParticipation(input: unknown) {
  const fields = participationSubmissionSchema.parse(input);
  await ensureRuntime();
  await db.$transaction(async (tx) => {
    if (process.env.LOCAL_PGLITE === "true")
      await tx.$executeRawUnsafe("SET LOCAL ROLE pailangz_app");
    // Only this exact member's ciphertext is available to the server. Neither
    // it nor any saved contact details are returned through the public API.
    const [member] = await tx.$queryRaw<
      { member_id: string; encrypted_record: string }[]
    >`
      SELECT * FROM app_participation_identity(${canonicalIgn(fields.ign)})
    `;
    const saved = member
      ? savedTiktokId(
          JSON.parse(
            decrypt(member.encrypted_record, `member:${member.member_id}`),
          ),
        )
      : undefined;
    const digest = (value: string) =>
      createHash("sha256").update(value).digest();
    const matches = timingSafeEqual(
      digest(saved ?? ""),
      digest(canonicalTiktokId(fields.tiktokId)),
    );
    if (!member || !saved || !matches)
      throw new DomainError("VERIFICATION_FAILED", 422);
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
  });
}
