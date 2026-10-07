import { DomainError } from "./domain";

// Enforce actual bytes, including chunked requests without Content-Length.
export async function boundedBody(
  request: Request,
  limit: number,
): Promise<Uint8Array<ArrayBuffer>> {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (!Number.isFinite(declared) || declared < 0 || declared > limit)
    throw new DomainError("Request is too large.", 413);
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new DomainError("Request is too large.", 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}
export async function boundedJson(
  request: Request,
  limit: number,
): Promise<unknown> {
  try {
    return JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(
        await boundedBody(request, limit),
      ),
    );
  } catch (e) {
    if (e instanceof DomainError) throw e;
    throw new DomainError("Please send a valid request.", 400);
  }
}
export async function boundedFormData(
  request: Request,
  limit: number,
): Promise<FormData> {
  const bytes = await boundedBody(request, limit);
  try {
    return await new Response(bytes, {
      headers: { "Content-Type": request.headers.get("content-type") ?? "" },
    }).formData();
  } catch {
    throw new DomainError("Please select a valid file.", 400);
  }
}
