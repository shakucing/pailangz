import sharp from "sharp";
import { DomainError } from "./domain";
import { TEAM_AVATAR_SIZE, teamImageError } from "./team-avatar-policy";

export async function resizeTeamAvatar(file: File): Promise<string> {
  const invalid = teamImageError(file);
  if (invalid)
    throw new DomainError(invalid, invalid === "IMAGE_TOO_LARGE" ? 413 : 400);
  try {
    const pipeline = sharp(Buffer.from(await file.arrayBuffer()), {
      limitInputPixels: 40_000_000,
      failOn: "warning",
    });
    const metadata = await pipeline.metadata();
    if (
      !metadata.format ||
      !["jpeg", "png", "webp"].includes(metadata.format) ||
      (metadata.pages ?? 1) !== 1
    )
      throw new Error("Unsupported image");
    const output = await pipeline
      .rotate()
      .resize(TEAM_AVATAR_SIZE, TEAM_AVATAR_SIZE, {
        fit: "cover",
        position: "centre",
      })
      .webp({ quality: 85 })
      .toBuffer();
    const image = `data:image/webp;base64,${output.toString("base64")}`;
    if (image.length > 32768) throw new Error("Avatar too large");
    return image;
  } catch {
    throw new DomainError("INVALID_IMAGE", 400);
  }
}
