"use client";
import { signIn, signOut } from "next-auth/react";
import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { useRouter } from "next/navigation";
import type { Locale } from "@/lib/i18n";
export function LoginForm({ locale = "ms" }: { locale?: Locale }) {
  const t = (ms: string, en: string) => (locale === "en" ? en : ms);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [showPassword, setShowPassword] = useState(false);
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
            router.replace("/admin");
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
      <div className="password-control">
        <label htmlFor="staff-password">Password</label>
        <span className="password-field">
          <input
            id="staff-password"
            name="password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            required
          />
          <button
            className="password-toggle"
            type="button"
            aria-label={
              showPassword
                ? t("Sembunyikan password", "Hide password")
                : t("Tunjukkan password", "Show password")
            }
            aria-pressed={showPassword}
            onClick={() => setShowPassword((visible) => !visible)}
          >
            {showPassword ? (
              <EyeOff size={19} aria-hidden="true" />
            ) : (
              <Eye size={19} aria-hidden="true" />
            )}
          </button>
        </span>
      </div>
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
      onClick={() => signOut({ callbackUrl: "/staff" })}
    >
      Sign out ↗
    </button>
  );
}
