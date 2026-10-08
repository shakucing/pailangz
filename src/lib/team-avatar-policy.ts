export const TEAM_AVATAR_SIZE = 64;
export const MAX_TEAM_IMAGE_BYTES = 4 * 1024 * 1024;
export const MAX_TEAM_IMAGE_REQUEST_BYTES = MAX_TEAM_IMAGE_BYTES + 16 * 1024;
export const TEAM_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];

export function teamImageError(file: { size: number; type: string }) {
  if (file.size > MAX_TEAM_IMAGE_BYTES) return "IMAGE_TOO_LARGE";
  if (!file.size || !TEAM_IMAGE_TYPES.includes(file.type))
    return "INVALID_IMAGE";
}
