"use client";

import { useLayoutEffect, useState } from "react";
import type { Locale } from "@/lib/i18n";

type Theme = "system" | "light" | "dark";
const cookieName = "pailangz_theme";

function readTheme(): Theme {
  try {
    const value = document.cookie
      .split("; ")
      .find((cookie) => cookie.startsWith(`${cookieName}=`))
      ?.slice(cookieName.length + 1);
    return value === "light" || value === "dark" ? value : "system";
  } catch {
    return "system";
  }
}

function applyTheme(theme: Theme) {
  if (theme === "system")
    document.documentElement.removeAttribute("data-theme");
  else document.documentElement.dataset.theme = theme;
}

export function ThemeSwitch({ locale }: { locale: Locale }) {
  const [theme, setTheme] = useState<Theme>("system");

  useLayoutEffect(() => {
    const sync = () => {
      const saved = readTheme();
      setTheme(saved);
      applyTheme(saved);
    };
    sync();
    window.addEventListener("focus", sync);
    return () => window.removeEventListener("focus", sync);
  }, []);

  return (
    <label className="theme-select">
      <span className="sr-only">{locale === "en" ? "Theme" : "Tema"}</span>
      <select
        aria-label={locale === "en" ? "Theme" : "Tema"}
        value={theme}
        onChange={(event) => {
          const next = event.target.value as Theme;
          setTheme(next);
          applyTheme(next);
          try {
            document.cookie = `${cookieName}=${next}; Path=/; Max-Age=${next === "system" ? 0 : 31536000}; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
          } catch {
            // Theme still changes for this page when cookies are unavailable.
          }
        }}
      >
        <option value="system">{locale === "en" ? "Device" : "Peranti"}</option>
        <option value="light">{locale === "en" ? "Light" : "Cerah"}</option>
        <option value="dark">{locale === "en" ? "Dark" : "Gelap"}</option>
      </select>
    </label>
  );
}
