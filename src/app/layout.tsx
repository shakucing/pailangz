import type { Metadata } from "next";
import Link from "next/link";
import { Wordmark } from "@/components/wordmark";
import { LanguageSwitch } from "@/components/language-switch";
import { getLocale, translate } from "@/lib/i18n";
import { LocaleProvider } from "@/components/locale-context";
import "./globals.css";
export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  return {
    title: {
      default: translate(
        locale,
        "PAILANGZ — Main bersama. Naik bersama.",
        "PAILANGZ — Play together. Rise together.",
      ),
      template: "%s · PAILANGZ",
    },
    description: translate(
      locale,
      "Komuniti gaming PAILANGZ dan PAILANGZZ. Aktiviti bersama, persaingan sihat dan kejohanan Solo & Team.",
      "The PAILANGZ and PAILANGZZ gaming community. Shared activities, healthy competition and Solo & Team tournaments.",
    ),
  };
}
export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const locale = await getLocale();
  const t = (ms: string, en: string) => translate(locale, ms, en);
  return (
    <html lang={locale}>
      <body>
        <LocaleProvider locale={locale}>
          <a href="#main" className="sr-only focus:not-sr-only">
            {t("Langkau ke kandungan", "Skip to content")}
          </a>
          <header className="wrap">
            <div className="topbar">
              <Link href="/" className="brand">
                <Wordmark />
              </Link>
              <nav aria-label={t("Utama", "Main navigation")} className="nav">
                <Link href="/" className="optional">
                  {t("Komuniti", "Community")}
                </Link>
                <Link href="/tournaments">{t("Kejohanan", "Tournaments")}</Link>
                <Link href="/login" className="optional">
                  Staff portal
                </Link>
                <LanguageSwitch locale={locale} />
              </nav>
            </div>
          </header>
          <main id="main">{children}</main>
          <footer className="wrap">
            <div className="footer">
              <Link href="/" className="brand" style={{ fontSize: 16 }}>
                <Wordmark />
              </Link>
              <span>
                {t(
                  "Main bersama. Naik bersama.",
                  "Play together. Rise together.",
                )}
              </span>
              <Link href="/login">Staff portal ↗</Link>
            </div>
          </footer>
        </LocaleProvider>
      </body>
    </html>
  );
}
