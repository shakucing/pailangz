"use client";
import { useLocale } from "@/components/locale-context";
import Link from "next/link";
export default function ErrorPage({ reset }: { reset: () => void }) {
  const locale = useLocale();
  const t = (ms: string, en: string) => (locale === "en" ? en : ms);
  return (
    <div className="wrap section">
      <div className="empty">
        <h1>
          {t("Halaman tidak dapat dimuatkan.", "Unable to load this page.")}
        </h1>
        {t("Sila cuba lagi sebentar nanti.", "Please try again shortly.")}
        <div className="actions justify-center">
          <button className="button" onClick={reset}>
            {t("Cuba lagi", "Try again")}
          </button>
          <Link href="/" className="button secondary">
            {t("Kembali ke halaman utama", "Back to home")}
          </Link>
        </div>
      </div>
    </div>
  );
}
