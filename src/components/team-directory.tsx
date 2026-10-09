import { NavigationLink as Link } from "./navigation-link";
import { getLocale, translate } from "@/lib/i18n";
import type { PublicTeam } from "@/lib/team-portal";
import styles from "./team-portal.module.css";
import { TeamAvatar } from "./team-avatar";

export async function TeamDirectory({
  teams,
  slug,
  heading = true,
  showRegistration = true,
}: {
  teams: PublicTeam[];
  slug: string;
  heading?: boolean;
  showRegistration?: boolean;
}) {
  const locale = await getLocale();
  const t = (ms: string, en: string) => translate(locale, ms, en);
  const base = `/tournaments/${slug}/teams`;
  return (
    <section className={styles.directory} id="teams">
      {heading && (
        <div className="section-title">
          <div>
            <div className="eyebrow">SOLO &amp; TEAM</div>
            <h2>{t("Cari pasukan anda", "Find your team")}</h2>
            <p className="muted">
              {t(
                showRegistration
                  ? "Pemain yang diluluskan boleh cipta pasukan atau mohon untuk menyertai."
                  : "Lihat pasukan yang menyertai kejohanan.",
                showRegistration
                  ? "Approved tournament players can create a team or apply to join one."
                  : "View the teams participating in the tournament.",
              )}
            </p>
          </div>
          {showRegistration && (
            <Link className="button secondary" href={`${base}/new`}>
              {t("Daftar pasukan", "Register a team")}
            </Link>
          )}
        </div>
      )}
      {teams.length ? (
        <div className={styles.cards}>
          {teams.map((team) => (
            <Link
              key={team.slug}
              href={`${base}/${team.slug}`}
              className={`panel ${styles.card}`}
            >
              <div className={styles.cardTop}>
                <span className="eyebrow">{team.code}</span>
                <span
                  className={`badge ${team.playerCount >= 4 ? "" : "success"}`}
                >
                  {team.playerCount}/4 {t("pemain", "players")}
                </span>
              </div>
              <div className={styles.teamIdentity}>
                <TeamAvatar image={team.avatarImage} name={team.name} />
                <h3>{team.name}</h3>
              </div>
              <p className="muted">
                {team.ownerIgn
                  ? `${t("Pemilik", "Owner")}: ${team.ownerIgn}`
                  : t("Pasukan diurus moderator", "Moderator-managed team")}
              </p>
              <span className={styles.cardLink}>
                {t("Lihat pasukan", "View team")}{" "}
                <span aria-hidden="true">↗</span>
              </span>
            </Link>
          ))}
        </div>
      ) : (
        <div className="empty">
          <strong>
            {t(
              showRegistration
                ? "Pasukan pertama bermula dengan anda."
                : "Pasukan belum tersedia.",
              showRegistration
                ? "The first team starts with you."
                : "No teams available yet.",
            )}
          </strong>
          <p>
            {t(
              showRegistration
                ? "Selepas penyertaan kejohanan diluluskan, daftar pasukan dan terima permohonan pemain."
                : "Pasukan kejohanan akan dipaparkan di sini apabila tersedia.",
              showRegistration
                ? "Once your tournament participation is approved, register a team and receive player applications."
                : "Tournament teams will appear here when available.",
            )}
          </p>
        </div>
      )}
    </section>
  );
}
