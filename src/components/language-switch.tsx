"use client";
import { useRouter } from "next/navigation";
import type { Locale } from "@/lib/i18n";
export function LanguageSwitch({ locale }: { locale: Locale }) {
  const router = useRouter();
  return (
    <label className="language-select">
      <span className="sr-only">{locale === "en" ? "Language" : "Bahasa"}</span>
      <select
        aria-label={locale === "en" ? "Language" : "Bahasa"}
        value={locale}
        onChange={(e) => {
          document.cookie = `pailangz_locale=${e.target.value}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
          router.refresh();
        }}
      >
        <option value="ms">BM</option>
        <option value="en">EN</option>
      </select>
    </label>
  );
}
