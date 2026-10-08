import { z } from "zod";
import { ignSchema } from "./domain";

// TikTok handles are case-insensitive; an optional leading @ is presentation.
// Do not compare against the display name or accept profile URLs as IDs.
export function canonicalTiktokId(value: string) {
  return value.trim().replace(/^@/, "").toLowerCase();
}

export const participationFormSchema = z.object({
  ign: ignSchema,
  tiktokId: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .refine(
      (value) =>
        !/[\p{Cc}\p{Cf}\s/]/u.test(value) &&
        canonicalTiktokId(value).length > 0 &&
        !canonicalTiktokId(value).includes("@"),
    ),
});

export function savedTiktokId(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return;
  const ids = Object.entries(payload)
    .filter(([key]) => key.trim().toLowerCase() === "tiktok id")
    .map(([, value]) =>
      typeof value === "string" ? canonicalTiktokId(value) : "",
    );
  // Ambiguous or empty historical records need staff correction first.
  if (ids.length !== 1 || !ids[0]) return;
  return ids[0];
}

export const participationSubmissionSchema = participationFormSchema.extend({
  tournamentSlug: z
    .string()
    .min(1)
    .max(150)
    .regex(/^[a-z0-9-]+$/)
    .default("pailangz-solo-team"),
});
