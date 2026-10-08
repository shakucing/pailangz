import { describe, expect, it } from "vitest";
import { assertPublicRequestOrigin } from "../src/lib/request-origin";

const configured = "http://localhost:3000";
function request(origin?: string, host = "127.0.0.1:3001", extra = {}) {
  return new Request("http://0.0.0.0:3001/api/member-access", {
    method: "POST",
    headers: { host, ...(origin ? { origin } : {}), ...extra },
  });
}
describe("public form request origins", () => {
  it("accepts the actual browser host and port when Next uses its bind address", () => {
    expect(() =>
      assertPublicRequestOrigin(request("http://127.0.0.1:3001"), configured),
    ).not.toThrow();
    expect(() =>
      assertPublicRequestOrigin(
        request("http://localhost:3001", "localhost:3001"),
        configured,
      ),
    ).not.toThrow();
  });
  it("retains the configured public origin and native request origin", () => {
    expect(() =>
      assertPublicRequestOrigin(request(configured), configured),
    ).not.toThrow();
    expect(() =>
      assertPublicRequestOrigin(
        new Request("https://pailangz.example/api/member-access", {
          headers: { origin: "https://pailangz.example" },
        }),
        "https://canonical.example",
      ),
    ).not.toThrow();
  });
  it.each([
    undefined,
    "null",
    "https://untrusted.invalid",
    "http://127.0.0.1:3002",
    "https://127.0.0.1:3001",
    "http://127.0.0.1:3001.evil.example",
    "http://127.0.0.1:3001/extra",
  ])("rejects unrelated, missing or malformed origin %s", (origin) => {
    expect(() =>
      assertPublicRequestOrigin(request(origin), configured),
    ).toThrow("ORIGIN");
  });
  it("does not trust forwarded host headers", () => {
    expect(() =>
      assertPublicRequestOrigin(
        request("https://untrusted.invalid", "127.0.0.1:3001", {
          "x-forwarded-host": "untrusted.invalid",
          "x-forwarded-proto": "https",
        }),
        configured,
      ),
    ).toThrow("ORIGIN");
  });
  it.each([
    "127.0.0.1:3001@untrusted.invalid",
    "untrusted.invalid/path",
    "127.0.0.1:3001,untrusted.invalid",
  ])("does not interpret malformed Host %s as an origin", (host) => {
    expect(() =>
      assertPublicRequestOrigin(
        request("http://untrusted.invalid", host),
        configured,
      ),
    ).toThrow("ORIGIN");
  });
});
