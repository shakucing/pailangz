import type { Metadata } from "next";
import { getLocale, translate } from "@/lib/i18n";
import { RegistrationForm } from "@/components/registration-form";
import styles from "@/components/registration-form.module.css";
import { COUNTRY_CODES } from "@/lib/registration-form";
export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  return {
    title: translate(locale, "Pendaftaran ahli", "Member registration"),
    robots: { index: false, follow: false },
  };
}
export default async function Register() {
  const locale = await getLocale();
  const t = (ms: string, en: string) => translate(locale, ms, en);
  // Send one country list to the client: browser and Node ICU versions can
  // otherwise produce different names/order during hydration.
  const countryNames = new Intl.DisplayNames([locale], { type: "region" });
  const countries = COUNTRY_CODES.map((code) => ({
    code,
    name: countryNames.of(code) ?? code,
  })).sort((a, b) => a.name.localeCompare(b.name, locale));
  return (
    <div className="wrap">
      <div className="page-heading">
        <div className="eyebrow">
          {t("Pemohon terpilih", "Selected applicants")}
        </div>
        <h1>{t("Permohonan ahli", "Member application")}</h1>
        <p className="muted">
          {t(
            "Borang ini dikongsi secara individu dengan pemohon terpilih. Lengkapkan maklumat kau untuk semakan moderator.",
            "This form is shared individually with selected applicants. Complete your details for moderator review.",
          )}
        </p>
      </div>
      <section className={styles.layout}>
        <aside className={`panel prose ${styles.aside}`}>
          <h3>{t("Proses permohonan", "Application process")}</h3>
          <ol className="space-y-5 pl-5">
            <li>
              <strong>
                {t(
                  "Isi borang pendaftaran.",
                  "Complete the registration form.",
                )}
              </strong>
              <p>
                {t(
                  "Gunakan IGN yang unik dan maklumat yang tepat.",
                  "Use a unique IGN and provide accurate information.",
                )}
              </p>
            </li>
            <li>
              <strong>
                {t("Tunggu semakan moderator.", "Wait for moderator review.")}
              </strong>
              <p>
                {t(
                  "Permohonan boleh diluluskan, ditolak, atau memerlukan penjelasan.",
                  "A submission may be approved, rejected or require clarification.",
                )}
              </p>
            </li>
            <li>
              <strong>
                {t(
                  "Sahkan penyertaan kejohanan.",
                  "Confirm tournament participation.",
                )}
              </strong>
              <p>
                {t(
                  "Kelulusan ahli dan slot kejohanan ialah dua proses berasingan.",
                  "Membership approval and tournament entry are separate processes.",
                )}
              </p>
            </li>
          </ol>
          <h3 className="mt-5">
            {t(
              "Maklumat pemain kekal sulit.",
              "Player information stays private.",
            )}
          </h3>
          <p className="muted">
            {t(
              "Nama dalam game SOLO bagi acara asal dipaparkan bersama kod peserta pada halaman utama dengan kebenaran pemain. Nombor WhatsApp, akaun sosial, lokasi dan jawapan pendaftaran hanya untuk moderator dan admin yang dibenarkan.",
              "The original event’s SOLO in-game names appear alongside participant codes on the landing page with players’ permission. WhatsApp numbers, social accounts, location and registration answers are accessible only to authorized moderators and admins.",
            )}
          </p>
        </aside>
        <RegistrationForm countries={countries} />
      </section>
    </div>
  );
}
