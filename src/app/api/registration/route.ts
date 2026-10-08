import { createHash } from "node:crypto";
import { z } from "zod";
import { DomainError } from "@/lib/domain";
import { rateLimit } from "@/lib/db";
import { boundedJson } from "@/lib/request-body";
import { registrationFormSchema } from "@/lib/registration-form";
import { submitRegistration } from "@/lib/registration";
import { assertPublicRequestOrigin } from "@/lib/request-origin";

export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store, max-age=0" };

export async function POST(request: Request) {
  try {
    assertPublicRequestOrigin(request);
    const input = registrationFormSchema.parse(
      await boundedJson(request, 16_000),
    );
    const address =
      request.headers.get("x-forwarded-for")?.split(",").at(-1)?.trim() ??
      "local";
    const digest = createHash("sha256").update(address).digest("hex");
    await rateLimit(`registration:${digest}`, 10, 600);
    await rateLimit("registration:deployment", 60, 60);
    await submitRegistration(input);
    // Always give the same response, including for an existing IGN or a retry.
    return Response.json({ accepted: true }, { status: 202, headers });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json(
        {
          error: "VALIDATION",
          fields: [
            ...new Set(error.issues.map((issue) => String(issue.path[0]))),
          ],
        },
        { status: 400, headers },
      );
    }
    const status = error instanceof DomainError ? error.status : 503;
    return Response.json(
      {
        error:
          status === 429
            ? "RATE_LIMIT"
            : status === 403
              ? "ORIGIN"
              : status === 413
                ? "TOO_LARGE"
                : "UNAVAILABLE",
      },
      { status, headers },
    );
  }
}
