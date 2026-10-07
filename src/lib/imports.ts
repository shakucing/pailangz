import { parse } from "csv-parse/sync";
import { createHash, randomUUID } from "node:crypto";
import {
  parsePhoneNumberFromString,
  type CountryCode,
} from "libphonenumber-js/max";
import { z } from "zod";
import { canonicalIgn, ignSchema, DomainError, optionalNote } from "./domain";
import { encrypt, decrypt } from "./crypto";
import { privateTx, audit, type Actor, type Tx } from "./db";
export const FORM_HEADERS = [
  "Timestamp",
  "IGN",
  "Whatsapp Number",
  "Tiktok username",
  "Tiktok ID",
  "Discord Name",
  "Discord ID",
  "State/Province",
  "Country",
  "status",
];
export const DEFAULT_MAPPING = {
  ign: "IGN",
  phone: "Whatsapp Number",
  country: "Country",
};
export function phoneInfo(raw: string, country: string) {
  if (!raw.trim()) return { issue: "MISSING", phone: null, lastFour: null };
  const policy = (process.env.PHONE_DEFAULT_COUNTRY ?? "MY") as CountryCode;
  const code = /^[A-Z]{2}$/.test(country)
    ? (country as CountryCode)
    : country.toLowerCase() === "malaysia"
      ? "MY"
      : policy;
  const phone = parsePhoneNumberFromString(raw, code);
  return {
    issue: phone?.isValid() ? null : "INVALID_REQUIRES_REVIEW",
    phone: raw,
    lastFour: raw.replace(/\D/g, "").slice(-4),
  };
}
export function csvRows(csv: string) {
  if (Buffer.byteLength(csv) > 2_000_000)
    throw new DomainError("CSV must be under 2 MB.");
  const rows = parse(csv, {
    columns: (headers: string[]) => {
      if (new Set(headers).size !== headers.length)
        throw new DomainError("CSV headers must be unique.");
      return headers;
    },
    bom: true,
    skip_empty_lines: true,
    max_record_size: 20000,
    relax_column_count: false,
  }) as Record<string, string>[];
  if (rows.length > 1000)
    throw new DomainError("Import at most 1,000 rows per job.");
  return rows;
}
export async function ingest(
  actor: Actor,
  rows: Record<string, string>[],
  source: string,
  filename?: string,
) {
  return privateTx(actor, async (tx) => {
    const settings = await tx.integrationSetting.findUnique({
      where: { key: "formMapping" },
    });
    const mapping = z
      .object({ ign: z.string(), phone: z.string(), country: z.string() })
      .parse(settings?.value ?? DEFAULT_MAPPING);
    const job = await tx.importJob.create({
      data: { source, filename, actorId: actor.id, rowCount: rows.length },
    });
    let created = 0,
      skipped = 0,
      conflicts = 0;
    for (const row of rows) {
      const originalIgn = row[mapping.ign] ?? "";
      let displayIgn: string, canonical: string;
      try {
        displayIgn = ignSchema.parse(originalIgn);
        canonical = canonicalIgn(displayIgn);
      } catch {
        displayIgn = originalIgn.slice(0, 80) || "(missing IGN)";
        canonical = `invalid:${randomUUID()}`;
      }
      const reference =
        row.response_id?.trim() ||
        `content-sha256:${createHash("sha256")
          .update(
            JSON.stringify(
              Object.keys(row)
                .sort()
                .map((k) => [k, row[k]]),
            ),
          )
          .digest("hex")}`;
      if (
        await tx.registrationSubmission.findUnique({
          where: {
            source_sourceResponseId: { source, sourceResponseId: reference },
          },
        })
      ) {
        skipped++;
        continue;
      }
      const id = randomUUID(),
        phone = phoneInfo(row[mapping.phone] ?? "", row[mapping.country] ?? "");
      const member = await tx.member.findUnique({
        where: { canonicalIgn: canonical },
      });
      const pending = await tx.registrationSubmission.findFirst({
        where: {
          canonicalIgn: canonical,
          status: { in: ["PENDING", "NEEDS_CLARIFICATION"] },
        },
      });
      const invalid = canonical.startsWith("invalid:");
      await tx.registrationSubmission.create({
        data: {
          id,
          source,
          sourceResponseId: reference,
          importJobId: job.id,
          originalIgn,
          displayIgn,
          canonicalIgn: canonical,
          payloadEncrypted: encrypt(JSON.stringify(row), `submission:${id}`),
          phoneEncrypted: phone.phone
            ? encrypt(phone.phone, `submission-phone:${id}`)
            : null,
          phoneLastFour: phone.lastFour,
          phoneIssue: phone.issue,
          status: invalid ? "NEEDS_CLARIFICATION" : "PENDING",
          conflicts:
            member || pending || invalid
              ? {
                  create: {
                    existingMemberId: member?.id,
                    reason: invalid
                      ? "Missing or invalid IGN"
                      : member
                        ? "Canonical IGN already exists; explicit linking required."
                        : "Canonical IGN is already in the review inbox; resolve the conflict explicitly.",
                  },
                }
              : undefined,
        },
      });
      created++;
      if (member || pending || invalid) conflicts++;
      await audit(
        tx,
        actor,
        "REGISTRATION_INGEST",
        "SUBMISSION",
        id,
        { changedFields: Object.keys(row), conflict: !!member || invalid },
        undefined,
        { source: "IMPORT", relatedIds: [job.id] },
      );
    }
    await audit(
      tx,
      actor,
      "IMPORT_CREATED",
      "IMPORT",
      job.id,
      { created, skipped, conflicts },
      undefined,
      { source: "IMPORT" },
    );
    return { jobId: job.id, created, skipped, conflicts };
  });
}
export type RegistrationDecision = {
  id: string;
  action: string;
  reason?: string;
  note?: string;
  memberId?: string;
  ign?: string;
};
export async function decideRegistration(
  actor: Actor,
  input: RegistrationDecision,
) {
  return privateTx(actor, (tx) => decideRegistrationInTx(tx, actor, input));
}
export async function approveRegistrations(actor: Actor, ids: string[]) {
  if (!ids.length || ids.length > 50 || new Set(ids).size !== ids.length)
    throw new DomainError("Select between 1 and 50 distinct registrations.");
  return privateTx(actor, async (tx) => {
    for (const id of ids) {
      const row = await tx.registrationSubmission.findUniqueOrThrow({
        where: { id },
      });
      if (
        !["PENDING", "NEEDS_CLARIFICATION"].includes(row.status) ||
        (await tx.ignConflict.count({
          where: { submissionId: id, resolved: false },
        }))
      )
        throw new DomainError(
          "A selected registration needs an individual review. No approvals were saved.",
          409,
        );
      await decideRegistrationInTx(tx, actor, { id, action: "APPROVE" });
    }
    return { approved: ids.length };
  });
}
async function decideRegistrationInTx(
  tx: Tx,
  actor: Actor,
  input: {
    id: string;
    action: string;
    reason?: string;
    note?: string;
    memberId?: string;
    ign?: string;
  },
) {
  const reason = optionalNote(input.reason);
  const row = await tx.registrationSubmission.findUniqueOrThrow({
    where: { id: input.id },
  });
  if (row.status === "APPROVED")
    throw new DomainError("This registration was already approved.");
  const displayIgn = input.ign ? ignSchema.parse(input.ign) : row.displayIgn,
    canonical = canonicalIgn(displayIgn);
  if (row.canonicalIgn.startsWith("invalid:") && !input.ign)
    throw new DomainError("Resolve the missing or invalid IGN first.");
  let memberId: string | undefined;
  if (input.action === "APPROVE") {
    const existing = await tx.member.findUnique({
      where: { canonicalIgn: canonical },
    });
    if (existing && !input.memberId)
      throw new DomainError(
        "IGN conflict. Explicitly choose the existing member.",
        409,
      );
    if (input.memberId) {
      if (!existing || existing.id !== input.memberId || existing.archived)
        throw new DomainError(
          "Link target must be the active member with this canonical IGN.",
        );
      memberId = existing.id;
      await tx.member.update({
        where: { id: memberId },
        data: { verified: true },
      });
      const old = await tx.memberPrivate.findUnique({ where: { memberId } });
      // A duplicate submission links to the member without replacing saved contacts.
      if (old) memberId = existing.id;
    } else {
      memberId = (
        await tx.member.create({
          data: { displayIgn, canonicalIgn: canonical, verified: true },
        })
      ).id;
    }
    const payload = decrypt(row.payloadEncrypted, `submission:${row.id}`);
    const phone = row.phoneEncrypted
      ? decrypt(row.phoneEncrypted, `submission-phone:${row.id}`)
      : null;
    await tx.memberPrivate.upsert({
      where: { memberId },
      update: {},
      create: {
        memberId,
        originalIgn: row.originalIgn,
        registrationEncrypted: encrypt(payload, `member:${memberId}`),
        phoneEncrypted: phone
          ? encrypt(phone, `member-phone:${memberId}`)
          : null,
        phoneLastFour: row.phoneLastFour,
        phoneIssue: row.phoneIssue,
        sourceSubmissionId: row.id,
      },
    });
    await tx.ignConflict.updateMany({
      where: { submissionId: row.id },
      data: { resolved: true },
    });
  }
  const status =
    input.action === "APPROVE"
      ? "APPROVED"
      : input.action === "REJECT"
        ? "REJECTED"
        : input.action === "CLARIFY"
          ? "NEEDS_CLARIFICATION"
          : null;
  if (!status) throw new DomainError("Unknown review action.");
  await tx.registrationSubmission.update({
    where: { id: row.id },
    data: {
      status,
      linkedMemberId: memberId,
      displayIgn,
      canonicalIgn: canonical,
    },
  });
  await tx.submissionDecision.create({
    data: {
      submissionId: row.id,
      actorId: actor.id,
      action: input.action,
      reason: encrypt(reason, `decision:${row.id}`),
      noteEncrypted: input.note
        ? encrypt(input.note, `decision:${row.id}`)
        : null,
    },
  });
  await audit(
    tx,
    actor,
    `REGISTRATION_${input.action}`,
    "SUBMISSION",
    row.id,
    { status, memberId, changedFields: ["status", "linkedMemberId"] },
    reason,
    { relatedIds: memberId ? [memberId] : [] },
  );
  return { status, memberId };
}
