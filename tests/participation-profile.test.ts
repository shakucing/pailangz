import { describe, expect, it } from "vitest";
import {
  completeParticipationProfile,
  missingParticipationFields,
  participationProfileFields,
} from "../src/lib/participation-profile";
import {
  participationProfile,
  participationProfilePayload,
} from "./participation-profile-fixture";

describe("missing tournament profile details", () => {
  it("recognizes saved imports without changing their spelling or values", () => {
    const saved = {
      " gmc id ": "123",
      "EMAIL ADDRESS": "old@example.com",
      "Whatsapp Number": "+60123456789",
      "Discord username": "Player",
      "Discord ID": "player",
      Country: "MY",
    };
    expect(missingParticipationFields(saved)).toEqual([]);
    expect(completeParticipationProfile(saved, participationProfile)).toEqual({
      payload: saved,
      changedFields: [],
    });
  });
  it("requires every missing answer and rejects invalid values", () => {
    expect(missingParticipationFields({})).toHaveLength(5);
    for (const field of participationProfileFields) {
      const saved = { ...participationProfilePayload, [field.key]: "  " };
      expect(missingParticipationFields(saved)).toEqual([field.name]);
      for (const invalid of [undefined, "", " ", "invisible\u200b"]) {
        expect(() =>
          completeParticipationProfile(saved, {
            ...participationProfile,
            [field.name]: invalid,
          }),
        ).toThrow();
      }
    }
    expect(() =>
      completeParticipationProfile(
        {},
        { ...participationProfile, email: "bad-email" },
      ),
    ).toThrow();
    expect(() =>
      completeParticipationProfile(
        {},
        { ...participationProfile, whatsapp: "not-a-number" },
      ),
    ).toThrow();
  });
  it("fills only blank answers and preserves unrelated registration data", () => {
    const saved = {
      "Tiktok ID": "@saved",
      "Discord ID": "keep_me",
      Email: " ",
      Custom: "kept",
    };
    const result = completeParticipationProfile(saved, participationProfile);
    expect(result.payload).toEqual({
      ...saved,
      ...participationProfilePayload,
      "Discord ID": "keep_me",
    });
    expect(result.changedFields).not.toContain("discordId");
    expect(saved.Email).toBe(" ");
  });
});
