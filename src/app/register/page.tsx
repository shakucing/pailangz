import { db } from "@/lib/db";
import { validResponder } from "@/lib/operations";
import { getLocale, translate } from "@/lib/i18n";
export const dynamic = "force-dynamic";
export default async function Register() {
  const locale = await getLocale();
  const t = (ms: string, en: string) => translate(locale, ms, en);
  const setting = process.env.DATABASE_URL
    ? await db.integrationSetting.findUnique({
        where: { key: "responderUrl" },
        select: { value: true },
      })
    : null;
  const url =
    typeof setting?.value === "string"
      ? setting.value
      : process.env.GOOGLE_FORM_RESPONDER_URL;
  return (
    <div className="wrap">
      <div className="page-heading">
        <div className="eyebrow">Welcome to the gang</div>
        <h1>{t("Sertai komuniti.", "Join the community.")}</h1>
        <p className="muted">
          {t(
            "Daftar IGN kau. Moderator akan semak permohonan sebelum pengesahan.",
            "Register your IGN. A moderator will review your submission before approval.",
          )}
        </p>
      </div>
      <section className="grid2 section" style={{ paddingTop: 0 }}>
        <div className="panel prose">
          <h3>{t("Tiga langkah untuk mula", "Three steps to get started")}</h3>
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
        </div>
        <div className="panel">
          <span className="badge neutral">
            {t("Pendaftaran ahli", "Member registration")}
          </span>
          <h3 className="mt-5">
            {t(
              "Maklumat pemain kekal sulit.",
              "Player information stays private.",
            )}
          </h3>
          <p className="muted">
            {t(
              "Nama dalam game, nombor WhatsApp, akaun sosial, lokasi dan jawapan pendaftaran hanya untuk moderator dan admin yang dibenarkan. Paparan awam menggunakan kod peserta.",
              "In-game names, WhatsApp numbers, social accounts, location and registration answers are accessible only to authorized moderators and admins. Public views use participant codes.",
            )}
          </p>
          {url && validResponder(url) ? (
            <a
              href={url}
              className="button"
              target="_blank"
              rel="noopener noreferrer"
            >
              {t("Buka borang pendaftaran ↗", "Open registration form ↗")}
            </a>
          ) : (
            <div className="notice">
              {t(
                "Borang pendaftaran belum disambungkan. Pautan rasmi akan dipaparkan selepas disahkan oleh admin.",
                "The registration form is not connected yet. The official link will appear after admin verification.",
              )}
            </div>
          )}
          <p className="muted text-xs mt-6">
            {t(
              "Pendaftaran tidak mencipta akaun staff atau memberikan akses moderator.",
              "Registration does not create a staff account or grant moderator access.",
            )}
          </p>
        </div>
      </section>
    </div>
  );
}
