import { afterEach, describe, expect, it, vi } from "vitest";
import { assertEnvironment } from "../src/lib/db";

afterEach(() => vi.unstubAllEnvs());

function hostedTest() {
  for (const [name, value] of Object.entries({
    VERCEL: "1",
    VERCEL_ENV: "production",
    APP_ENV: "preview",
    DATABASE_ENV: "preview",
    LOCAL_PGLITE: "false",
    NEXTAUTH_URL: "https://pailangz-test.vercel.app",
    DATABASE_URL:
      "postgresql://pailangz_app:synthetic@ep-test.neon.tech/test?sslmode=require",
    EVIDENCE_STORAGE: "s3",
  }))
    vi.stubEnv(name, value);
}

describe("separate Vercel test project", () => {
  it("accepts the Vercel production target with the application's preview tier", () => {
    hostedTest();
    expect(() => assertEnvironment()).not.toThrow();
  });

  it.each([
    ["DATABASE_ENV", "production", "Non-production"],
    ["DATABASE_ENV", "development", "preview database"],
    ["LOCAL_PGLITE", "true", "PGlite owner"],
    ["NEXTAUTH_URL", "http://pailangz-test.vercel.app", "HTTPS"],
    [
      "DATABASE_URL",
      "postgresql://pailangz_app:synthetic@ep-test.neon.tech/test",
      "TLS",
    ],
    ["EVIDENCE_STORAGE", "local", "persistent private S3"],
  ])("rejects %s=%s", (name, value, message) => {
    hostedTest();
    vi.stubEnv(name, value);
    expect(() => assertEnvironment()).toThrow(message);
  });

  it("rejects production credentials in automatic preview deployments", () => {
    hostedTest();
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("APP_ENV", "production");
    vi.stubEnv("DATABASE_ENV", "production");
    expect(() => assertEnvironment()).toThrow("Non-production");
  });
});
