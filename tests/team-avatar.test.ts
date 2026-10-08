import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { resizeTeamAvatar } from "../src/lib/team-avatar";
import { MAX_TEAM_IMAGE_BYTES } from "../src/lib/team-avatar-policy";

function upload(bytes: Uint8Array, type = "image/png") {
  return new File([Uint8Array.from(bytes)], "team-image", { type });
}
describe("team avatar uploads", () => {
  it.each(["png", "jpeg", "webp"] as const)(
    "stores a 64 × 64 WebP instead of the original %s",
    async (format) => {
      const original = await sharp({
        create: { width: 480, height: 240, channels: 3, background: "#b5e12c" },
      })
        .toFormat(format)
        .toBuffer();
      const result = await resizeTeamAvatar(
        upload(original, format === "jpeg" ? "image/jpeg" : `image/${format}`),
      );
      expect(result).toMatch(/^data:image\/webp;base64,/);
      const bytes = Buffer.from(result.split(",")[1], "base64");
      const metadata = await sharp(bytes).metadata();
      expect(metadata).toMatchObject({ width: 64, height: 64, format: "webp" });
      expect(result.length).toBeLessThan(32768);
    },
  );
  it("removes private image metadata and honors a rotated photo", async () => {
    const photo = await sharp({
      create: { width: 120, height: 240, channels: 3, background: "red" },
    })
      .withMetadata({ orientation: 6 })
      .withExifMerge({ IFD0: { Artist: "PRIVATE_IMAGE_CANARY" } })
      .jpeg()
      .toBuffer();
    const result = await resizeTeamAvatar(upload(photo, "image/jpeg"));
    const bytes = Buffer.from(result.split(",")[1], "base64");
    const metadata = await sharp(bytes).metadata();
    expect(metadata.width).toBe(64);
    expect(metadata.height).toBe(64);
    expect(metadata.exif).toBeUndefined();
    expect(metadata.orientation).toBeUndefined();
    expect(bytes.includes(Buffer.from("PRIVATE_IMAGE_CANARY"))).toBe(false);
  });
  it("rejects empty, corrupted, oversized and non-image files", async () => {
    await expect(resizeTeamAvatar(upload(new Uint8Array()))).rejects.toThrow(
      "INVALID_IMAGE",
    );
    await expect(
      resizeTeamAvatar(upload(Buffer.from("not an image"))),
    ).rejects.toThrow("INVALID_IMAGE");
    await expect(
      resizeTeamAvatar(upload(new Uint8Array(MAX_TEAM_IMAGE_BYTES + 1))),
    ).rejects.toThrow("IMAGE_TOO_LARGE");
    await expect(
      resizeTeamAvatar(upload(Buffer.from("<svg/>"), "image/svg+xml")),
    ).rejects.toThrow("INVALID_IMAGE");
    await expect(
      resizeTeamAvatar(
        upload(
          Buffer.from(
            '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100"/></svg>',
          ),
        ),
      ),
    ).rejects.toThrow("INVALID_IMAGE");
  });
});
