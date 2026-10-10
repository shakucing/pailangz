"use client";

import { useLocale } from "./locale-context";
import { WorkspaceDialog } from "./workspace-dialog";
import { playerMatchResultSections } from "@/lib/player-match-results";
import type { EventStage } from "@/lib/event-presentation-data";
import styles from "./player-results-dialog.module.css";

export function PlayerResultsDialog({
  player,
  stages,
  testResults,
  onClose,
}: {
  player: { code: string; ign?: string };
  stages: EventStage[];
  testResults?: boolean;
  onClose: () => void;
}) {
  const locale = useLocale();
  const t = (ms: string, en: string) => (locale === "en" ? en : ms);
  const sections = playerMatchResultSections(stages, player.code);
  const carry = stages.find(
    (s) => s.key === "qualification",
  )?.qualificationCarry;
  const label = player.ign ? `${player.code} · ${player.ign}` : player.code;
  const stageName = (key: string) =>
    key === "league"
      ? t("Liga", "League")
      : key === "qualification"
        ? t("Kelayakan", "Qualification")
        : key === "league-qualification"
          ? t("Liga & Kelayakan", "League & Qualification")
          : "Knockout";
  const resultName = (match: (typeof sections)[number]["matches"][number]) =>
    match.outcome === "win"
      ? t("Menang", "Win")
      : match.outcome === "draw"
        ? t("Seri", "Draw")
        : match.outcome === "loss"
          ? t("Kalah", "Loss")
          : match.status === "BYE"
            ? "BYE"
            : match.status === "VOIDED"
              ? t("Dibatalkan", "Voided")
              : match.status === "DISPUTED"
                ? t("Dipertikaikan", "Disputed")
                : match.status === "RESULT_SUBMITTED"
                  ? t("Menunggu semakan", "Under review")
                  : t("Menunggu keputusan", "Awaiting result");
  return (
    <WorkspaceDialog
      title={label}
      description={
        testResults
          ? t("Keputusan ujian setempat pemain", "Player's local test results")
          : t("Keputusan perlawanan pemain", "Player's match results")
      }
      onClose={onClose}
      closeLabel={t("Tutup", "Close")}
    >
      <p className={styles.note}>
        {t(
          "Jumlah game menang pemain ini dipaparkan dahulu.",
          "This player's game wins are shown first.",
        )}
      </p>
      {sections.length ? (
        <div className={styles.sections}>
          {sections.map((section) => (
            <section
              key={section.key}
              aria-label={stageName(section.key)}
              className={styles.section}
            >
              <h3 className={styles.sectionTitle}>{stageName(section.key)}</h3>
              {section.key === "league-qualification" ? (
                <p className={styles.sectionNote}>
                  {t(
                    "Mata liga dibawa ke kelayakan. Jumlah di bawah merangkumi kedua-dua peringkat.",
                    "League points carry forward into qualification. Totals below include both stages.",
                  )}
                </p>
              ) : section.key === "qualification" ? (
                <p className={styles.sectionNote}>
                  {carry === false
                    ? t(
                        "Kelayakan bermula dari sifar. Mata liga tidak dibawa ke hadapan.",
                        "Qualification starts from zero. League points are not carried forward.",
                      )
                    : t(
                        "Peraturan bawa mata liga belum disahkan. Keputusan dipaparkan secara berasingan.",
                        "The league points carry-forward rule is awaiting confirmation. Results are shown separately.",
                      )}
                </p>
              ) : null}
              <dl className={styles.summary}>
                {[
                  [t("Dimainkan", "Played"), section.summary.played],
                  [t("Menang", "Wins"), section.summary.wins],
                  [t("Seri", "Draws"), section.summary.draws],
                  [t("Kalah", "Losses"), section.summary.losses],
                  ...(section.summary.points !== null
                    ? [
                        [
                          section.key === "league"
                            ? t("Jumlah mata liga", "Total league points")
                            : section.key === "qualification"
                              ? t(
                                  "Jumlah mata kelayakan",
                                  "Total qualification points",
                                )
                              : t("Jumlah mata", "Total points"),
                          section.summary.points,
                        ],
                      ]
                    : []),
                ].map(([name, value]) => (
                  <div key={name}>
                    <dt>{name}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
              {section.summary.points !== null && (
                <p className={styles.note}>
                  {t(
                    "Menang 3 mata · Seri 1 · Kalah 0.",
                    "Win 3 points · Draw 1 · Loss 0.",
                  )}
                </p>
              )}
              <ol className={styles.matches}>
                {section.matches.map((match) => (
                  <li key={match.id}>
                    <div className={styles.heading}>
                      <div>
                        <p>
                          {stageName(match.stageKey)} ·{" "}
                          {t(`Pusingan ${match.round}`, `Round ${match.round}`)}
                        </p>
                        <h4>
                          {t("Lawan", "vs")}{" "}
                          {match.opponent ??
                            t("Menunggu peserta", "Awaiting entrant")}
                        </h4>
                      </div>
                      <span
                        className={styles.outcome}
                        data-outcome={match.outcome ?? "pending"}
                      >
                        {resultName(match)}
                        {match.forfeit && ` · ${t("Forfeit", "Forfeit")}`}
                      </span>
                    </div>
                    {match.outcome && (
                      <div className={styles.result}>
                        {match.games.length > 0 && (
                          <strong>
                            {match.wins}–{match.losses}
                          </strong>
                        )}
                        {match.points !== null && (
                          <span>
                            +{match.points}{" "}
                            {match.stageKey === "league"
                              ? t("mata liga", "league points")
                              : t("mata kelayakan", "qualification points")}
                          </span>
                        )}
                      </div>
                    )}
                    {match.games.length > 0 && (
                      <div className={styles.games}>
                        {match.games.map((game) => (
                          <span key={game.number}>
                            Game {game.number}:{" "}
                            <b>
                              {game.scoreFor > game.scoreAgainst
                                ? t("Menang", "Win")
                                : t("Kalah", "Loss")}
                            </b>
                          </span>
                        ))}
                      </div>
                    )}
                  </li>
                ))}
              </ol>
            </section>
          ))}
        </div>
      ) : (
        <p className={styles.note}>
          {t(
            "Perlawanan pemain ini belum disediakan.",
            "No matches have been prepared for this player yet.",
          )}
        </p>
      )}
    </WorkspaceDialog>
  );
}
