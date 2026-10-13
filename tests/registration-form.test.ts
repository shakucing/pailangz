import { describe, expect, it } from "vitest";
import {
  COUNTRY_CODES,
  registrationFormSchema,
  registrationPayload,
} from "../src/lib/registration-form";

const valid = {
  requestId: "08da2ae8-3b2b-4c4a-bc66-e9a5f98837e1",
  ign: " Player ✨ ",
  gmcId: " GMC-00123 ",
  whatsapp: " +60 12 345 6789 ",
  email: " player@example.com ",
  tiktokUsername: " Display name ",
  tiktokId: " @player_98 ",
  country: "MY",
};

describe("new web registrations", () => {
  it.each([
    "ign",
    "gmcId",
    "whatsapp",
    "email",
    "tiktokUsername",
    "tiktokId",
    "country",
  ])("requires %s, including whitespace-only values", (key) => {
    for (const value of [undefined, "", "   "])
      expect(
        registrationFormSchema.safeParse({ ...valid, [key]: value }).success,
      ).toBe(false);
  });
  it("accepts empty optional fields and preserves symbols and handles", () => {
    const fields = registrationFormSchema.parse(valid);
    expect(fields).toMatchObject({
      ign: "Player ✨",
      gmcId: "GMC-00123",
      tiktokUsername: "Display name",
      tiktokId: "@player_98",
      whatsapp: "+60 12 345 6789",
      email: "player@example.com",
      discordName: "",
      discordId: "",
      stateProvince: "",
    });
    expect(registrationPayload(fields)).toMatchObject({
      IGN: "Player ✨",
      "ID GMC": "GMC-00123",
      Email: "player@example.com",
      "Tiktok username": "Display name",
      "Tiktok ID": "@player_98",
      "Whatsapp Number": "+60 12 345 6789",
      "Discord Name": "",
      "Discord ID": "",
      "State/Province": "",
      Country: "MY",
    });
  });
  it("trims contact fields before storing them in the encrypted payload", () => {
    const fields = registrationFormSchema.parse(valid);
    expect(registrationPayload(fields)).toMatchObject({
      Email: "player@example.com",
      "Whatsapp Number": "+60 12 345 6789",
    });
  });
  it.each([
    "invalid",
    "player@",
    "player@example.com\nBcc: other@example.com",
    "hidden\u0000@example.com",
    `${"a".repeat(250)}@example.com`,
  ])("rejects malformed or oversized email %s", (email) => {
    const result = registrationFormSchema.safeParse({ ...valid, email });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0].path).toEqual(["email"]);
  });
  it("bounds input, validates country selection and ignores client-supplied privileges", () => {
    for (const changes of [
      { country: "invalid" },
      { gmcId: "a".repeat(101) },
      { gmcId: "hidden\u0000" },
      { whatsapp: "a".repeat(81) },
      { whatsapp: "hidden\u0000" },
      { tiktokId: "a".repeat(81) },
      { tiktokUsername: "hidden\u0000" },
      { requestId: "invalid" },
    ])
      expect(
        registrationFormSchema.safeParse({ ...valid, ...changes }).success,
      ).toBe(false);
    const fields = registrationFormSchema.parse({
      ...valid,
      role: "ADMIN",
      status: "APPROVED",
    });
    expect(fields).not.toHaveProperty("role");
    expect(fields).not.toHaveProperty("status");
    expect(COUNTRY_CODES).toHaveLength(249);
    expect(new Set(COUNTRY_CODES).size).toBe(249);
  });
});
