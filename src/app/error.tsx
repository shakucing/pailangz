"use client";
import { useLocale } from "@/components/locale-context";
export default function ErrorPage({ reset }: { reset: () => void }) {
  const locale = useLocale();
  const t = (ms: string, en: string) => (locale === "en" ? en : ms);
  return (
    <div className="wrap section">
      <div className="empty">
        <strong>
          {t("Halaman tidak dapat dimuatkan.", "Unable to load this page.")}
        </strong>
        {t("Sila cuba lagi sebentar nanti.", "Please try again shortly.")}
        <div className="actions justify-center">
          <button className="button" onClick={reset}>
            {t("Cuba lagi", "Try again")}
          </button>
        </div>
      </div>
    </div>
  );
}
