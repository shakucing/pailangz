import { DomainError } from "./domain";

export function assertStaffRequestOrigin(
  request: Request,
  configuredUrl = process.env.NEXTAUTH_URL ?? "http://localhost:3000",
  environment: {
    APP_ENV?: string;
    VERCEL?: string;
    VERCEL_ENV?: string;
  } = process.env,
) {
  const origin = request.headers.get("origin");
  const configured = new URL(configuredUrl);
  if (origin === configured.origin) return;

  // Local previews can use either loopback address. Keep production restricted
  // to the configured origin, and local aliases to the same protocol and port.
  if (
    origin &&
    environment.APP_ENV === "development" &&
    !environment.VERCEL &&
    !environment.VERCEL_ENV
  ) {
    try {
      const incoming = new URL(origin);
      const target = new URL(request.url);
      const host = request.headers.get("host");
      const authority = host
        ? !/[\s/\\@?#,]/u.test(host)
          ? new URL(`${target.protocol}//${host}`).origin
          : null
        : target.origin;
      const loopback = (hostname: string) =>
        ["localhost", "127.0.0.1", "[::1]"].includes(hostname);
      if (
        origin === incoming.origin &&
        loopback(configured.hostname) &&
        loopback(incoming.hostname) &&
        incoming.protocol === configured.protocol &&
        incoming.port === configured.port &&
        authority === origin
      )
        return;
    } catch {
      // Malformed origins and hosts never grant an additional allowed origin.
    }
  }
  throw new DomainError("Invalid request origin.", 403);
}

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
