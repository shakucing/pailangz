import { boundedJson, boundedFormData } from "@/lib/request-body";
import { staffCreate, staffEdit, staffRemove } from "@/lib/staff-accounts";
import * as configurationActions from "@/lib/configuration";
import { z } from "zod";
import { assertCsrf, getActor, freshAdmin } from "@/lib/auth";
import { DomainError, noteSchema, requireReason } from "@/lib/domain";
import { privateTx, audit, rateLimit, type Actor } from "@/lib/db";
import {
  csvRows,
  ingest,
  decideRegistration,
  approveRegistrations,
} from "@/lib/imports";
import * as competition from "@/lib/competition";
import * as operations from "@/lib/operations";
import { putEvidence, getEvidence } from "@/lib/evidence";
import { MAX_UPLOAD_REQUEST_BYTES } from "@/lib/evidence-policy";
import { decrypt } from "@/lib/crypto";
import { friendlyError } from "@/lib/staff-presentation";
const headers = {
  "Cache-Control": "private, no-store, max-age=0",
  Vary: "Cookie",
};
const id = z.string().uuid(),
  reason = noteSchema;
function json(value: unknown, status = 200) {
  return Response.json(value, { status, headers });
}
function error(e: unknown) {
  if (e instanceof DomainError)
    return json({ error: friendlyError(e.message) }, e.status);
  if (e instanceof z.ZodError)
    return json(
      { error: "Please check your choices and fill in the required fields." },
      400,
    );
  const code = (e as { code?: string }).code;
  if (code === "P2002")
    return json(
      {
        error:
          "That name is already in use, or a selected player is already on another team. Please check your choices.",
      },
      409,
    );
  if (code === "P2034")
    return json(
      { error: "Another operator changed this record. Refresh and retry." },
      409,
    );
  if (code === "P2025")
    return json({ error: "Record not found or not accessible." }, 404);
  return json(
    {
      error: "We couldn’t save your change. Please try again.",
    },
    500,
  );
}
export async function POST(request: Request) {
  let requestActor: Actor | undefined;
  let operation = "REQUEST";
  try {
    await assertCsrf(request);
    const actor = await getActor();
    requestActor = actor;
    await rateLimit(`mutations:${actor.id}`, 100, 60);
    if (request.headers.get("content-type")?.includes("multipart/form-data")) {
      if (
        Number(request.headers.get("content-length") ?? 0) >
        MAX_UPLOAD_REQUEST_BYTES
      )
        throw new DomainError("Upload is too large.", 413);
      const form = await boundedFormData(request, MAX_UPLOAD_REQUEST_BYTES);
      const file = form.get("file");
      if (!(file instanceof File)) throw new DomainError("Select a file.");
      const action = form.get("action");
      operation = action === "evidence" ? "EVIDENCE_UPLOAD" : "IMPORT";
      if (action === "import") {
        if (!file.name.toLowerCase().endsWith(".csv"))
          throw new DomainError("Select a CSV file.");
        return json(
          await ingest(actor, csvRows(await file.text()), "CSV", file.name),
        );
      }
      if (action === "evidence")
        return json(
          await putEvidence(actor, id.parse(form.get("resultId")), file),
        );
      throw new DomainError("Unknown upload action.");
    }
    if (Number(request.headers.get("content-length") ?? 0) > 2_000_000)
      throw new DomainError("Request is too large.", 413);
    const { action, data } = z
      .object({ action: z.string(), data: z.record(z.string(), z.unknown()) })
      .parse(await boundedJson(request, 2_000_000));
    operation = [
      "configure",
      "revisionApply",
      "revisionReject",
      "assignParticipants",
      "generateLeague",
      "review",
      "approveRegistrations",
      "tournament",
      "publish",
      "rules",
      "mapping",
      "participant",
      "member",
      "team",
      "staff",
      "staffCreate",
      "staffEdit",
      "staffRemove",
      "announcement",
      "setting",
      "result",
      "resultReview",
      "match",
      "freeze",
      "qualification",
      "soloBracket",
      "teamBracket",
      "advance",
      "dependency",
      "disputeResolve",
      "auditExport",
      "privateDetails",
      "reveal",
      "privateExport",
    ].includes(action)
      ? action
      : "UNKNOWN";
    let value: unknown;
    switch (action) {
      case "configure":
        value = await configurationActions.configureTournament(
          actor,
          z
            .object({
              id,
              configuration: z.unknown(),
              regenerate: z.boolean(),
              reason,
            })
            .parse(data),
        );
        break;
      case "revisionApply":
        value = await configurationActions.applyRevision(
          actor,
          z.object({ id, acknowledgement: z.string(), reason }).parse(data),
        );
        break;
      case "revisionReject":
        value = await configurationActions.rejectRevision(
          actor,
          z.object({ id, reason }).parse(data),
        );
        break;
      case "assignParticipants":
        value = await configurationActions.assignParticipants(
          actor,
          z
            .object({
              id,
              memberIds: z.array(id),
              eligible: z.boolean(),
              reason,
            })
            .parse(data),
        );
        break;
      case "generateLeague":
        value = await configurationActions.generateTournamentLeague(
          actor,
          z.object({ id, reason }).parse(data),
        );
        break;
      case "approveRegistrations":
        value = await approveRegistrations(
          actor,
          z.array(id).min(1).max(50).parse(data.ids),
        );
        break;
      case "review":
        value = await decideRegistration(
          actor,
          z
            .object({
              id,
              action: z.enum(["APPROVE", "REJECT", "CLARIFY"]),
              reason,
              note: z.string().max(3000).optional(),
              memberId: id.optional(),
              ign: z.string().optional(),
            })
            .parse(data),
        );
        break;
      case "tournament":
        value = await competition.saveTournament(actor, data);
        break;
      case "publish":
        value = await competition.publishTournament(
          actor,
          z.object({ id, published: z.boolean(), reason }).parse(data),
        );
        break;
      case "rules":
        value = await competition.confirmRules(
          actor,
          z
            .object({
              stageId: id,
              rules: z.unknown(),
              confirmedRules: z.array(z.string()),
              reason,
            })
            .parse(data),
        );
        break;
      case "mapping":
        value = await operations.confirmMapping(
          actor,
          z.object({ id, reason }).parse(data),
        );
        break;
      case "participant":
        value = await operations.participantUpdate(
          actor,
          z.object({ id, eligible: z.boolean(), reason }).parse(data),
        );
        break;
      case "member":
        value = await operations.memberUpdate(
          actor,
          z
            .object({
              id,
              ign: z.string().optional(),
              archived: z.boolean().optional(),
              phone: z.string().max(80).optional(),
              registrationFields: z.record(z.string(), z.string()).optional(),
              reason,
            })
            .parse(data),
        );
        break;
      case "team":
        value = await operations.teamUpdate(
          actor,
          z
            .object({
              id: id.optional(),
              categoryId: id,
              name: z.string(),
              memberIds: z.array(id),
              archived: z.boolean().optional(),
              reason,
            })
            .parse(data),
        );
        break;
      case "staffCreate":
        value = await staffCreate(actor, data);
        break;
      case "staff":
      case "staffEdit":
        value = await staffEdit(actor, data);
        break;
      case "staffRemove":
        value = await staffRemove(actor, data);
        break;
      case "announcement":
        value = await operations.announcementUpdate(
          actor,
          z
            .object({
              id: id.optional(),
              title: z.string(),
              body: z.string(),
              titleEn: z.string().max(150).optional(),
              bodyEn: z.string().max(5000).optional(),
              published: z.boolean(),
              archived: z.boolean().optional(),
              reason,
            })
            .parse(data),
        );
        break;
      case "setting":
        value = await operations.settingUpdate(
          actor,
          z.object({ key: z.string(), value: z.unknown(), reason }).parse(data),
        );
        break;
      case "result":
        value = await competition.submitResult(actor, data);
        break;
      case "resultReview":
        value = await competition.reviewResult(
          actor,
          z
            .object({
              id,
              action: z.enum(["ACCEPT", "REJECT", "DISPUTE"]),
              reason,
            })
            .parse(data),
        );
        break;
      case "match":
        value = await operations.matchUpdate(
          actor,
          z
            .object({
              id,
              status: z.enum(["IN_PROGRESS", "VOIDED"]).optional(),
              scheduledAt: z.string().optional(),
              reason,
            })
            .parse(data),
        );
        break;
      case "freeze":
        value = await competition.freezeRankings(
          actor,
          z.object({ stageId: id, rankedIds: z.array(id), reason }).parse(data),
        );
        break;
      case "qualification":
        value = await competition.createQualification(
          actor,
          z
            .object({ stageId: id, pairs: z.array(z.array(id)), reason })
            .parse(data),
        );
        break;
      case "soloBracket":
        value = await competition.createSoloBracket(
          actor,
          z
            .object({
              categoryId: id,
              reason,
              rankedIds: z.array(id).optional(),
            })
            .parse(data),
        );
        break;
      case "teamBracket":
        value = await operations.createTeamBracket(
          actor,
          z
            .object({ categoryId: id, teamIds: z.array(id), reason })
            .parse(data),
        );
        break;
      case "advance":
        value = await competition.advanceWinner(
          actor,
          z.object({ matchId: id, reason }).parse(data),
        );
        break;
      case "dependency":
        value = await operations.resolveDependency(
          actor,
          z
            .object({
              id,
              reason,
              sideAId: id.optional(),
              sideBId: id.optional(),
            })
            .parse(data),
        );
        break;
      case "disputeResolve":
        value = await competition.resolveDispute(
          actor,
          z.object({ id, uphold: z.boolean(), reason }).parse(data),
        );
        break;
      case "auditExport": {
        reason.parse(data.reason);
        await rateLimit(`audit-export:${actor.id}`, 5, 600);
        value = await privateTx(actor, async (tx) => {
          const records = await tx.auditEvent.findMany({
            where:
              actor.role === "ADMIN"
                ? {}
                : { actorRole: { in: ["MODERATOR", "SYSTEM"] } },
            orderBy: { createdAt: "desc" },
            take: 1000,
          });
          await audit(
            tx,
            actor,
            "AUDIT_EXPORT",
            "AUDIT",
            "bulk",
            { recordCount: records.length },
            data.reason as string,
          );
          const staff = await tx.staffUser.findMany({
            select: { id: true, name: true },
          });
          const names = new Map(staff.map((u) => [u.id, u.name]));
          return {
            records: records.map((r) => ({
              ...r,
              actorName: names.get(r.actorId ?? "") ?? r.actorRole,
            })),
          };
        });
        break;
      }
      case "privateDetails":
        value = await operations.privateDetails(
          actor,
          z.enum(["member", "submission"]).parse(data.kind),
          id.parse(data.id),
        );
        break;
      case "reveal":
        value = await operations.privateDetails(
          actor,
          z.enum(["member", "submission"]).parse(data.kind),
          id.parse(data.id),
          true,
          reason.parse(data.reason),
        );
        break;
      case "privateExport": {
        const admin = await freshAdmin();
        if (process.env.PRIVATE_EXPORT_ENABLED !== "true")
          throw new DomainError("Bulk private exports are disabled.", 403);
        requireReason(data.reason);
        await rateLimit(`export:${admin.id}`, 2, 600);
        const records = await privateTx(admin, async (tx) => {
          const records = await tx.memberPrivate.findMany({ take: 1000 });
          await audit(
            tx,
            admin,
            "PRIVATE_EXPORT",
            "MEMBER",
            "bulk",
            { recordCount: records.length },
            data.reason as string,
          );
          return records.map((r) => ({
            memberId: r.memberId,
            phone: r.phoneEncrypted
              ? decrypt(r.phoneEncrypted, `member-phone:${r.memberId}`)
              : null,
            fields: JSON.parse(
              decrypt(r.registrationEncrypted, `member:${r.memberId}`),
            ),
          }));
        });
        value = { records };
        break;
      }
      default:
        throw new DomainError("Unknown action.");
    }
    return json({ ok: true, ...(value as object) });
  } catch (e) {
    if (requestActor) {
      try {
        const failedActor = requestActor;
        await privateTx(failedActor, (tx) =>
          audit(
            tx,
            failedActor,
            "OPERATION_FAILED",
            "OPERATION",
            operation,
            {
              status:
                e instanceof DomainError
                  ? e.status
                  : e instanceof z.ZodError
                    ? 400
                    : 500,
            },
            undefined,
            { outcome: "FAILURE" },
          ),
        );
      } catch {}
    }
    return error(e);
  }
}
export async function GET(request: Request) {
  try {
    const actor = await getActor();
    const query = new URL(request.url).searchParams;
    if (query.get("evidence")) {
      const evidence = await getEvidence(
        actor,
        id.parse(query.get("evidence")),
      );
      return new Response(new Uint8Array(evidence.bytes), {
        headers: {
          ...headers,
          "Content-Type": evidence.mime,
          "Content-Disposition": 'attachment; filename="result-evidence"',
          "X-Content-Type-Options": "nosniff",
        },
      });
    }
    throw new DomainError("Select an evidence reference.");
  } catch (e) {
    return error(e);
  }
}
