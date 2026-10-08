import { NavigationLink as Link } from "@/components/navigation-link";
import { ArrowUpRight, Swords, Users, Trophy } from "lucide-react";
import { FadeContent } from "@/components/react-bits/fade-content";
import { SpotlightCard } from "@/components/react-bits/spotlight-card";
import { Wordmark } from "@/components/wordmark";
import { HeroOrbit } from "@/components/hero-orbit";
import { EventPresentation } from "@/components/event-presentation";
import { eventPresentationData } from "@/lib/event-presentation-data";
import { originalConfiguration } from "@/lib/tournament-config";
import {
  publicTeams,
  publicTeamEvent,
  teamRegistrationOpen,
} from "@/lib/team-portal";
import {
  participationStatus,
  registrationEvent,
} from "@/lib/participation-status";
import { TeamDirectory } from "@/components/team-directory";
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
  const featured = tournaments[0];
  const event = await eventPresentationData(featured?.slug);
  const teamSlug = event?.slug ?? featured?.slug ?? "pailangz-solo-team";
  const [teams, registration, entryStatus, teamEvent] = await Promise.all([
    publicTeams(teamSlug),
    registrationEvent(teamSlug),
    participationStatus(teamSlug),
    publicTeamEvent(teamSlug),
  ]);
  const teamEntryOpen = teamEvent && teamRegistrationOpen(teamEvent);
  const arena = registration ?? featured;
  const config =
    event?.configuration ?? featured?.configuration ?? originalConfiguration;
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
            <a className="button secondary" href="#tournament-format">
              {t("Lihat format", "Explore the format")}
            </a>
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
          <strong>{config.soloCapacity}</strong>
          <span>{t("Slot SOLO dirancang", "Planned SOLO slots")}</span>
        </div>
        <div className="stat">
          <strong>{config.teamCapacity}</strong>
          <span>{t("Slot TEAM dirancang", "Planned TEAM slots")}</span>
        </div>
        <div className="stat">
          <strong>{String(config.leagueRounds).padStart(2, "0")}</strong>
          <span>{t("Pusingan liga SOLO", "SOLO league rounds")}</span>
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
                  <span className="muted">Solo & Team Tournament</span>
                )}
              </h2>
              <p className="muted">
                {(registration
                  ? locale === "en" && registration.overviewEn
                    ? registration.overviewEn
                    : registration.overview
                  : featured?.overview) ??
                  t(
                    "Dari duel 1v1 ke kerjasama empat pemain. Kenali pemain solo dan pasukan terkuat dalam gang.",
                    "From 1v1 duels to four-player teamwork. Find the strongest solo players and teams in the gang.",
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
                          `Semua ${registration.capacity} slot pemain telah diisi. Pemain yang diluluskan masih boleh membentuk pasukan semasa pendaftaran pasukan dibuka.`,
                          `All ${registration.capacity} player places are filled. Approved players can still form teams while team registration is open.`,
                        )
                      : t(
                          "Satu pendaftaran pemain untuk SOLO & TEAM. Selepas diluluskan, sertai pasukan atau daftar pasukan anda sebagai kapten.",
                          "One player registration for SOLO & TEAM. Once approved, join a team or register your own as captain.",
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
                            "Daftar pemain · SOLO & TEAM",
                            "Register as a player · SOLO & TEAM",
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
                        href={`/tournaments/${registration.slug}/teams${teamEntryOpen ? "/new" : ""}`}
                      >
                        {teamEntryOpen
                          ? t("Daftar pasukan", "Register a team")
                          : t("Lihat pasukan", "View teams")}
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
              <div className="category-block">
                <Swords className="mx-auto mb-4 text-lime" size={32} />
                <strong>SOLO</strong>
                <span>1V1 · BO3 / BO5</span>
              </div>
              <div className="category-block">
                <Users className="mx-auto mb-4 text-sky-300" size={32} />
                <strong>TEAM</strong>
                <span>4 PLAYERS · 1 TEAM</span>
              </div>
            </div>
          </div>
        </section>
      </FadeContent>
      <section
        className="section"
        style={{ paddingTop: 0 }}
        id="tournament-format"
      >
        <EventPresentation
          data={event}
          configuration={config}
          teams={teams.map(({ code, name, avatarImage }) => ({
            code,
            name,
            avatarImage,
          }))}
        />
      </section>
      <TeamDirectory teams={teams} slug={teamSlug} />
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
        <section className="section" style={{ paddingTop: 0 }}>
          <div className="section-title">
            <div>
              <div className="eyebrow">Community board</div>
              <h2>{t("Pengumuman gang", "Gang announcements")}</h2>
            </div>
          </div>
          {announcements.length ? (
            <div className="grid2">
              {announcements.map((a) => (
                <article className="panel" key={a.id}>
                  <h3>{a.title}</h3>
                  <p className="muted whitespace-pre-wrap mb-0">{a.body}</p>
                </article>
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
