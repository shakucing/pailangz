"use client";

import { useLocale } from "./locale-context";
import { WorkspaceDialog } from "./workspace-dialog";
import { playerMatchResults } from "@/lib/player-match-results";
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
  const matches = playerMatchResults(stages, player.code);
  const league = stages
    .find((s) => s.key === "league")
    ?.standings.find((r) => r.code === player.code);
  const label = player.ign ? `${player.code} · ${player.ign}` : player.code;
  const stageName = (key: string) =>
    key === "league"
      ? t("Liga", "League")
      : key === "qualification"
        ? t("Kelayakan", "Qualification")
        : "Knockout";
  const resultName = (match: (typeof matches)[number]) =>
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
      <dl className={styles.summary}>
        {[
          [t("Dimainkan", "Played"), league?.played ?? 0],
          [t("Menang", "Wins"), league?.wins ?? 0],
          [t("Seri", "Draws"), league?.draws ?? 0],
          [t("Kalah", "Losses"), league?.losses ?? 0],
          [t("Jumlah mata liga", "Total league points"), league?.points ?? 0],
        ].map(([name, value]) => (
          <div key={name}>
            <dt>{name}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <p className={styles.note}>
        {t(
          "Jumlah game menang pemain ini dipaparkan dahulu. Menang liga 3 mata · Seri 1 · Kalah 0.",
          "This player's game wins are shown first. League win 3 points · Draw 1 · Loss 0.",
        )}
      </p>
      {matches.length ? (
        <ol className={styles.matches}>
          {matches.map((match) => (
            <li key={match.id}>
              <div className={styles.heading}>
                <div>
                  <p>
                    {stageName(match.stageKey)} ·{" "}
                    {t(`Pusingan ${match.round}`, `Round ${match.round}`)}
                  </p>
                  <h3>
                    {t("Lawan", "vs")}{" "}
                    {match.opponent ??
                      t("Menunggu peserta", "Awaiting entrant")}
                  </h3>
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
                      +{match.points} {t("mata liga", "league points")}
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
