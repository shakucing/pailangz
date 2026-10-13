import { z } from "zod";

export const participationProfileFields = [
  { name: "gmcId", key: "ID GMC", aliases: ["ID GMC", "GMC ID"] },
  { name: "email", key: "Email", aliases: ["Email", "Email Address"] },
  {
    name: "whatsapp",
    key: "Whatsapp Number",
    aliases: ["Whatsapp Number", "WhatsApp", "WhatsApp number"],
  },
  {
    name: "discordName",
    key: "Discord Name",
    aliases: ["Discord Name", "Discord username"],
  },
  { name: "discordId", key: "Discord ID", aliases: ["Discord ID"] },
] as const;

export type ParticipationProfileField =
  (typeof participationProfileFields)[number]["name"];
const text = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine((v) => !/[\p{Cc}\p{Cf}]/u.test(v));
export const participationProfileSchema = z.object({
  gmcId: text(100),
  email: text(254).pipe(z.email()),
  whatsapp: text(80).refine(
    (v) => /^\+?[\d\s().-]+$/.test(v) && v.replace(/\D/g, "").length >= 7,
  ),
  discordName: text(100),
  discordId: text(100),
});

function matchingKeys(
  payload: Record<string, unknown>,
  aliases: readonly string[],
) {
  return Object.keys(payload).filter((key) =>
    aliases.some((alias) => alias.toLowerCase() === key.trim().toLowerCase()),
  );
}

export function missingParticipationFields(payload: Record<string, unknown>) {
  return participationProfileFields
    .filter(
      (field) =>
        !matchingKeys(payload, field.aliases).some(
          (key) => typeof payload[key] === "string" && payload[key].trim(),
        ),
    )
    .map((field) => field.name);
}

// Only fill missing answers. Saved values and unrelated imported answers are
// preserved even if a client sends replacements for them.
export function completeParticipationProfile(
  payload: Record<string, unknown>,
  input: Record<string, unknown>,
) {
  const missing = missingParticipationFields(payload);
  const next = { ...payload };
  for (const name of missing) {
    const value = participationProfileSchema.shape[name].safeParse(input[name]);
    if (!value.success)
      throw new z.ZodError(
        value.error.issues.map((issue) => ({
          ...issue,
          path: [name, ...issue.path],
        })),
      );
    const field = participationProfileFields.find(
      (field) => field.name === name,
    )!;
    const key = matchingKeys(payload, field.aliases)[0] ?? field.key;
    next[key] = value.data;
  }
  return { payload: next, changedFields: missing };
}
