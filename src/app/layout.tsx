import type { Metadata } from "next";
import { headers } from "next/headers";
import { NavigationLink as Link } from "@/components/navigation-link";
import { Wordmark } from "@/components/wordmark";
import { HeaderBrand } from "@/components/header-brand";
import { LanguageSwitch } from "@/components/language-switch";
import { ThemeSwitch } from "@/components/theme-switch";
import { PublicNavigation } from "@/components/public-navigation";
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
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  const t = (ms: string, en: string) => translate(locale, ms, en);
  return (
    <html lang={locale} suppressHydrationWarning>
      <head>
        <script
          nonce={nonce}
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var m=document.cookie.match(/(?:^|; )pailangz_theme=([^;]*)/);var t=m&&m[1];if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)}catch(e){}})()`,
          }}
        />
      </head>
      <body>
        <LocaleProvider locale={locale}>
          <a href="#main" className="skip-link">
            {t("Langkau ke kandungan", "Skip to content")}
          </a>
          <header className="wrap">
            <div className="topbar">
              <HeaderBrand />
              <PublicNavigation locale={locale} />
              <div className="header-controls">
                <ThemeSwitch locale={locale} />
                <LanguageSwitch locale={locale} />
              </div>
            </div>
          </header>
          <main id="main" tabIndex={-1}>
            {children}
          </main>
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
              <a
                href="https://www.tiktok.com/@shafa7164"
                className="text-link"
                target="_blank"
                rel="noopener noreferrer"
              >
                Made by Sha Fa
              </a>
            </div>
          </footer>
        </LocaleProvider>
      </body>
    </html>
  );
}
