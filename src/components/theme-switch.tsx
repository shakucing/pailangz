"use client";

import { useLayoutEffect, useState } from "react";
import { Monitor, Sun, Moon } from "lucide-react";
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
  const next: Theme =
    theme === "system" ? "light" : theme === "light" ? "dark" : "system";
  const labels =
    locale === "en"
      ? { system: "Device", light: "Light", dark: "Dark" }
      : { system: "Peranti", light: "Cerah", dark: "Gelap" };
  const label = `${locale === "en" ? "Theme" : "Tema"}: ${labels[theme]}. ${locale === "en" ? "Switch to" : "Tukar kepada"} ${labels[next]}`;

  return (
    <span className="theme-select">
      <button
        type="button"
        className="preference-toggle theme-toggle"
        aria-label={label}
        title={label}
        onClick={() => {
          setTheme(next);
          applyTheme(next);
          try {
            document.cookie = `${cookieName}=${next}; Path=/; Max-Age=${next === "system" ? 0 : 31536000}; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
          } catch {
            // Theme still changes for this page when cookies are unavailable.
          }
        }}
      >
        {theme === "system" ? (
          <Monitor size={19} aria-hidden="true" />
        ) : theme === "light" ? (
          <Sun size={19} aria-hidden="true" />
        ) : (
          <Moon size={19} aria-hidden="true" />
        )}
      </button>
      <span className="sr-only" role="status">
        {labels[theme]}
      </span>
    </span>
  );
}
