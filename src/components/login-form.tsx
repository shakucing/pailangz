"use client";
import { signIn, signOut } from "next-auth/react";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Locale } from "@/lib/i18n";
export function LoginForm({ locale = "ms" }: { locale?: Locale }) {
  const t = (ms: string, en: string) => (locale === "en" ? en : ms);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const router = useRouter();
  return (
    <form
      className="form"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError("");
        const f = new FormData(e.currentTarget);
        try {
          const result = await signIn("credentials", {
            email: f.get("email"),
            password: f.get("password"),
            redirect: false,
          });
          if (result?.error) {
            setError(
              t(
                "Email atau password tidak sah. Sila cuba lagi.",
                "Invalid email or password. Please try again.",
              ),
            );
          } else {
            router.push("/moderator");
            router.refresh();
          }
        } catch {
          setError(
            t(
              "Login tidak tersedia. Sila cuba lagi.",
              "Login is unavailable. Please try again.",
            ),
          );
        } finally {
          setBusy(false);
        }
      }}
    >
      <label>
        {t("Email staff", "Staff email")}
        <input name="email" type="email" autoComplete="username" required />
      </label>
      <label>
        Password
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
      </label>
      {error && (
        <p className="feedback error" role="alert">
          {error}
        </p>
      )}
      <button className="button" disabled={busy}>
        {busy
          ? t("Sedang log masuk…", "Signing in…")
          : t("Masuk staff portal ↗", "Enter staff portal ↗")}
      </button>
    </form>
  );
}
export function Logout() {
  return (
    <button
      className="text-link"
      onClick={() => signOut({ callbackUrl: "/login" })}
    >
      Sign out ↗
    </button>
  );
}
