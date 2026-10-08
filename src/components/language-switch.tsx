"use client";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import type { Locale } from "@/lib/i18n";
export function LanguageSwitch({ locale }: { locale: Locale }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <span className="language-select">
      <button
        type="button"
        className="preference-toggle"
        aria-label={
          locale === "en" ? "Switch to Bahasa Melayu" : "Switch to English"
        }
        title={
          locale === "en" ? "Switch to Bahasa Melayu" : "Switch to English"
        }
        disabled={pending}
        aria-busy={pending}
        onClick={() => {
          document.cookie = `pailangz_locale=${locale === "en" ? "ms" : "en"}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
          startTransition(() => router.refresh());
        }}
      >
        {locale === "en" ? "EN" : "BM"}
      </button>
      <span className="sr-only" role="status">
        {pending &&
          (locale === "en" ? "Changing language…" : "Menukar bahasa…")}
      </span>
    </span>
  );
}
