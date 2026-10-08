import { describe, expect, it } from "vitest";
import {
  COUNTRY_CODES,
  registrationFormSchema,
  registrationPayload,
} from "../src/lib/registration-form";

const valid = {
  requestId: "08da2ae8-3b2b-4c4a-bc66-e9a5f98837e1",
  ign: " Player ✨ ",
  tiktokUsername: " Display name ",
  tiktokId: " @player_98 ",
  country: "MY",
};

describe("new web registrations", () => {
  it.each(["ign", "tiktokUsername", "tiktokId", "country"])(
    "requires %s, including whitespace-only values",
    (key) => {
      for (const value of [undefined, "", "   "])
        expect(
          registrationFormSchema.safeParse({ ...valid, [key]: value }).success,
        ).toBe(false);
    },
  );
  it("accepts empty optional fields and preserves symbols and handles", () => {
    const fields = registrationFormSchema.parse(valid);
    expect(fields).toMatchObject({
      ign: "Player ✨",
      tiktokUsername: "Display name",
      tiktokId: "@player_98",
      whatsapp: "",
      discordName: "",
      discordId: "",
      stateProvince: "",
    });
    expect(registrationPayload(fields)).toMatchObject({
      IGN: "Player ✨",
      "Tiktok username": "Display name",
      "Tiktok ID": "@player_98",
      "Whatsapp Number": "",
      "Discord Name": "",
      "Discord ID": "",
      "State/Province": "",
      Country: "MY",
    });
  });
  it("bounds input, validates country selection and ignores client-supplied privileges", () => {
    for (const changes of [
      { country: "invalid" },
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
