import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { NavigationLink as Link } from "@/components/navigation-link";
import { TeamPortal } from "@/components/team-portal";
import {
  publicTeamEvent,
  publicTeams,
  memberCookie,
  teamState,
  teamRegistrationOpen,
} from "@/lib/team-portal";
import { getLocale, translate } from "@/lib/i18n";
import styles from "@/components/team-portal.module.css";
import { TeamAvatar } from "@/components/team-avatar";
import { participationStatus } from "@/lib/participation-status";
export const dynamic = "force-dynamic";
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string; teamSlug: string }>;
}) {
  const { slug, teamSlug } = await params;
  const team = (await publicTeams(slug)).find(
    (entry) => entry.slug === teamSlug,
  );
  return { title: team ? `${team.name} · PAILANGZ` : "Team · PAILANGZ" };
}
export default async function Team({
  params,
}: {
  params: Promise<{ slug: string; teamSlug: string }>;
}) {
  const { slug, teamSlug } = await params;
  const event = await publicTeamEvent(slug);
  if (!event) notFound();
  const team = (await publicTeams(slug)).find(
    (entry) => entry.slug === teamSlug,
  );
  if (!team) notFound();
  const state = await teamState(
    event.teamRosterManagement === "STAFF"
      ? undefined
      : (await cookies()).get(memberCookie)?.value,
    slug,
    teamSlug,
  );
  const locale = await getLocale();
  const t = (ms: string, en: string) => translate(locale, ms, en);
  const registration = await participationStatus(slug);
  return (
    <div className={`wrap ${styles.page}`}>
      <div className="page-heading">
        <Link className="text-link" href={`/tournaments/${slug}/teams`}>
          {t("← Semua pasukan", "← All teams")}
        </Link>
        <div className="eyebrow">
          {event.name} · {team.code}
        </div>
        <div className={styles.teamIdentity}>
          <TeamAvatar image={team.avatarImage} name={team.name} />
          <h1>{team.name}</h1>
        </div>
        <p className="muted">
          {team.ownerIgn ? `${t("Pemilik", "Owner")}: ${team.ownerIgn} · ` : ""}
          {team.playerCount}/4 {t("pemain", "players")}
        </p>
      </div>
      <div className={styles.layout}>
        <section className="panel">
          <h2>{t("Roster pasukan", "Team roster")}</h2>
          <ul className={styles.roster}>
            {team.roster.map((member) => (
              <li className={styles.rosterRow} key={member.ign}>
                <strong>{member.ign}</strong>
                {member.owner && (
                  <span className="badge">{t("Pemilik", "Owner")}</span>
                )}
              </li>
            ))}
          </ul>
          {team.playerCount < 4 && event.teamRosterManagement !== "STAFF" && (
            <p className="muted">
              {4 - team.playerCount}{" "}
              {t(
                "tempat tersedia. Permohonan tertakluk pada kelulusan pemilik.",
                "places available. Applications require owner approval.",
              )}
            </p>
          )}
        </section>
        {event.teamRosterManagement === "STAFF" ? (
          <section className="panel">
            <h2>{t("Penetapan pasukan", "Team assignments")}</h2>
            <p className="muted">
              {t(
                "Pemain mendaftar secara individu. Pihak staf membentuk pasukan dan mengurus semua penetapan roster.",
                "Players register individually. Staff form teams and manage all roster assignments.",
              )}
            </p>
            {registration === "OPEN" && (
              <Link className="button" href={`/participate/${slug}`}>
                {t("Daftar sebagai pemain", "Register as a player")}
              </Link>
            )}
          </section>
        ) : (
          <TeamPortal
            slug={slug}
            state={state}
            team={team}
            open={teamRegistrationOpen(event)}
            participationStatus={registration}
          />
        )}
      </div>
    </div>
  );
}
