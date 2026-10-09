"use client";

import { useId, useState } from "react";
import { useLocale } from "./locale-context";
import { TournamentPlayerName } from "./tournament-player-results";

export type FixtureRound = {
  number: number;
  name: string;
  matches: {
    id: string;
    a: string;
    b: string;
    bestOf: number;
    status: string;
    scheduledAt: Date | null;
    result: {
      outcome: string;
      games: { number: number; scoreA: number; scoreB: number }[];
    } | null;
  }[];
};

export function FixtureBrowser({
  rounds,
  title,
  draft = false,
}: {
  rounds: FixtureRound[];
  title: string;
  draft?: boolean;
}) {
  const locale = useLocale();
  const t = (ms: string, en: string) => (locale === "en" ? en : ms);
  const id = useId();
  const [selected, setSelected] = useState(rounds[0]?.number);
  const round = rounds.find((r) => r.number === selected) ?? rounds[0];
  if (!round)
    return (
      <div className="empty">
        {t(
          "Jadual menunggu pengesahan peserta dan peraturan.",
          "Fixtures await confirmed entrants and rules.",
        )}
      </div>
    );
  const entrants = Array.from(
    new Set(
      round.matches
        .flatMap((m) => [m.a, m.b])
        .filter(
          (name) =>
            !["BYE", "Menunggu peserta", "Awaiting entrant"].includes(name),
        ),
    ),
  );
  const statuses: Record<string, string> = {
    SCHEDULED: t("Dijadualkan", "Scheduled"),
    IN_PROGRESS: t("Sedang berlangsung", "In progress"),
    FINALIZED: t("Muktamad", "Finalized"),
    DISPUTED: t("Dalam pertikaian", "Disputed"),
    VOID: t("Dibatalkan", "Void"),
    BYE: "BYE",
  };
  const outcomes: Record<string, string> = {
    A_WIN: t("Pihak A menang", "Side A wins"),
    B_WIN: t("Pihak B menang", "Side B wins"),
    DRAW: t("Seri", "Draw"),
    A_FORFEIT: t("Pihak A forfeit", "Side A forfeits"),
    B_FORFEIT: t("Pihak B forfeit", "Side B forfeits"),
  };
  const roundLabel = (n: number) => t(`Pusingan ${n}`, `Round ${n}`);
  const entrantName = (name: string) =>
    name === "Menunggu peserta" || name === "Awaiting entrant"
      ? t("Menunggu peserta", "Awaiting entrant")
      : name;
  return (
    <div className="fixture-browser tournament-presentation">
      <div className="fixture-browser-title">
        <h3>{title}</h3>
        <span className={`badge ${draft ? "warning" : "neutral"}`}>
          {draft
            ? t("Pratonton staff", "Staff preview")
            : t("Jadual diterbitkan", "Published schedule")}
        </span>
      </div>
      <div
        className="round-switch"
        role="group"
        aria-label={t("Pusingan perlawanan", "Match rounds")}
      >
        {rounds.map((r) => (
          <button
            type="button"
            key={r.number}
            className={r.number === round.number ? "active" : ""}
            aria-pressed={r.number === round.number}
            aria-controls={`${id}-round`}
            onClick={() => setSelected(r.number)}
          >
            {roundLabel(r.number)}
          </button>
        ))}
      </div>
      <div id={`${id}-round`} className="fixture-browser-grid">
        <article className="fixture-roster">
          <div className="fixture-card-heading">
            <h3>
              {t("Peserta", "Entrants")} · {roundLabel(round.number)}
            </h3>
            <small>
              {entrants.length} {t("peserta", "entrants")}
            </small>
          </div>
          <ol tabIndex={0} aria-label={t("Senarai peserta", "Entrant list")}>
            {entrants.map((name, i) => (
              <li key={name}>
                <span>#{i + 1}</span>
                <TournamentPlayerName value={name} />
              </li>
            ))}
          </ol>
          {!entrants.length && (
            <p className="muted">
              {t(
                "Peserta belum ditentukan.",
                "Entrants are awaiting confirmation.",
              )}
            </p>
          )}
          <p className="presentation-note">
            {t(
              "Nombor menunjukkan urutan paparan, bukan kedudukan liga.",
              "Numbers indicate display order, not league rankings.",
            )}
          </p>
        </article>
        <article className="fixture-pairings">
          <div className="fixture-card-heading">
            <h3>
              {t("Perlawanan", "Matches")} · {roundLabel(round.number)}
            </h3>
            <small>
              {round.matches.length} {t("series", "series")}
            </small>
          </div>
          <div
            className="pairing-list"
            tabIndex={0}
            aria-label={t("Senarai perlawanan", "Match list")}
          >
            {round.matches.map((m) => (
              <details key={m.id} className="pairing">
                <summary>
                  <span className="pairing-sides">
                    <span>
                      <TournamentPlayerName value={entrantName(m.a)} />
                    </span>
                    <b>{m.status === "BYE" ? "BYE" : "VS"}</b>
                    <span>
                      <TournamentPlayerName value={entrantName(m.b)} />
                    </span>
                  </span>
                  <span className="pairing-meta">
                    BO{m.bestOf} · {statuses[m.status] ?? m.status}
                  </span>
                </summary>
                <div className="pairing-details">
                  <p>
                    {m.scheduledAt
                      ? new Intl.DateTimeFormat(
                          locale === "en" ? "en-MY" : "ms-MY",
                          {
                            timeZone: "Asia/Kuala_Lumpur",
                            dateStyle: "medium",
                            timeStyle: "short",
                          },
                        ).format(new Date(m.scheduledAt))
                      : t("Tarikh akan diumumkan.", "Dates to be announced.")}
                  </p>
                  {m.result ? (
                    <>
                      <strong>
                        {outcomes[m.result.outcome] ?? m.result.outcome}
                      </strong>
                      <div className="pairing-scores">
                        {m.result.games.map((g) => (
                          <span key={g.number}>
                            Game {g.number}:{" "}
                            <TournamentPlayerName
                              value={entrantName(
                                g.scoreA > g.scoreB ? m.a : m.b,
                              )}
                            />{" "}
                            {t("menang", "wins")}
                          </span>
                        ))}
                      </div>
                    </>
                  ) : (
                    <p>
                      {m.status === "BYE"
                        ? t(
                            "Bye mengikut polisi seeding yang disahkan; tiada keputusan perlawanan.",
                            "Bye under the approved seeding policy; no played result.",
                          )
                        : t(
                            "Keputusan rasmi belum diterima.",
                            "No official result has been accepted yet.",
                          )}
                    </p>
                  )}
                </div>
              </details>
            ))}
          </div>
        </article>
      </div>
    </div>
  );
}
