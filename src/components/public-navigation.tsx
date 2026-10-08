"use client";

import { usePathname } from "next/navigation";
import { NavigationLink } from "./navigation-link";
import type { Locale } from "@/lib/i18n";

export function PublicNavigation({ locale }: { locale: Locale }) {
  const pathname = usePathname();
  const t = (ms: string, en: string) => (locale === "en" ? en : ms);
  return (
    <nav className="public-nav" aria-label={t("Utama", "Main navigation")}>
      {[
        ["/", t("Komuniti", "Community")],
        ["/tournaments", t("Kejohanan", "Tournaments")],
      ].map(([href, label]) => (
        <NavigationLink
          key={href}
          href={href}
          aria-current={
            pathname === href ||
            (href !== "/" && pathname.startsWith(`${href}/`))
              ? "page"
              : undefined
          }
        >
          {label}
        </NavigationLink>
      ))}
    </nav>
  );
}
