import { describe, expect, it } from "vitest";
import {
  assertPublicRequestOrigin,
  assertStaffRequestOrigin,
} from "../src/lib/request-origin";

const configured = "http://localhost:3000";
describe("staff request origins", () => {
  const development = { APP_ENV: "development" };
  function staffRequest(
    origin = "http://127.0.0.1:3000",
    host = "127.0.0.1:3000",
  ) {
    return new Request("http://0.0.0.0:3000/api/staff", {
      method: "POST",
      headers: { origin, host },
    });
  }
  it("accepts the local preview address when authentication is configured with localhost", () => {
    expect(() =>
      assertStaffRequestOrigin(staffRequest(), configured, development),
    ).not.toThrow();
    expect(() =>
      assertStaffRequestOrigin(
        staffRequest("http://[::1]:3000", "[::1]:3000"),
        configured,
        development,
      ),
    ).not.toThrow();
    expect(() =>
      assertStaffRequestOrigin(
        staffRequest(configured, "localhost:3000"),
        "http://127.0.0.1:3000",
        development,
      ),
    ).not.toThrow();
  });
  it("always accepts the exact configured origin", () => {
    expect(() =>
      assertStaffRequestOrigin(staffRequest(configured), configured, {
        APP_ENV: "production",
      }),
    ).not.toThrow();
  });
  it.each([
    {},
    { APP_ENV: "production" },
    { APP_ENV: "preview" },
    { APP_ENV: "development", VERCEL: "1" },
    { APP_ENV: "development", VERCEL_ENV: "preview" },
    { APP_ENV: "development", VERCEL_ENV: "production" },
  ])(
    "rejects local aliases outside standalone development (%j)",
    (environment) => {
      expect(() =>
        assertStaffRequestOrigin(staffRequest(), configured, environment),
      ).toThrow("Invalid request origin.");
    },
  );
  it.each([
    ["https://untrusted.invalid", "untrusted.invalid"],
    ["http://127.0.0.1:3001", "127.0.0.1:3001"],
    ["https://127.0.0.1:3000", "127.0.0.1:3000"],
    ["http://127.0.0.1:3000/extra", "127.0.0.1:3000"],
    ["http://127.0.0.1:3000", "localhost:3000"],
    ["http://127.0.0.1:3000", "127.0.0.1:3000@untrusted.invalid"],
    ["null", "127.0.0.1:3000"],
  ])("rejects unrelated or malformed origin %s / host %s", (origin, host) => {
    expect(() =>
      assertStaffRequestOrigin(
        staffRequest(origin, host),
        configured,
        development,
      ),
    ).toThrow("Invalid request origin.");
  });
  it("rejects absent origins and forwarded host spoofing", () => {
    expect(() =>
      assertStaffRequestOrigin(
        new Request("http://127.0.0.1:3000/api/staff"),
        configured,
        development,
      ),
    ).toThrow();
    const spoofed = staffRequest("https://untrusted.invalid");
    spoofed.headers.set("x-forwarded-host", "untrusted.invalid");
    spoofed.headers.set("x-forwarded-proto", "https");
    expect(() =>
      assertStaffRequestOrigin(spoofed, configured, development),
    ).toThrow();
  });
});
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
