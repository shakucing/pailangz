import { NavigationLink as Link } from "@/components/navigation-link";
import { notFound } from "next/navigation";
import { getLocale, translate } from "@/lib/i18n";
import { publicTournament, dateText } from "@/lib/public-data";
import { TournamentProgression } from "@/components/tournament-progression";
import { FixtureBrowser } from "@/components/fixture-browser";
import { InteractiveBracket } from "@/components/interactive-bracket";
export const dynamic = "force-dynamic";
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string; view?: string[] }>;
}) {
  const { view } = await params;
  const locale = await getLocale();
  const titles: Record<string, [string, string]> = {
    overview: ["Ringkasan kejohanan", "Tournament overview"],
    standings: ["Kedudukan kejohanan", "Tournament standings"],
    fixtures: ["Perlawanan kejohanan", "Tournament fixtures"],
    brackets: ["Bracket kejohanan", "Tournament brackets"],
  };
  const [ms, en] = titles[view?.[0] ?? "overview"] ?? titles.overview;
  return { title: translate(locale, ms, en) };
}
export default async function Tournament({
  params,
}: {
  params: Promise<{ slug: string; view?: string[] }>;
}) {
  const { slug, view } = await params;
  const locale = await getLocale();
  const copy = (ms: string, en: string) => translate(locale, ms, en);
  const section = view?.[0] ?? "overview";
  if (
    (view && view.length > 1) ||
    !["overview", "standings", "fixtures", "brackets"].includes(section)
  )
    notFound();
  const t = await publicTournament(slug);
  if (!t) notFound();
  const stages = t.categories.flatMap((c) => c.stages);
  return (
    <div className="wrap">
      <div className="page-heading">
        <Link href="/tournaments" className="text-link">
          {copy("← Semua kejohanan", "← All tournaments")}
        </Link>
        <h1>{t.name}</h1>
        <div className="row">
          <span className="badge">{t.status.replaceAll("_", " ")}</span>
          <span className="muted text-sm">{dateText(t.startsAt, locale)}</span>
        </div>
      </div>
      <nav className="tabs" aria-label={copy("Kejohanan", "Tournaments")}>
        {[
          ["overview", copy("Ringkasan", "Overview")],
          ["standings", copy("Kedudukan", "Standings")],
          ["fixtures", copy("Perlawanan", "Fixtures")],
          ["brackets", copy("Bracket", "Brackets")],
          ["teams", copy("Pasukan", "Teams")],
        ].map(([key, label]) => (
          <Link
            key={key}
            className={section === key ? "active" : ""}
            aria-current={section === key ? "page" : undefined}
            href={`/tournaments/${slug}${key === "overview" ? "" : `/${key}`}`}
          >
            {label}
          </Link>
        ))}
      </nav>
      <section className="section" style={{ paddingTop: 0 }}>
        {section === "overview" ? (
          <div className="stack">
            <TournamentProgression
              configuration={t.configuration}
              qualificationBestOf={
                stages.find((s) => s.key === "qualification")
                  ?.qualificationBestOf
              }
            />
            <div className="grid2">
              <article className="panel prose">
                <h3>{copy("Tentang kejohanan", "About the tournament")}</h3>
                <p className="whitespace-pre-wrap">{t.overview}</p>
                <p>
                  {copy(
                    "Pemain bebas memilih weapons dan weapon modes.",
                    "Players are free to choose their weapons and weapon modes.",
                  )}
                </p>
                <p>
                  {copy(
                    `SOLO: liga ${t.configuration.leagueRounds} pusingan BO3 → qualification → knockout BO5. TEAM: empat pemain setiap pasukan; BO3 sehingga semifinal dan BO5 untuk final.`,
                    `SOLO: ${t.configuration.leagueRounds}-round BO3 league → qualification → BO5 knockout. TEAM: four players per team; BO3 through the semifinals and BO5 in the final.`,
                  )}
                </p>
                <p>
                  {copy(
                    `${t.configuration.directSlots} pemain terbaik liga layak terus; ${t.configuration.playoffEntrants} peserta bermain ${t.configuration.qualificationMatchesPerPlayer} perlawanan qualification untuk ${t.configuration.playoffSlots} slot seterusnya.`,
                    `The top ${t.configuration.directSlots} league players qualify directly; ${t.configuration.playoffEntrants} entrants play ${t.configuration.qualificationMatchesPerPlayer} qualification matches for ${t.configuration.playoffSlots} further slots.`,
                  )}
                </p>
              </article>
              <article className="panel">
                <h3>{copy("Peserta diluluskan", "Approved participants")}</h3>
                <div className="grid2">
                  {t.participants.map((p) => (
                    <div key={p.code} className="text-sm">
                      {p.code}
                    </div>
                  ))}
                </div>
                <p className="muted text-sm mt-4 mb-0">
                  {copy(
                    "Halaman kejohanan ini menggunakan kod peserta untuk mengenal pasti pemain.",
                    "This tournament page identifies players by their participant codes.",
                  )}
                </p>
                {!t.participants.length && (
                  <p className="muted">
                    {copy(
                      "Roster belum diterbitkan.",
                      "The roster has not been published yet.",
                    )}
                  </p>
                )}
              </article>
            </div>
            <div className="grid2">
              {t.categories
                .flatMap((c) => c.teams)
                .map((team) => (
                  <article className="panel" key={team.code}>
                    <h3>{team.name}</h3>
                    <span className="badge neutral">{team.code}</span>
                    <p className="muted">
                      {copy(
                        `${team.playerCount} pemain`,
                        `${team.playerCount} players`,
                      )}
                    </p>
                  </article>
                ))}
            </div>
          </div>
        ) : section === "standings" ? (
          <div className="stack">
            {stages
              .filter((s) => s.format === "LEAGUE")
              .map((s) => (
                <div key={s.key}>
                  <h3>{s.name}</h3>
                  <p className="muted text-sm">
                    {copy(
                      "W = 3 mata · D = 1 mata · L = 0 mata. Mata dikira pada peringkat series. “Seri” menandakan kedudukan belum diputuskan.",
                      "W = 3 points · D = 1 point · L = 0 points. Points apply to the series outcome. “Tied” indicates an unresolved ranking.",
                    )}
                  </p>
                  {s.rankingsStale && (
                    <div className="notice">
                      {copy(
                        "Kedudukan sementara: keputusan berubah dan memerlukan semakan moderator.",
                        "Provisional rankings: corrected results require moderator review.",
                      )}
                    </div>
                  )}
                  {s.standings.length === 0 && (
                    <div className="empty">
                      {copy(
                        "Peserta peringkat ini belum disahkan.",
                        "Participants for this stage are awaiting confirmation.",
                      )}
                    </div>
                  )}
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          {[
                            "Rank",
                            copy("Pemain", "Player"),
                            "P",
                            "W",
                            "D",
                            "L",
                            "Pts",
                            "GW",
                            "GL",
                            "GD",
                          ].map((x) => (
                            <th key={x}>{x}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {s.standings.map((r) => (
                          <tr key={r.code}>
                            <td>
                              {r.rank ?? (
                                <span className="badge warning">
                                  {copy("Seri", "Tied")}
                                </span>
                              )}
                            </td>
                            <td>{r.code}</td>
                            {[
                              r.played,
                              r.wins,
                              r.draws,
                              r.losses,
                              r.points,
                              r.gameWins,
                              r.gameLosses,
                              r.differential,
                            ].map((n, i) => (
                              <td key={i}>{n}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
          </div>
        ) : section === "fixtures" ? (
          <div className="stack">
            {stages
              .filter((s) => s.format === "LEAGUE")
              .map((s) => (
                <FixtureBrowser key={s.key} title={s.name} rounds={s.rounds} />
              ))}
            {stages.flatMap((s) =>
              s.format === "LEAGUE"
                ? []
                : s.rounds.map((r) => (
                    <div key={`${s.key}-${r.number}`}>
                      <h3>
                        {s.name} · {r.name}
                      </h3>
                      {r.matches.map((m) => (
                        <details key={m.id} className="fixture">
                          <summary>
                            <strong>
                              {copy(
                                m.a,
                                m.a === "Menunggu peserta"
                                  ? "Awaiting participant"
                                  : m.a,
                              )}
                              <span className="vs">VS</span>
                              {copy(
                                m.b,
                                m.b === "Menunggu peserta"
                                  ? "Awaiting participant"
                                  : m.b,
                              )}
                            </strong>
                            <small>
                              BO{m.bestOf} · {m.status.replaceAll("_", " ")} ·{" "}
                              {dateText(m.scheduledAt, locale)}
                            </small>
                          </summary>
                          {m.result ? (
                            <div className="mt-4 text-sm">
                              {m.result.outcome}{" "}
                              {m.result.games.map((g) => (
                                <span
                                  key={g.number}
                                  className="badge neutral ml-2"
                                >
                                  Game {g.number}: {g.scoreA}–{g.scoreB}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <p className="muted text-sm mt-4 mb-0">
                              {copy(
                                "Keputusan rasmi belum diterima.",
                                "No official result has been accepted yet.",
                              )}
                            </p>
                          )}
                        </details>
                      ))}
                    </div>
                  )),
            )}
          </div>
        ) : (
          <div className="stack">
            {t.categories.map((c) => (
              <div key={c.kind} className="panel">
                <InteractiveBracket
                  configuration={t.configuration}
                  category={c.kind === "TEAM" ? "TEAM" : "SOLO"}
                  storageScope={t.slug}
                  rounds={c.stages.find((s) => s.format === "KNOCKOUT")?.rounds}
                  stages={c.stages}
                  participants={t.participants}
                />
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
