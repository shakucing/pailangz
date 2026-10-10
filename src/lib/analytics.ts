import type { BeforeSendEvent } from "@vercel/analytics/next";

const productionHostname = "pailangz.vercel.app";

export function isProductionAnalyticsEnabled(
  environment: { APP_ENV?: string; VERCEL_ENV?: string },
  hostname: string | null,
) {
  return (
    environment.APP_ENV === "production" &&
    environment.VERCEL_ENV === "production" &&
    hostname === productionHostname
  );
}

export function beforeSendProductionAnalytics(event: BeforeSendEvent) {
  try {
    const url = new URL(event.url);
    if (url.origin !== `https://${productionHostname}`) return null;
    // Member access links and form URLs can contain private query parameters.
    url.search = "";
    url.hash = "";
    return { ...event, url: url.href };
  } catch {
    return null;
  }
}
