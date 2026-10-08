import { describe, expect, it } from "vitest";
import {
  canonicalTiktokId,
  participationFormSchema,
  savedTiktokId,
} from "../src/lib/participation-form";

describe("tournament participation identity", () => {
  it("uses the saved ID, with optional @ and case differences", () => {
    expect(canonicalTiktokId(" @Player.123 ")).toBe("player.123");
    expect(
      savedTiktokId({
        "Tiktok username": "Display name",
        "Tiktok ID": "@Player.123",
      }),
    ).toBe("player.123");
    expect(
      savedTiktokId({ "Tiktok username": "Display name" }),
    ).toBeUndefined();
    expect(savedTiktokId({ "Tiktok ID": "@" })).toBeUndefined();
    expect(
      savedTiktokId({ "Tiktok ID": "one", "TikTok ID": "two" }),
    ).toBeUndefined();
  });
  it("accepts exactly the requested fields and rejects unusable identity values", () => {
    const valid = { ign: " Player ✨ ", tiktokId: " @player.123 " };
    expect(
      participationFormSchema.parse({
        ...valid,
        category: "SOLO",
        memberId: "forged",
      }),
    ).toEqual({ ign: "Player ✨", tiktokId: "@player.123" });
    for (const tiktokId of [
      "",
      " ",
      "@",
      "@@player",
      "Display name",
      "https://tiktok.com/@player",
      "player\u200b",
    ]) {
      expect(
        participationFormSchema.safeParse({ ...valid, tiktokId }).success,
      ).toBe(false);
    }
    expect(
      participationFormSchema.safeParse({ ...valid, ign: "\u200b" }).success,
    ).toBe(false);
  });
});
