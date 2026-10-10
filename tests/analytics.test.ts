import { describe, expect, it } from "vitest";
import {
  beforeSendProductionAnalytics,
  isProductionAnalyticsEnabled,
} from "../src/lib/analytics";

const production = { APP_ENV: "production", VERCEL_ENV: "production" };

describe("production-only analytics", () => {
  it("enables the canonical production app", () => {
    expect(
      isProductionAnalyticsEnabled(production, "pailangz.vercel.app"),
    ).toBe(true);
  });

  it.each([
    ["preview", "production", "pailangz-test.vercel.app"],
    ["preview", "production", "pailangz.vercel.app"],
    ["production", "preview", "pailangz.vercel.app"],
    ["development", "development", "localhost:3000"],
    ["production", "production", "pailangz-test.vercel.app"],
    ["production", "production", "pailangz-git-main.vercel.app"],
    ["production", "production", "pailangz.vercel.app.example.com"],
    ["production", "production", null],
    [undefined, undefined, "pailangz.vercel.app"],
  ])("disables %s / %s at %s", (APP_ENV, VERCEL_ENV, hostname) => {
    expect(
      isProductionAnalyticsEnabled({ APP_ENV, VERCEL_ENV }, hostname),
    ).toBe(false);
  });

  it.each(["pageview", "event"] as const)(
    "preserves production %s paths while removing private parameters",
    (type) => {
      expect(
        beforeSendProductionAnalytics({
          type,
          url: "https://pailangz.vercel.app/member-access?token=private#details",
        }),
      ).toEqual({ type, url: "https://pailangz.vercel.app/member-access" });
    },
  );

  it.each([
    "https://pailangz-test.vercel.app/",
    "https://pailangz-git-main.vercel.app/",
    "http://localhost:3000/",
    "http://pailangz.vercel.app/",
    "https://pailangz.vercel.app.example.com/",
    "https://pailangz.vercel.app:3000/",
    "invalid",
  ])("drops events from %s", (url) => {
    expect(beforeSendProductionAnalytics({ type: "pageview", url })).toBeNull();
  });
});
