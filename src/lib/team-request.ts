import { createHash } from "node:crypto";
import { z } from "zod";
import { DomainError } from "./domain";
import { ensureRuntime, rateLimit } from "./db";
import { assertPublicRequestOrigin } from "./request-origin";

export const teamHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  "CDN-Cache-Control": "no-store",
  "Vercel-CDN-Cache-Control": "no-store",
};
export async function checkTeamRequest(
  request: Request,
  scope: string,
  identity = "",
) {
  assertPublicRequestOrigin(request);
  await ensureRuntime();
  const hash = (s: string) => createHash("sha256").update(s).digest("hex");
  const address =
    request.headers.get("x-forwarded-for")?.split(",").at(-1)?.trim() ??
    "local";
  await rateLimit(
    `teams:${scope}:address:${hash(address)}`,
    scope === "access" ? 10 : 60,
    600,
  );
  if (identity)
    await rateLimit(
      `teams:${scope}:identity:${hash(identity)}`,
      scope === "access" ? 10 : 60,
      600,
    );
  await rateLimit(`teams:${scope}:deployment`, 120, 60);
}
const errors = new Set([
  "SIGN_IN",
  "VERIFICATION_FAILED",
  "ORIGIN",
  "NOT_APPROVED",
  "CLOSED",
  "NOT_FOUND",
  "OWNER_ONLY",
  "ALREADY_IN_TEAM",
  "TOURNAMENT_FULL",
  "TEAM_FULL",
  "APPLICATIONS_CLOSED",
  "ALREADY_REVIEWED",
  "APPLICANT_NOT_APPROVED",
  "APPLICANT_IN_TEAM",
  "VALIDATION",
  "INVALID_IMAGE",
  "IMAGE_TOO_LARGE",
]);
export function teamError(error: unknown) {
  const status =
    error instanceof z.ZodError
      ? 400
      : error instanceof DomainError
        ? error.status
        : 503;
  const code =
    error instanceof z.ZodError
      ? "VALIDATION"
      : status === 429
        ? "RATE_LIMIT"
        : status === 413
          ? "IMAGE_TOO_LARGE"
          : error instanceof DomainError && errors.has(error.message)
            ? error.message
            : "UNAVAILABLE";
  return Response.json({ error: code }, { status, headers: teamHeaders });
}
