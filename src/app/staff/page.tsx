import { LoginForm } from "@/components/login-form";
import { getLocale, translate } from "@/lib/i18n";
import { Wordmark } from "@/components/wordmark";

export const dynamic = "force-dynamic";
export default async function StaffLogin() {
  const locale = await getLocale();
  const t = (ms: string, en: string) => translate(locale, ms, en);
  return (
    <div className="wrap">
      <section className="login-card panel">
        <Wordmark />
        <div className="eyebrow mt-4">Staff access</div>
        <h1 className="mt-5">
          {t("Jaga gang.", "Care for the gang.")}
          <br />
          {t("Urus arena.", "Manage the arena.")}
        </h1>
        <p className="muted text-sm">
          {t(
            "Untuk admin dan moderator sahaja. Log masuk dengan email dan password anda.",
            "For admins and moderators only. Sign in with your email and password.",
          )}
        </p>
        <LoginForm locale={locale} />
        <hr className="divider" />
        <p className="muted text-xs mb-0">
          {t(
            "Minta admin komuniti menyediakan akaun moderator anda. Admin boleh mengurus akaun staff dalam portal.",
            "Ask a community admin to create your moderator account. Admins manage staff accounts inside the portal.",
          )}
        </p>
      </section>
    </div>
  );
}
