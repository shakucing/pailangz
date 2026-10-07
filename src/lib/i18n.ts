import { cookies } from "next/headers";
export type Locale = "ms" | "en";
export async function getLocale(): Promise<Locale> {
  return (await cookies()).get("pailangz_locale")?.value === "en" ? "en" : "ms";
}
export function translate(locale: Locale, ms: string, en: string) {
  return locale === "en" ? en : ms;
}
