import { createHash } from "node:crypto";
import { z } from "zod";
import { DomainError, canonicalIgn } from "@/lib/domain";
import { ensureRuntime, rateLimit } from "@/lib/db";
import { boundedJson } from "@/lib/request-body";
import { participationSubmissionSchema } from "@/lib/participation-form";
import { submitParticipation } from "@/lib/participation";
import { assertPublicRequestOrigin } from "@/lib/request-origin";

export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store, max-age=0" };

export async function POST(request: Request) {
  try {
    assertPublicRequestOrigin(request);
    const input = participationSubmissionSchema.parse(
      await boundedJson(request, 2_000),
    );
    await ensureRuntime();
    const address =
      request.headers.get("x-forwarded-for")?.split(",").at(-1)?.trim() ??
      "local";
    const digest = (value: string) =>
      createHash("sha256").update(value).digest("hex");
    await rateLimit(`participation:address:${digest(address)}`, 10, 600);
    await rateLimit(
      `participation:member:${digest(canonicalIgn(input.ign))}`,
      10,
      600,
    );
    await rateLimit("participation:deployment", 60, 60);
    await submitParticipation(input);
    return Response.json({ accepted: true }, { status: 202, headers });
  } catch (error) {
    if (error instanceof z.ZodError)
      return Response.json(
        {
          error: "VALIDATION",
          fields: [
            ...new Set(error.issues.map((issue) => String(issue.path[0]))),
          ],
        },
        { status: 400, headers },
      );
    const status = error instanceof DomainError ? error.status : 503;
    return Response.json(
      {
        error:
          status === 429
            ? "RATE_LIMIT"
            : status === 422
              ? "VERIFICATION_FAILED"
              : status === 409
                ? error instanceof DomainError && error.message === "FULL"
                  ? "FULL"
                  : error instanceof DomainError &&
                      error.message === "WITHDRAWN"
                    ? "WITHDRAWN"
                    : "CLOSED"
                : status === 403
                  ? "ORIGIN"
                  : status === 413
                    ? "TOO_LARGE"
                    : status === 400
                      ? "VALIDATION"
                      : "UNAVAILABLE",
      },
      { status, headers },
    );
  }
}
