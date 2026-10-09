import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { NavigationLink as Link } from "@/components/navigation-link";
import { TeamPortal } from "@/components/team-portal";
import {
  publicTeamEvent,
  memberCookie,
  teamState,
  teamRegistrationOpen,
} from "@/lib/team-portal";
import { getLocale, translate } from "@/lib/i18n";
import { participationStatus } from "@/lib/participation-status";
import styles from "@/components/team-portal.module.css";
export const dynamic = "force-dynamic";
export const metadata = {
  title: "Register a team · PAILANGZ & PAILANGZZ",
  robots: { index: false },
};
export default async function NewTeam({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const event = await publicTeamEvent(slug);
  if (!event) notFound();
  if (event.teamRosterManagement === "STAFF") redirect(`/participate/${slug}`);
  const state = await teamState(
    (await cookies()).get(memberCookie)?.value,
    slug,
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
        <div className="eyebrow">{event.name}</div>
        <h1>{t("Bina pasukan anda.", "Build your team.")}</h1>
        <nav
          aria-label={t(
            "Langkah pendaftaran pasukan",
            "Team registration steps",
          )}
        >
          <ol className={styles.steps}>
            <li>
              {registration && registration !== "OPEN" ? (
                <span>{t("Pendaftaran ditutup", "Registration closed")}</span>
              ) : (
                <Link href={`/participate/${slug}`}>
                  {t("Kelulusan kejohanan", "Tournament approval")}
                </Link>
              )}
            </li>
            <li>
              <Link href="#team-registration">
                {t("Daftar pasukan", "Register your team")}
              </Link>
            </li>
            <li>
              <Link
                href={
                  state?.teamSlug
                    ? `/tournaments/${slug}/teams/${state.teamSlug}#team-applications`
                    : "#team-applications"
                }
              >
                {t("Semak permohonan pemain", "Review player applications")}
              </Link>
            </li>
          </ol>
        </nav>
      </div>
      <TeamPortal
        slug={slug}
        state={state}
        open={teamRegistrationOpen(event)}
        participationStatus={registration}
      />
      {!state?.teamSlug && (
        <section
          id="team-applications"
          className={`panel ${styles.applicationHelp}`}
        >
          <h2>{t("Semak permohonan pemain", "Review player applications")}</h2>
          <p className="muted">
            {t(
              "Daftar pasukan anda dahulu. Permohonan pemain akan muncul di halaman pasukan anda untuk anda luluskan atau tolak.",
              "Register your team first. Player applications will appear on your team page, where you can approve or reject them.",
            )}
          </p>
          <Link className="text-link" href="#team-registration">
            {t("Daftar pasukan anda ↑", "Register your team ↑")}
          </Link>
        </section>
      )}
    </div>
  );
}
