import { DomainError } from "./domain";

export function assertPublicRequestOrigin(
  request: Request,
  configuredUrl = process.env.NEXTAUTH_URL,
) {
  const origin = request.headers.get("origin");
  const url = new URL(request.url);
  const allowed = new Set([url.origin]);
  if (configuredUrl) allowed.add(new URL(configuredUrl).origin);

  // Next can construct request.url with the listening address (0.0.0.0),
  // while the browser uses localhost or 127.0.0.1. Host is the request's
  // actual authority. Match it exactly; never trust forwarded-host aliases.
  const host = request.headers.get("host");
  if (host && !/[\s/\\@?#,]/u.test(host)) {
    try {
      allowed.add(new URL(`${url.protocol}//${host}`).origin);
    } catch {
      // A malformed Host never grants an additional allowed origin.
    }
  }
  if (!origin || !allowed.has(origin)) throw new DomainError("ORIGIN", 403);
}
