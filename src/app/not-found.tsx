import Link from "next/link";
import { getLocale, translate } from "@/lib/i18n";
export default async function NotFound() {
  const locale = await getLocale();
  const t = (ms: string, en: string) => translate(locale, ms, en);
  return (
    <div className="wrap section">
      <div className="empty">
        <h1>
          {t("Halaman belum tersedia.", "This page is not available yet.")}
        </h1>
        {t(
          "Kandungan ini belum diterbitkan atau tidak ditemui.",
          "This content is unpublished or could not be found.",
        )}
        <div className="actions justify-center">
          <Link href="/tournaments" className="button secondary">
            {t("Kembali ke kejohanan", "Back to tournaments")}
          </Link>
        </div>
      </div>
    </div>
  );
}
