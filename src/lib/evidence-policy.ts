// Leave room for multipart fields below Vercel's 4.5 MB request limit.
export const MAX_EVIDENCE_BYTES = 4 * 1024 * 1024;
export const MAX_UPLOAD_REQUEST_BYTES = MAX_EVIDENCE_BYTES + 64 * 1024;

export function evidenceSizeError(size: number): string | undefined {
  if (size === 0) return "Select a screenshot that is not empty.";
  if (size > MAX_EVIDENCE_BYTES)
    return "The screenshot is too large. Choose a PNG, JPEG or WebP up to 4 MB.";
}
