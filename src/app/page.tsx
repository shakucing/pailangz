import { NavigationLink as Link } from "@/components/navigation-link";
import { ArrowUpRight, Swords, Users, Trophy } from "lucide-react";
import { FadeContent } from "@/components/react-bits/fade-content";
import { SpotlightCard } from "@/components/react-bits/spotlight-card";
import { Wordmark } from "@/components/wordmark";
import { HeroOrbit } from "@/components/hero-orbit";
import { LandingEventCentre } from "@/components/landing-event-centre";
import { landingEventPresentations } from "@/lib/event-presentation-data";
import { newTournamentConfiguration } from "@/lib/tournament-config";
import { publicTeams, publicTeamEvent } from "@/lib/team-portal";
import {
  participationStatus,
  registrationEvent,
} from "@/lib/participation-status";
import { TeamDirectory } from "@/components/team-directory";
import { AnnouncementCard } from "@/components/announcement-card";
import { getLocale, translate } from "@/lib/i18n";
import {
  publishedTournaments,
  publishedAnnouncements,
  dateText,
} from "@/lib/public-data";
export const dynamic = "force-dynamic";
export default async function Home() {
  const locale = await getLocale();
  const t = (ms: string, en: string) => translate(locale, ms, en);
  const [tournaments, announcements] = await Promise.all([
    publishedTournaments(),
    publishedAnnouncements(),
  ]);
  const events = await landingEventPresentations();
  const event = events[0];
  const featured = event
    ? tournaments.find((tournament) => tournament.slug === event.slug)
    : tournaments[0];
  const teamSlug = event?.slug ?? featured?.slug ?? "pailangz-solo-team";
  const [registration, entryStatus, teamEvent, presentations] =
    await Promise.all([
      registrationEvent(teamSlug),
      participationStatus(teamSlug),
      publicTeamEvent(teamSlug),
      Promise.all(
        events.map(async (data) => {
          const teams = await publicTeams(data.slug);
          const hasTeams = data.categories.some(
            (category) => category.kind === "TEAM",
          );
          return {
            data,
            teams: teams.map(({ code, name, avatarImage }) => ({
              code,
              name,
              avatarImage,
            })),
            directory:
              hasTeams && teams.length ? (
                <TeamDirectory
                  teams={teams}
                  slug={data.slug}
                  showRegistration={false}
                />
              ) : null,
          };
        }),
      ),
    ]);
  const arena = registration ?? featured;
  const config =
    event?.configuration ??
    featured?.configuration ??
    newTournamentConfiguration;
  return (
    <div className="wrap">
      <section className="hero">
        <FadeContent>
          <div className="eyebrow">PAILANGZ & PAILANGZZ · Gaming community</div>
          <h1>
            {t("MAIN BERSAMA.", "PLAY TOGETHER.")}
            <br />
            <span className="text-lime">
              {t("NAIK BERSAMA.", "RISE TOGETHER.")}
            </span>
          </h1>
          <p>
            {t(
              "Bukan sekadar satu gang. Tempat kita lepak, uji skill, dan cipta momen yang jadi cerita.",
              "More than a gaming gang. A place to hang out, test your skills and make moments worth remembering.",
            )}
          </p>
          <div className="actions">
            <Link className="button secondary" href="/solo">
              {t("Terokai Solo ↗", "Explore Solo ↗")}
            </Link>
            {registration && (
              <a className="button" href="#tournament-registration">
                {t("Pendaftaran kejohanan", "Tournament registration")}
                <ArrowUpRight size={15} aria-hidden="true" />
              </a>
            )}
            <Link
              className={`button${registration ? " secondary" : ""}`}
              href="/tournaments"
            >
              {t("Lihat kejohanan", "View tournaments")}
            </Link>
            {events.length > 0 && (
              <a className="button secondary" href="#tournament-format">
                {t("Lihat format", "Explore the format")}
              </a>
            )}
          </div>
          <p style={{ fontSize: 11, marginTop: 24, letterSpacing: 1 }}>
            {t("DUA GANG. SATU SEMANGAT.", "TWO GANGS. ONE SPIRIT.")}
          </p>
        </FadeContent>
        <div className="hero-visual" aria-hidden="true">
          <HeroOrbit />
          <span className="hud tl">PZ / COMMUNITY SIGNAL</span>
          <div className="orbit" />
          <div className="orbit two" />
          <Wordmark hero />
          <span className="visual-tag">BUILT FOR THE GANG</span>
          <span className="hud br">SOLO SKILL. TEAM SPIRIT. +</span>
        </div>
      </section>
      <div className="stats">
        <div className="stat">
          <strong>02</strong>
          <span>{t("Gang, satu komuniti", "Gangs, one community")}</span>
        </div>
        <div className="stat">
          <strong>
            {config.format === "TEAM"
              ? config.teamCapacity
              : config.soloCapacity}
          </strong>
          <span>
            {config.format === "TEAM"
              ? t("Pasukan dirancang", "Planned teams")
              : t("Slot SOLO dirancang", "Planned SOLO slots")}
          </span>
        </div>
        <div className="stat">
          <strong>
            {config.format === "TEAM"
              ? config.teamBracketSize
              : config.soloBracketSize}
          </strong>
          <span>{t("Slot knockout", "Knockout places")}</span>
        </div>
        <div className="stat">
          <strong>
            {config.format === "TEAM"
              ? "04"
              : String(config.leagueRounds).padStart(2, "0")}
          </strong>
          <span>
            {config.format === "TEAM"
              ? t("Pemain setiap pasukan", "Players per team")
              : t("Pusingan liga SOLO", "SOLO league rounds")}
          </span>
        </div>
      </div>
      <FadeContent>
        <section className="section" id="tournament-registration">
          <div className="section-title">
            <div>
              <div className="eyebrow">
                {t("Arena seterusnya", "The next arena")}
              </div>
              <h2>{t("Skill anda. Pentas kita.", "Your skill. Our arena.")}</h2>
            </div>
            <Link href="/tournaments" className="text-link">
              {t("Semua kejohanan ↗", "All tournaments ↗")}
            </Link>
          </div>
          <div className="feature">
            <div className="feature-body">
              <span
                className={`badge ${registration ? (entryStatus === "OPEN" ? "success" : "warning") : featured ? "" : "warning"}`}
              >
                {registration
                  ? entryStatus === "OPEN"
                    ? t("Pendaftaran pemain dibuka", "Player registration open")
                    : entryStatus === "FULL"
                      ? t("Slot pemain penuh", "Player places full")
                      : t(
                          "Pendaftaran pemain ditutup",
                          "Player registration closed",
                        )
                  : featured
                    ? t("Kejohanan diterbitkan", "Published tournament")
                    : t("Dalam persediaan", "In preparation")}
              </span>
              <h2 style={{ marginTop: 20 }}>
                {arena?.name ?? "PAILANGZ & PAILANGZZ"}
                <br />
                {!arena && (
                  <span className="muted">
                    {config.format ?? "Solo & Team"} Tournament
                  </span>
                )}
              </h2>
              <p className="muted">
                {(registration
                  ? locale === "en" && registration.overviewEn
                    ? registration.overviewEn
                    : registration.overview
                  : featured?.overview) ??
                  t(
                    "Sertai kejohanan komuniti dan buktikan kemahiran anda.",
                    "Join the community tournament and show your skills.",
                  )}
              </p>
              <p className="text-sm">
                {dateText(arena?.startsAt ?? null, locale)}
              </p>
              {registration && (
                <div className="landing-registration">
                  <p className="text-sm">
                    {entryStatus === "FULL"
                      ? t(
                          `Semua ${registration.capacity} slot pemain telah diisi.`,
                          `All ${registration.capacity} player places are filled.`,
                        )
                      : t(
                          `Pendaftaran pemain untuk kejohanan ${registration.format ?? "SOLO & TEAM"} ini.`,
                          `Player registration for this ${registration.format ?? "SOLO & TEAM"} tournament.`,
                        )}
                  </p>
                  {registration.registrationDeadline && (
                    <p className="muted text-sm">
                      {t("Pendaftaran ditutup", "Registration closes")}:{" "}
                      {dateText(registration.registrationDeadline, locale)}
                    </p>
                  )}
                  <div className="actions">
                    <Link
                      className={`button${entryStatus === "OPEN" ? "" : " secondary"}`}
                      href={`/participate/${registration.slug}`}
                    >
                      {entryStatus === "OPEN"
                        ? t(
                            `Daftar pemain · ${registration.format ?? "SOLO & TEAM"}`,
                            `Register as a player · ${registration.format ?? "SOLO & TEAM"}`,
                          )
                        : t(
                            "Lihat status pendaftaran",
                            "View registration status",
                          )}
                      <ArrowUpRight size={15} aria-hidden="true" />
                    </Link>
                    {teamEvent && (
                      <Link
                        className="button secondary"
                        href={`/tournaments/${registration.slug}/teams`}
                      >
                        {t("Lihat pasukan", "View teams")}
                      </Link>
                    )}
                  </div>
                </div>
              )}
              {featured && (
                <Link
                  className="button secondary"
                  href={`/tournaments/${featured.slug}`}
                >
                  {t("Lihat kejohanan", "View tournaments")}{" "}
                  <ArrowUpRight size={15} />
                </Link>
              )}
            </div>
            <div className="feature-art" aria-hidden="true">
              {config.format !== "TEAM" && (
                <div className="category-block">
                  <Swords className="mx-auto mb-4 text-lime" size={32} />
                  <strong>SOLO</strong>
                  <span>
                    1V1 ·{" "}
                    {[
                      ...new Set([
                        config.leagueBestOf,
                        config.soloKnockoutBestOf,
                        config.soloFinalBestOf,
                      ]),
                    ]
                      .map((n) => `BO${n}`)
                      .join(" / ")}
                  </span>
                </div>
              )}
              {config.format !== "SOLO" && (
                <div className="category-block">
                  <Users className="mx-auto mb-4 text-sky-300" size={32} />
                  <strong>TEAM</strong>
                  <span>4 PLAYERS · 1 TEAM</span>
                </div>
              )}
            </div>
          </div>
        </section>
      </FadeContent>
      {presentations.length > 0 && (
        <section
          className="section"
          style={{ paddingTop: 0 }}
          id="tournament-format"
        >
          <LandingEventCentre events={presentations} />
        </section>
      )}
      <FadeContent>
        <section className="section" style={{ paddingTop: 0 }}>
          <div className="section-title">
            <div>
              <div className="eyebrow">
                {t("Lebih daripada menang", "More than winning")}
              </div>
              <h2>
                {t(
                  "Gang yang aktif. Game yang sihat.",
                  "An active gang. Healthy competition.",
                )}
              </h2>
            </div>
          </div>
          <div className="grid3">
            {[
              {
                icon: Users,
                title: t("Lepak, main, connect.", "Hang out, play, connect."),
                text: t(
                  "Lebih banyak aktiviti bersama untuk buat group lebih hidup dan menyeronokkan.",
                  "More shared activities to make the community more active and enjoyable.",
                ),
              },
              {
                icon: Swords,
                title: t("Buktikan skill anda.", "Show your skills."),
                text: t(
                  "Persaingan sihat untuk kenali pemain solo dan team yang paling mantap.",
                  "Healthy competition to recognize strong solo players and teams.",
                ),
              },
              {
                icon: Trophy,
                title: t("Sumbang untuk gang.", "Contribute to the gang."),
                text: t(
                  "Hargai usaha dan sumbangan kepada leaderboard PAILANGZ dan PAILANGZZ.",
                  "Recognize effort and contributions to the PAILANGZ and PAILANGZZ gang leaderboard.",
                ),
              },
            ].map((x) => (
              <SpotlightCard className="panel" key={x.title}>
                <div className="icon-box">
                  <x.icon size={20} />
                </div>
                <h3>{x.title}</h3>
                <p className="muted text-sm mb-0">{x.text}</p>
              </SpotlightCard>
            ))}
          </div>
        </section>
      </FadeContent>
      <FadeContent>
        <section
          className="section"
          id="announcements"
          style={{ paddingTop: 0 }}
        >
          <div className="section-title">
            <div>
              <div className="eyebrow">Community board</div>
              <h2>{t("Pengumuman gang", "Gang announcements")}</h2>
            </div>
          </div>
          {announcements.length ? (
            <div className="grid2">
              {announcements.map((a) => (
                <AnnouncementCard key={a.id} announcement={a} locale={locale} />
              ))}
            </div>
          ) : (
            <div className="empty">
              <strong>
                {t(
                  "Update seterusnya akan tiba.",
                  "The next update is on its way.",
                )}
              </strong>
              {t(
                "Pengumuman rasmi dan maklumat kejohanan akan dipaparkan di sini selepas disahkan.",
                "Official announcements and tournament information will appear here once confirmed.",
              )}
            </div>
          )}
        </section>
      </FadeContent>
    </div>
  );
}
