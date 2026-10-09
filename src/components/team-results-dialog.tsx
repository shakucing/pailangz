"use client";

import { useLocale } from "./locale-context";
import { WorkspaceDialog } from "./workspace-dialog";
import { playerMatchResults } from "@/lib/player-match-results";
import type {
  EventPresentationData,
  EventStage,
} from "@/lib/event-presentation-data";
import styles from "./player-results-dialog.module.css";
import teamStyles from "./team-results-dialog.module.css";

export function TeamResultsDialog({
  team,
  stages,
  onClose,
}: {
  team: EventPresentationData["categories"][number]["teams"][number];
  stages: EventStage[];
  onClose: () => void;
}) {
  const locale = useLocale();
  const t = (ms: string, en: string) => (locale === "en" ? en : ms);
  const matches = playerMatchResults(stages, team.code);
  const completed = matches.filter((match) => match.outcome);
  const resultName = (match: (typeof matches)[number]) =>
    match.outcome === "win"
      ? t("Menang", "Win")
      : match.outcome === "loss"
        ? t("Kalah", "Loss")
        : match.outcome === "draw"
          ? t("Seri", "Draw")
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
      title={`${team.code} · ${team.name}`}
      description={t("Ahli & keputusan pasukan", "Team members & results")}
      onClose={onClose}
      closeLabel={t("Tutup", "Close")}
    >
      <h3 className={teamStyles.sectionTitle}>
        {t("Ahli pasukan", "Team members")} · {team.playerCount}/4
      </h3>
      {team.roster?.length ? (
        <ul className={teamStyles.roster}>
          {team.roster.map((member) => (
            <li key={member.ign}>
              <strong>{member.ign}</strong>
              {member.owner && (
                <span className="badge">{t("Pemilik", "Owner")}</span>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.note}>
          {t(
            "Ahli pasukan belum tersedia untuk paparan umum.",
            "Team members are not publicly available yet.",
          )}
        </p>
      )}
      <h3 className={teamStyles.sectionTitle}>
        {t("Keputusan pasukan", "Team results")}
      </h3>
      <dl className={styles.summary}>
        {[
          [t("Dimainkan", "Played"), completed.length],
          [
            t("Menang", "Wins"),
            completed.filter((m) => m.outcome === "win").length,
          ],
          [
            t("Kalah", "Losses"),
            completed.filter((m) => m.outcome === "loss").length,
          ],
        ].map(([name, value]) => (
          <div key={name}>
            <dt>{name}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <p className={styles.note}>
        {t(
          "Skor direkodkan untuk seluruh pasukan. Skor pasukan ini dipaparkan dahulu.",
          "Scores are recorded for the whole team. This team's score is shown first.",
        )}
      </p>
      {matches.length ? (
        <ol className={styles.matches}>
          {matches.map((match) => (
            <li key={match.id}>
              <div className={styles.heading}>
                <div>
                  <p>{match.roundName}</p>
                  <h3>
                    {t("Lawan", "vs")}{" "}
                    {match.opponent ?? t("Menunggu pasukan", "Awaiting team")}
                  </h3>
                </div>
                <span
                  className={styles.outcome}
                  data-outcome={match.outcome ?? "pending"}
                >
                  {resultName(match)}
                  {match.forfeit && " · Forfeit"}
                </span>
              </div>
              {match.games.length > 0 && (
                <>
                  <div className={styles.result}>
                    <strong>
                      {match.wins}–{match.losses}
                    </strong>
                  </div>
                  <div className={styles.games}>
                    {match.games.map((game) => (
                      <span key={game.number}>
                        Game {game.number}:{" "}
                        <b>
                          {game.scoreFor}–{game.scoreAgainst}
                        </b>
                      </span>
                    ))}
                  </div>
                </>
              )}
            </li>
          ))}
        </ol>
      ) : (
        <p className={styles.note}>
          {t(
            "Perlawanan pasukan ini belum disediakan.",
            "No matches have been prepared for this team yet.",
          )}
        </p>
      )}
    </WorkspaceDialog>
  );
}
