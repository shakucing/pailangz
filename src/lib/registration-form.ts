import { z } from "zod";
import { ignSchema } from "./domain";

import { COUNTRY_CODES } from "./countries";
export { COUNTRY_CODES } from "./countries";

const privateText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .refine((v) => !/[\p{Cc}\p{Cf}]/u.test(v));

// Required only for new web submissions. Historical imports and member edits
// retain their existing optional social fields.
export const registrationFormSchema = z.object({
  requestId: z.string().uuid(),
  ign: ignSchema,
  whatsapp: privateText(80).optional().default(""),
  tiktokUsername: privateText(100).min(1),
  tiktokId: privateText(80).min(1),
  discordName: privateText(100).optional().default(""),
  discordId: privateText(100).optional().default(""),
  stateProvince: privateText(100).optional().default(""),
  country: z.string().refine((value) => COUNTRY_CODES.includes(value)),
});

export type RegistrationFormInput = z.infer<typeof registrationFormSchema>;

export function registrationPayload(input: RegistrationFormInput) {
  return {
    Timestamp: new Date().toISOString(),
    IGN: input.ign,
    "Whatsapp Number": input.whatsapp,
    "Tiktok username": input.tiktokUsername,
    "Tiktok ID": input.tiktokId,
    "Discord Name": input.discordName,
    "Discord ID": input.discordId,
    "State/Province": input.stateProvince,
    Country: input.country,
  };
}
