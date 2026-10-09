import type { Rules } from "./domain";
import { configuration, seededBracketPairs } from "./tournament-config";
import { persistBracket } from "./brackets";
import { invalidateDependencies } from "./competition";
import { z } from "zod";
import { privateTx, audit, type Actor, rateLimit } from "./db";
import {
  canonicalIgn,
  DomainError,
  ignSchema,
  requireReason,
  optionalNote,
} from "./domain";
import { decrypt, encrypt } from "./crypto";
import { DEFAULT_MAPPING, phoneInfo } from "./imports";
import { memberFieldKind, normalizeMemberField } from "./member-fields";
import { resizeTeamAvatar } from "./team-avatar";
import { announcementExcerpt } from "./announcement-content";
export async function memberUpdate(
  actor: Actor,
  input: {
    id: string;
    ign?: string;
    archived?: boolean;
    phone?: string;
    registrationFields?: Record<string, string>;
    reason?: string;
  },
) {
  const note = optionalNote(input.reason);
  const ign = input.ign === undefined ? undefined : ignSchema.parse(input.ign);
  const fields = z
    .record(z.string().min(1).max(120), z.string().max(3000))
    .refine((v) => Object.keys(v).length <= 80, "Too many registration fields.")
    .parse(input.registrationFields ?? {});
  if (
    Object.keys(fields).some(
      (k) =>
        /^(timestamp|ign|response[_ ]?id|__proto__|constructor|prototype)$/i.test(
          k,
        ) || /phone|whatsapp/i.test(k),
    )
  )
    throw new DomainError(
      "Use the player name and phone fields for those changes.",
    );
  if (input.phone !== undefined) z.string().max(80).parse(input.phone);
  return privateTx(actor, async (tx) => {
    const old = await tx.member.findUniqueOrThrow({ where: { id: input.id } });
    const changedFields: string[] = [];
    if (ign !== undefined && ign !== old.displayIgn)
      changedFields.push("playerName");
    if (input.archived !== undefined && input.archived !== old.archived)
      changedFields.push("archived");
    await tx.member.update({
      where: { id: old.id },
      data: {
        ...(ign === undefined
          ? {}
          : { displayIgn: ign, canonicalIgn: canonicalIgn(ign) }),
        ...(input.archived === undefined ? {} : { archived: input.archived }),
      },
    });
    if (
      input.phone !== undefined ||
      Object.keys(fields).length ||
      ign !== undefined
    ) {
      const stored = await tx.memberPrivate.findUnique({
        where: { memberId: old.id },
      });
      const setting = await tx.integrationSetting.findUnique({
        where: { key: "formMapping" },
      });
      const mapping = (setting?.value ??
        DEFAULT_MAPPING) as typeof DEFAULT_MAPPING;
      if (
        Object.keys(fields).some((key) =>
          [mapping.ign, mapping.phone].includes(key),
        )
      )
        throw new DomainError(
          "Use the player name and phone fields for those changes.",
        );
      const payload = stored
        ? (JSON.parse(
            decrypt(stored.registrationEncrypted, `member:${old.id}`),
          ) as Record<string, string>)
        : {};
      for (const [key, submitted] of Object.entries(fields)) {
        const kind = memberFieldKind(key, mapping.country);
        // Historical imports can contain arbitrary answers. Preserve those
        // on unrelated edits, but enforce the dropdown choices on changes.
        const value =
          kind && submitted !== payload[key]
            ? normalizeMemberField(kind, submitted)
            : submitted;
        if (value === undefined)
          throw new DomainError(
            kind === "country"
              ? "Select a country from the list, or choose Not specified."
              : "Select Active, Inactive or Not specified for status.",
          );
        if (payload[key] !== value) changedFields.push(key);
        payload[key] = value;
      }
      if (ign !== undefined) {
        payload[mapping.ign] = ign;
        if ("IGN" in payload) payload.IGN = ign;
      }
      const previousPhone = stored?.phoneEncrypted
        ? decrypt(stored.phoneEncrypted, `member-phone:${old.id}`)
        : "";
      const phone = input.phone ?? previousPhone;
      if (input.phone !== undefined) {
        if (phone !== previousPhone) changedFields.push("phone");
        payload[mapping.phone] = phone;
        for (const key of Object.keys(payload))
          if (/phone|whatsapp/i.test(key)) payload[key] = phone;
      }
      const normalized = phoneInfo(
        phone,
        payload[mapping.country] ?? payload.Country ?? "",
      );
      await tx.memberPrivate.upsert({
        where: { memberId: old.id },
        create: {
          memberId: old.id,
          originalIgn: old.displayIgn,
          registrationEncrypted: encrypt(
            JSON.stringify(payload),
            `member:${old.id}`,
          ),
          phoneEncrypted: phone
            ? encrypt(phone, `member-phone:${old.id}`)
            : null,
          phoneLastFour: normalized.lastFour,
          phoneIssue: normalized.issue,
        },
        update: {
          registrationEncrypted: encrypt(
            JSON.stringify(payload),
            `member:${old.id}`,
          ),
          phoneEncrypted: phone
            ? encrypt(phone, `member-phone:${old.id}`)
            : null,
          phoneLastFour: normalized.lastFour,
          phoneIssue: normalized.issue,
        },
      });
    }
    if (changedFields.length)
      await audit(
        tx,
        actor,
        "MEMBER_UPDATE",
        "MEMBER",
        old.id,
        {
          memberName: ign ?? old.displayIgn,
          changedFields,
          ...(ign !== undefined && ign !== old.displayIgn
            ? { beforeIgn: old.displayIgn, afterIgn: ign }
            : {}),
          ...(input.archived !== undefined
            ? { beforeArchived: old.archived, archived: input.archived }
            : {}),
        },
        note,
      );
    return { id: old.id };
  });
}
export async function participantUpdate(
  actor: Actor,
  input: { id: string; eligible: boolean; reason: string },
) {
  return privateTx(actor, async (tx) => {
    const p = await tx.participant.findUniqueOrThrow({
      where: { id: input.id },
      include: { member: true, tournament: true },
    });
    if (input.eligible && (!p.member.verified || p.member.archived))
      throw new DomainError(
        "Approve and verify the member registration first.",
      );
    if (p.withdrawn)
      throw new DomainError(
        "Restore this player from tournament setup before changing eligibility.",
      );
    if (p.tournament.published)
      throw new DomainError(
        "Unpublish before changing participant eligibility.",
      );
    await tx.participant.update({
      where: { id: p.id },
      data: {
        eligible: input.eligible,
        provisional: !p.tournament.mappingConfirmed,
      },
    });
    await audit(
      tx,
      actor,
      "PARTICIPANT_ELIGIBILITY",
      "PARTICIPANT",
      p.id,
      { eligible: input.eligible },
      optionalNote(input.reason),
    );
    return { id: p.id };
  });
}
export const bulkParticipantEligibilitySchema = z.object({
  tournamentId: z.string().uuid(),
  ids: z.array(z.string().uuid()).min(1).max(256),
  eligible: z.boolean(),
  reason: z.string().trim().max(1000).optional().default(""),
});

