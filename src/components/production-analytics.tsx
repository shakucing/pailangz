"use client";

import { Analytics } from "@vercel/analytics/next";
import { beforeSendProductionAnalytics } from "@/lib/analytics";

export function ProductionAnalytics() {
  return <Analytics beforeSend={beforeSendProductionAnalytics} />;
}
