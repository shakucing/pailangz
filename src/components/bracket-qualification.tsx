"use client";

import { ArrowDown, ArrowRight, Trophy } from "lucide-react";
import { useLocale } from "./locale-context";
import { TournamentPlayerName } from "./tournament-player-results";
import { bracketQualification } from "@/lib/bracket-qualification";
import type { EventStage } from "@/lib/event-presentation-data";
import type { TournamentConfiguration } from "@/lib/tournament-config";
import styles from "./bracket-qualification.module.css";

export function BracketQualification({
  configuration: config,
  stages,
  participants = [],
}: {
  configuration: TournamentConfiguration;
  stages?: EventStage[];
  participants?: { code: string; ign?: string }[];
}) {
  const locale = useLocale();
  const t = (ms: string, en: string) => (locale === "en" ? en : ms);
  const path = bracketQualification(config, stages);
  const names = new Map(participants.map((p) => [p.code, p.ign]));
  const label = (code: string) =>
    names.get(code) ? `${code} · ${names.get(code)}` : code;
  const status = (stage: EventStage | undefined, final: boolean) =>
    stage?.rankingsStale
      ? t("Kedudukan sedang disemak", "Rankings under review")
      : final
        ? t("Kedudukan dimuktamadkan", "Rankings finalized")
        : t("Menunggu kedudukan akhir", "Awaiting final rankings");
  const slots = (
    count: number,
    rows: typeof path.direct,
    source: "league" | "qualification",
  ) => (
    <ul className={styles.slots}>
      {Array.from({ length: count }, (_, i) => {
        const row = rows[i];
        return (
          <li key={i}>
            <span>
              {source === "league"
                ? t("Liga", "League")
                : t("Kelayakan", "Qualification")}{" "}
              #{i + 1}
            </span>
            <strong>
              {row ? (
                <TournamentPlayerName value={label(row.code)} />
              ) : (
                t("Menunggu peserta", "Awaiting entrant")
              )}
            </strong>
          </li>
        );
      })}
    </ul>
  );
  const standings = (stage: EventStage | undefined) =>
    stage?.standings.length ? (
      <details className={styles.standings} open={stage.key === "league"}>
        <summary>
          {t("Lihat kedudukan", "View standings")} ({stage.standings.length})
        </summary>
        <div
          className={styles.tableScroll}
          tabIndex={0}
          role="region"
          aria-label={`${stage.name} ${t("kedudukan", "standings")}`}
        >
          <table>
            <caption className="sr-only">
              {stage.name} ·{" "}
              {status(
                stage,
                stage.key === "league"
                  ? path.leagueFinal
                  : path.qualificationFinal,
              )}
            </caption>
            <thead>
              <tr>
                <th>{t("Rank", "Rank")}</th>
                <th>{t("Pemain", "Player")}</th>
                <th>{t("Main", "Played")}</th>
                <th>{t("Mata", "Points")}</th>
              </tr>
            </thead>
            <tbody>
              {stage.standings.map((row) => (
                <tr key={row.code}>
                  <td>{row.rank ?? "—"}</td>
                  <td>
                    <TournamentPlayerName value={label(row.code)} />
                  </td>
                  <td>{row.played}</td>
                  <td>{row.points}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    ) : (
      <p className={styles.note}>
        {t("Kedudukan belum tersedia.", "Standings are not available yet.")}
      </p>
    );

  return (
    <div className={styles.path}>
      <div className={styles.title}>
        {t("Laluan ke juara", "Road to champion")}
      </div>
      <div className={styles.flow}>
        <article className={styles.card}>
          <span className={styles.step}>
            01 · {t("Peringkat liga", "League stage")}
          </span>
          <h5>{t("Kedudukan liga", "League standings")}</h5>
          <p>
            {config.soloCapacity} {t("pemain", "players")} ·{" "}
            {config.leagueRounds} {t("pusingan", "rounds")}
          </p>
          <span className={styles.status}>
            {status(path.league, path.leagueFinal)}
          </span>
          {standings(path.league)}
          <p className={styles.note}>
            {t(
              "Kedudukan akhir menentukan peserta yang mara ke knockout.",
              "Final rankings determine who advances toward knockout.",
            )}
          </p>
        </article>
        <ArrowRight className={styles.arrow} size={22} aria-hidden="true" />
        <div className={styles.routes}>
          {config.directSlots > 0 && (
            <article className={styles.card}>
              <span className={styles.step}>
                {t("Laluan terus", "Direct route")}
              </span>
              <h5>
                {config.directSlots} {t("slot terus", "direct places")}
              </h5>
              <p>
                {t("Liga", "League")} #1–{config.directSlots} →{" "}
                {t("Knockout", "Knockout")}
              </p>
              {slots(config.directSlots, path.direct, "league")}
            </article>
          )}
          {config.playoffSlots > 0 && (
            <article className={styles.card}>
              <span className={styles.step}>
                02 · {t("Laluan playoff", "Playoff route")}
              </span>
              <h5>
                {t("Kelayakan", "Qualification")} · {config.playoffSlots}{" "}
                {t("slot", "places")}
              </h5>
              <p>
                {t("Liga", "League")} #{config.directSlots + 1}–
                {config.directSlots + config.playoffEntrants} ·{" "}
                {config.playoffEntrants} {t("pemain", "players")}
              </p>
              <p>
                {config.qualificationMatchesPerPlayer}{" "}
                {t("series setiap pemain", "series per player")} ·{" "}
                {path.qualification?.qualificationBestOf
                  ? `BO${path.qualification.qualificationBestOf}`
                  : t("Format belum disahkan", "Format pending confirmation")}
              </p>
              <span className={styles.status}>
                {status(path.qualification, path.qualificationFinal)}
              </span>
              {path.pool.some(Boolean) && (
                <details className={styles.standings}>
                  <summary>{t("Peserta playoff", "Playoff entrants")}</summary>
                  <ul className={styles.slots}>
                    {path.pool.map((row, i) => (
                      <li key={i}>
                        <span>
                          {t("Liga", "League")} #{config.directSlots + i + 1}
                        </span>
                        <strong>
                          {row ? (
                            <TournamentPlayerName value={label(row.code)} />
                          ) : (
                            t("Menunggu peserta", "Awaiting entrant")
                          )}
                        </strong>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              {slots(config.playoffSlots, path.playoff, "qualification")}
              {standings(path.qualification)}
            </article>
          )}
        </div>
        <ArrowRight className={styles.arrow} size={22} aria-hidden="true" />
        <article className={`${styles.card} ${styles.destination}`}>
          <Trophy size={24} aria-hidden="true" />
          <span className={styles.step}>
            {config.playoffSlots ? "03" : "02"} · Knockout
          </span>
          <h5>
            {config.directSlots + config.playoffSlots}{" "}
            {t("slot knockout", "knockout places")}
          </h5>
          <p>
            {config.directSlots} {t("terus", "direct")} + {config.playoffSlots}{" "}
            {t("daripada kelayakan", "from qualification")}
          </p>
          <p>
            {t("Penyingkiran tunggal", "Single elimination")} · BO
            {config.soloKnockoutBestOf} · {t("Final", "Final")} BO
            {config.soloFinalBestOf}
          </p>
          <strong>
            {t("Bracket → Final → Juara", "Bracket → Final → Champion")}
          </strong>
        </article>
      </div>
      <div className={styles.intoBracket}>
        <ArrowDown size={20} aria-hidden="true" />
        {t(
          "Laluan bersambung ke bracket knockout di bawah",
          "Routes feed into the knockout bracket below",
        )}
      </div>
    </div>
  );
}