export async function bulkParticipantEligibility(
  actor: Actor,
  input: z.input<typeof bulkParticipantEligibilitySchema>,
) {
  const { tournamentId, ids, eligible, reason } =
    bulkParticipantEligibilitySchema.parse(input);
  if (new Set(ids).size !== ids.length)
    throw new DomainError("Choose each player only once.");
  return privateTx(actor, async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Tournament" WHERE id=${tournamentId} FOR UPDATE`;
    const tournament = await tx.tournament.findUniqueOrThrow({
      where: { id: tournamentId },
    });
    if (tournament.published)
      throw new DomainError(
        "Unpublish before changing participant eligibility.",
      );
    const participants = await tx.participant.findMany({
      where: { tournamentId, id: { in: ids } },
      include: { member: true },
    });
    if (participants.length !== ids.length)
      throw new DomainError(
        "Some selected players are no longer in this tournament. Refresh and select them again.",
      );
    if (participants.some((p) => p.withdrawn))
      throw new DomainError(
        "Restore withdrawn players before changing eligibility.",
      );
    if (
      eligible &&
      participants.some((p) => !p.member.verified || p.member.archived)
    )
      throw new DomainError(
        "Approve and verify the selected member registrations first.",
      );
    const result = await tx.participant.updateMany({
      where: { tournamentId, id: { in: ids }, withdrawn: false },
      data: { eligible, provisional: !tournament.mappingConfirmed },
    });
    await audit(
      tx,
      actor,
      "PARTICIPANTS_ELIGIBILITY",
      "TOURNAMENT",
      tournamentId,
      { eligible, playerCount: result.count },
      reason,
      { tournamentId, relatedIds: ids },
    );
    return { count: result.count };
  });
}

