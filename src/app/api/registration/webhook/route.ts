import { createHmac, timingSafeEqual } from "node:crypto";
import { boundedBody } from "@/lib/request-body";
import { DomainError } from "@/lib/domain";
// Adapter boundary only: no background service-role ingestion is enabled until an operator
// provisions an integration actor and its explicitly scoped permissions.
export async function POST(request: Request) {
  const headers = { "Cache-Control": "private, no-store" };
  const secret = process.env.REGISTRATION_WEBHOOK_SECRET;
  if (!secret)
    return Response.json(
      { error: "Integration disconnected." },
      { status: 503, headers },
    );
  const timestamp = request.headers.get("x-pailangz-timestamp") ?? "";
  if (
    !/^\d{13}$/.test(timestamp) ||
    Math.abs(Date.now() - Number(timestamp)) > 300000
  )
    return Response.json(
      { error: "Invalid signature." },
      { status: 401, headers },
    );
  let body: string;
  try {
    body = new TextDecoder().decode(await boundedBody(request, 2_000_000));
  } catch (e) {
    return Response.json(
      { error: "Payload too large." },
      { status: e instanceof DomainError ? e.status : 400, headers },
    );
  }
  const expected = createHmac("sha256", secret)
    .update(`${timestamp}.${body}`)
    .digest();
  const supplied = Buffer.from(
    request.headers.get("x-pailangz-signature") ?? "",
    "hex",
  );
  if (
    expected.length !== supplied.length ||
    !timingSafeEqual(expected, supplied)
  )
    return Response.json(
      { error: "Invalid signature." },
      { status: 401, headers },
    );
  return Response.json(
    {
      error:
        "Signature verified; automated ingestion is not configured. Use the staff CSV import.",
    },
    { status: 503, headers },
  );
}