export async function confirmMapping(
  actor: Actor,
  input: { id: string; reason: string },
) {
  return privateTx(actor, async (tx) => {
    await tx.tournament.update({
      where: { id: input.id },
      data: { mappingConfirmed: true },
    });
    await tx.participant.updateMany({
      where: { tournamentId: input.id },
      data: { provisional: false },
    });
    await audit(
      tx,
      actor,
      "PLAYER_MAPPING_CONFIRM",
      "TOURNAMENT",
      input.id,
      { mappingConfirmed: true },
      optionalNote(input.reason),
    );
    return { id: input.id };
  });
}
export async function teamUpdate(
  actor: Actor,
  input: {
    id?: string;
    categoryId: string;
    name: string;
    memberIds: string[];
    archived?: boolean;
    removeImage?: boolean;
    reason: string;
  },
  image?: File,
) {
  if (image && input.removeImage)
    throw new DomainError(
      "Choose a replacement image or remove the current image, not both.",
    );
  const avatarImage = image
    ? await resizeTeamAvatar(image)
    : input.removeImage
      ? null
      : undefined;
  return privateTx(actor, async (tx) => {
    // Serialize roster saves with tournament publication and entrant withdrawal.
    await tx.$queryRaw`SELECT t.id FROM "Tournament" t
      JOIN "Category" c ON c."tournamentId"=t.id
      WHERE c.id=${input.categoryId} FOR UPDATE OF t`;
    const category = await tx.category.findUniqueOrThrow({
      where: { id: input.categoryId },
      include: { tournament: true },
    });
    if (category.kind !== "TEAM" || category.tournament.published)
      throw new DomainError("Select an unpublished TEAM category.");
    if (
      new Set(input.memberIds).size !== input.memberIds.length ||
      input.memberIds.length > 4
    )
      throw new DomainError("A team accepts at most four distinct players.");
    const members = await tx.member.findMany({
      where: { id: { in: input.memberIds }, verified: true, archived: false },
    });
    if (members.length !== input.memberIds.length)
      throw new DomainError("Team players must be approved active members.");
    if (!input.archived) {
      const registered = await tx.participant.count({
        where: {
          tournamentId: category.tournamentId,
          memberId: { in: input.memberIds },
          eligible: true,
          withdrawn: false,
        },
      });
      if (registered !== input.memberIds.length)
        throw new DomainError(
          "Team players must be registered and eligible in this tournament.",
        );
    }
    if (
      !input.id &&
      (await tx.team.count({
        where: { categoryId: category.id, archived: false },
      })) >= category.capacity
    )
      throw new DomainError(
        `The TEAM category has ${category.capacity} roster slots.`,
      );
    const team = input.id
      ? await tx.team.findUniqueOrThrow({ where: { id: input.id } })
      : await tx.team.create({
          data: {
            categoryId: category.id,
            name: z.string().min(1).max(100).parse(input.name),
          },
        });
    if (team.categoryId !== category.id)
      throw new DomainError("Team category mismatch.");
    if (
      team.ownerId &&
      !input.archived &&
      !input.memberIds.includes(team.ownerId)
    )
      throw new DomainError(
        "Keep the team owner in the roster, or archive the team.",
      );
    await tx.team.update({
      where: { id: team.id },
      data: {
        name: z.string().min(1).max(100).parse(input.name),
        archived: input.archived ?? false,
        ...(avatarImage === undefined ? {} : { avatarImage }),
      },
    });
    await tx.teamMembership.updateMany({
      where: { teamId: team.id, active: true },
      data: { active: false },
    });
    if (!input.archived)
      for (const memberId of input.memberIds)
        await tx.teamMembership.create({
          data: { teamId: team.id, categoryId: category.id, memberId },
        });
    await audit(
      tx,
      actor,
      "TEAM_ROSTER_UPDATE",
      "TEAM",
      team.id,
      {
        memberIds: input.memberIds,
        archived: input.archived ?? false,
        ...(avatarImage !== undefined && avatarImage !== team.avatarImage
          ? {
              imageChange:
                avatarImage === null
                  ? "removed"
                  : team.avatarImage
                    ? "replaced"
                    : "added",
            }
          : {}),
      },
      optionalNote(input.reason),
    );
    return {
      id: team.id,
      avatarImage: avatarImage === undefined ? team.avatarImage : avatarImage,
    };
  });
}
export async function staffUpdate(
  actor: Actor,
  input: {
    id: string;
    role: "ADMIN" | "MODERATOR";
    suspended: boolean;
    reason: string;
  },
) {
  if (actor.role !== "ADMIN")
    throw new DomainError("Admin permission is required.", 403);
  return privateTx(actor, async (tx) => {
    if (input.id === actor.id)
      throw new DomainError("You cannot demote or suspend your own session.");
    const user = await tx.staffUser.findUniqueOrThrow({
      where: { id: input.id },
    });
    if (
      user.role === "ADMIN" &&
      (input.role !== "ADMIN" || input.suspended) &&
      (await tx.staffUser.count({
        where: { role: "ADMIN", suspended: false },
      })) <= 1
    )
      throw new DomainError("Retain at least one active admin.");
    await tx.$executeRaw`SELECT app_update_staff(${user.id},${input.role}::"StaffRole",${input.suspended})`;
    await audit(
      tx,
      actor,
      "STAFF_PERMISSION_CHANGE",
      "STAFF",
      user.id,
      {
        beforeRole: user.role,
        afterRole: input.role,
        suspended: input.suspended,
      },
      requireReason(input.reason),
    );
    return { id: user.id };
  });
}
export async function announcementUpdate(
  actor: Actor,
  input: {
    id?: string;
    title: string;
    body: string;
    titleEn?: string;
    bodyEn?: string;
    published: boolean;
    archived?: boolean;
    reason: string;
  },
) {
  return privateTx(actor, async (tx) => {
    const data = {
      title: z.string().min(3).max(150).parse(input.title),
      body: z
        .string()
        .refine((value) => announcementExcerpt(value, 4).length >= 3)
        .parse(input.body),
      titleEn:
        input.titleEn !== undefined
          ? z.string().max(150).parse(input.titleEn) || null
          : undefined,
      bodyEn:
        input.bodyEn !== undefined
          ? z.string().parse(input.bodyEn) || null
          : undefined,
      published: input.published,
      archived: input.archived ?? false,
    };
    const row = input.id
      ? await tx.announcement.update({ where: { id: input.id }, data })
      : await tx.announcement.create({ data });
    await audit(
      tx,
      actor,
      "ANNOUNCEMENT_SAVE",
      "ANNOUNCEMENT",
      row.id,
      { changedFields: Object.keys(data), published: input.published },
      optionalNote(input.reason),
    );
    return { id: row.id };
  });
}
export async function settingUpdate(
  actor: Actor,
  input: { key: string; value: unknown; reason: string },
) {
  if (actor.role !== "ADMIN")
    throw new DomainError("Admin permission is required.", 403);
  if (!["formMapping", "responderUrl"].includes(input.key))
    throw new DomainError(
      "This setting is managed through deployment secrets.",
    );
  let value;
  if (input.key === "formMapping")
    value = z
      .object({
        ign: z.string().min(1),
        phone: z.string().min(1),
        country: z.string().min(1),
      })
      .strict()
      .parse(input.value);
  else {
    const url = z.string().url().parse(input.value);
    if (!validResponder(url))
      throw new DomainError(
        "Use a Google Forms responder URL, never an editor link.",
      );
    value = url;
  }
  return privateTx(actor, async (tx) => {
    await tx.integrationSetting.upsert({
      where: { key: input.key },
      create: { key: input.key, value },
      update: { value },
    });
    await audit(
      tx,
      actor,
      "INTEGRATION_SETTING",
      "SETTING",
      input.key,
      { changedFields: [input.key] },
      optionalNote(input.reason),
    );
    return { key: input.key };
  });
}
export function validResponder(value: string) {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      (url.hostname === "forms.gle" ||
        (url.hostname === "docs.google.com" &&
          /^\/forms\/.*\/viewform$/.test(url.pathname)))
    );
  } catch {
    return false;
  }
}
export async function privateDetails(
  actor: Actor,
  kind: "member" | "submission",
  id: string,
  reveal = false,
  reason?: string,
) {
  await rateLimit(`private:${actor.id}`, 120, 60);
  return privateTx(actor, async (tx) => {
    let encrypted: string,
      context: string,
      phone: string | null,
      phoneContext: string;
    if (kind === "member") {
      const row = await tx.memberPrivate.findUniqueOrThrow({
        where: { memberId: id },
      });
      encrypted = row.registrationEncrypted;
      context = `member:${id}`;
      phone = row.phoneEncrypted;
      phoneContext = `member-phone:${id}`;
    } else {
      const row = await tx.registrationSubmission.findUniqueOrThrow({
        where: { id },
      });
      encrypted = row.payloadEncrypted;
      context = `submission:${id}`;
      phone = row.phoneEncrypted;
      phoneContext = `submission-phone:${id}`;
    }
    await audit(
      tx,
      actor,
      reveal ? "PRIVATE_PHONE_REVEAL" : "PRIVATE_DETAILS_READ",
      kind.toUpperCase(),
      id,
      { changedFields: reveal ? ["phone"] : ["registrationFields"] },
      reason,
    );
    const plainPhone = phone ? decrypt(phone, phoneContext) : null;
    if (reveal) return { phone: plainPhone };
    const mapping = await tx.integrationSetting.findUnique({
      where: { key: "formMapping" },
    });
    const phoneHeader =
      (mapping?.value as typeof DEFAULT_MAPPING | undefined)?.phone ??
      DEFAULT_MAPPING.phone;
    const raw = JSON.parse(decrypt(encrypted, context)) as Record<
      string,
      string
    >;
    for (const key of Object.keys(raw))
      if (key === phoneHeader || /phone|whatsapp/i.test(key))
        raw[key] = plainPhone ?? "";
    const editableFields = Object.keys(raw).filter(
      (key) =>
        key !== phoneHeader &&
        key !==
          ((mapping?.value as typeof DEFAULT_MAPPING | undefined)?.ign ??
            DEFAULT_MAPPING.ign) &&
        !/^(timestamp|ign|response[_ ]?id|__proto__|constructor|prototype)$/i.test(
          key,
        ) &&
        !/phone|whatsapp/i.test(key),
    );
    return {
      fields: raw,
      phone: plainPhone,
      editableFields,
      countryField:
        (mapping?.value as typeof DEFAULT_MAPPING | undefined)?.country ??
        DEFAULT_MAPPING.country,
    };
  });
}
export async function resolveDependency(
  actor: Actor,
  input: { id: string; reason: string; sideAId?: string; sideBId?: string },
) {
  if (actor.role !== "ADMIN")
    throw new DomainError("Admin resolution is required.", 403);
  return privateTx(actor, async (tx) => {
    const d = await tx.bracketDependency.findUniqueOrThrow({
      where: { id: input.id },
      include: { match: { include: { round: { include: { stage: true } } } } },
    });
    if (d.match.round.stage.archived)
      throw new DomainError(
        "Archived dependencies belong to retained history.",
      );
    if (!d.stale) throw new DomainError("Dependency is already current.");
    if ((input.sideAId || input.sideBId) && d.match.status !== "SCHEDULED")
      throw new DomainError(
        "Do not replace opponents in a started match. Void and rebuild it through an audited resolution.",
      );
    if (input.sideAId || input.sideBId)
      await tx.match.update({
        where: { id: d.matchId },
        data: { sideAId: input.sideAId, sideBId: input.sideBId },
      });
    await tx.bracketDependency.update({
      where: { id: d.id },
      data: {
        stale: false,
        resolutionReason: encrypt(
          requireReason(input.reason),
          `dependency:${d.id}`,
        ),
      },
    });
    await audit(
      tx,
      actor,
      "DEPENDENCY_RESOLVE",
      "DEPENDENCY",
      d.id,
      { changedFields: ["stale", "opponents"] },
      input.reason,
    );
    return { id: d.id };
  });
}
export async function matchUpdate(
  actor: Actor,
  input: {
    id: string;
    status?: "IN_PROGRESS" | "VOIDED";
    scheduledAt?: string;
    reason: string;
  },
) {
  return privateTx(actor, async (tx) => {
    const m = await tx.match.findUniqueOrThrow({
      where: { id: input.id },
      include: { round: { include: { stage: true } } },
    });
    if (m.round.stage.archived)
      throw new DomainError(
        "Archived matches are immutable competition history.",
      );
    if (input.status === "IN_PROGRESS" && m.status !== "SCHEDULED")
      throw new DomainError("Only scheduled matches can be started.");
    if (
      (await tx.bracketDependency.count({
        where: { matchId: m.id, stale: true },
      })) &&
      input.status === "IN_PROGRESS"
    )
      throw new DomainError("Resolve stale dependencies first.");
    await tx.match.update({
      where: { id: m.id },
      data: {
        status: input.status,
        scheduledAt: input.scheduledAt
          ? new Date(input.scheduledAt)
          : undefined,
      },
    });
    if (input.status === "VOIDED") {
      const stage = await tx.round.findUniqueOrThrow({
        where: { id: m.roundId },
      });
      await invalidateDependencies(
        tx,
        actor,
        stage.stageId,
        m.id,
        requireReason(input.reason),
      );
    }
    await audit(
      tx,
      actor,
      "MATCH_UPDATE",
      "MATCH",
      m.id,
      { status: input.status, scheduledAt: input.scheduledAt },
      input.status === "VOIDED"
        ? requireReason(input.reason)
        : optionalNote(input.reason),
    );
    return { id: m.id };
  });
}
export async function createTeamBracket(
  actor: Actor,
  input: { categoryId: string; teamIds: string[]; reason: string },
) {
  return privateTx(actor, async (tx) => {
    const c = await tx.category.findUniqueOrThrow({
      where: { id: input.categoryId },
      include: {
        teams: {
          where: { archived: false },
          include: { memberships: { where: { active: true } } },
        },
        stages: { where: { archived: false } },
        tournament: true,
      },
    });
    const stage = c.stages.find((s) => s.key === "knockout");
    if (
      c.kind !== "TEAM" ||
      !stage ||
      !stage.confirmedRules.includes("teamSeeding")
    )
      throw new DomainError("Confirm TEAM seeding first.");
    const config = configuration(c.tournament.configuration);
    if (
      input.teamIds.length !== c.capacity ||
      new Set(input.teamIds).size !== c.capacity ||
      c.teams.some((t) => t.memberships.length !== 4) ||
      input.teamIds.some((id) => !c.teams.some((t) => t.id === id))
    )
      throw new DomainError(
        `Provide all ${c.capacity} complete teams in explicitly approved seed order.`,
      );
    if (await tx.round.count({ where: { stageId: stage.id } }))
      throw new DomainError("TEAM bracket already exists.");
    if (
      input.teamIds.length < config.teamBracketSize &&
      (!stage.confirmedRules.includes("byePolicy") ||
        (stage.rules as Rules).byePolicy !== config.bracketByePolicy)
    )
      throw new DomainError("Confirm the TEAM bye policy first.");
    const pairs = seededBracketPairs(
      input.teamIds,
      config.teamBracketSize,
      config.bracketByePolicy,
    );
    const stats = await persistBracket(
      tx,
      stage.id,
      config.teamBracketSize,
      pairs,
      "TEAM",
      config,
    );
    await audit(
      tx,
      actor,
      "TEAM_BRACKET_CREATE",
      "STAGE",
      stage.id,
      { teamIds: input.teamIds, ...stats },
      optionalNote(input.reason),
    );
    return { id: stage.id };
  });
}
