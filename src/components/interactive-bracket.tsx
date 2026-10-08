"use client";

import { useEffect, useId, useMemo, useState, type CSSProperties } from "react";
import { Check, GitBranch, Medal, RotateCcw, Trophy } from "lucide-react";
import { useLocale } from "./locale-context";
import { TeamAvatar } from "./team-avatar";
import { BracketQualification } from "./bracket-qualification";
import { bracketQualification } from "@/lib/bracket-qualification";
import type { EventMatch, EventStage } from "@/lib/event-presentation-data";
import type { TournamentConfiguration } from "@/lib/tournament-config";
import {
  bracketMatchLabel,
  bracketPlacings,
  officialBracket,
  previewBracket,
  resolveBracket,
  selectBracketWinner,
  type BracketEntrant,
  type BracketPicks,
} from "@/lib/interactive-bracket";
import styles from "./interactive-bracket.module.css";

type SourceRound = { number: number; matches: EventMatch[] };
const emptyRounds: SourceRound[] = [];
export type BracketTeam = {
  code: string;
  name: string;
  avatarImage: string | null;
};
const emptyTeams: BracketTeam[] = [];

export function InteractiveBracket({
  configuration,
  category,
  rounds = emptyRounds,
  storageScope = "planned-event",
  teams = emptyTeams,
  stages,
  participants,
}: {
  configuration: TournamentConfiguration;
  category: "SOLO" | "TEAM";
  rounds?: SourceRound[];
  storageScope?: string;
  teams?: BracketTeam[];
  stages?: EventStage[];
  participants?: { code: string; ign?: string }[];
}) {
  const locale = useLocale();
  const t = (ms: string, en: string) => (locale === "en" ? en : ms);
  const id = useId();
  const hasOfficial = rounds.some((round) => round.matches.length);
  const [mode, setMode] = useState<"official" | "picks">(
    hasOfficial ? "official" : "picks",
  );
  const [picks, setPicks] = useState<BracketPicks>({});
  const [announcement, setAnnouncement] = useState("");
  const source = useMemo(
    () =>
      hasOfficial
        ? officialBracket(rounds)
        : previewBracket(configuration, category),
    [hasOfficial, rounds, configuration, category],
  );
  const storageKey = `pailangz-bracket:${storageScope}:${category}:${JSON.stringify(source.map((round, index) => round.matches.map((match) => [match.id, index === 0 ? match.a?.id : null, index === 0 ? match.b?.id : null, match.status === "BYE"])))}`;
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  useEffect(() => {
    let saved: BracketPicks = {};
    try {
      const value: unknown = JSON.parse(
        sessionStorage.getItem(storageKey) ?? "{}",
      );
      if (value && typeof value === "object" && !Array.isArray(value)) {
        saved = Object.fromEntries(
          Object.entries(value).filter(
            ([key, pick]) =>
              source.some((round) =>
                round.matches.some((match) => match.id === key),
              ) && typeof pick === "string",
          ),
        );
      }
    } catch {
      // Picks still work in memory when browser storage is unavailable.
    }
    setPicks(saved);
    setLoadedKey(storageKey);
  }, [storageKey, source]);
  useEffect(() => {
    if (loadedKey !== storageKey) return;
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(picks));
    } catch {
      // Browser storage is optional for the interactive preview.
    }
  }, [picks, loadedKey, storageKey]);
  const activeMode = hasOfficial ? mode : "picks";
  const resolved = resolveBracket(source, picks, activeMode);
  const { champion, runnerUp } = bracketPlacings(resolved);
  const { origins } = bracketQualification(configuration, stages);
  const total = source.reduce(
    (count, round) =>
      count + round.matches.filter((match) => match.status !== "BYE").length,
    0,
  );
  const completed = resolved.reduce(
    (count, round) =>
      count +
      round.matches.filter((match) => match.winner && match.status !== "BYE")
        .length,
    0,
  );
  const display = (entrant: BracketEntrant) =>
    entrant.seed
      ? category === "TEAM"
        ? t(`Pasukan ${entrant.seed}`, `Team ${entrant.seed}`)
        : t(`Seed ${entrant.seed}`, `Seed ${entrant.seed}`)
      : entrant.label;
  const teamsByCode = useMemo(
    () => new Map(teams.map((team) => [team.code, team])),
    [teams],
  );
  const avatar = (entrant: BracketEntrant) => {
    const team = teamsByCode.get(entrant.label.split(" · ")[0]);
    return (
      <TeamAvatar
        image={team?.avatarImage ?? null}
        name={team?.name ?? display(entrant)}
        className={styles.avatar}
      />
    );
  };
  const roundName = (size: number) =>
    size === 2
      ? t("Grand Final", "Grand Final")
      : size === 4
        ? t("Separuh akhir", "Semifinals")
        : size === 8
          ? t("Suku akhir", "Quarterfinals")
          : t(`${size} terbaik`, `Round of ${size}`);
  const matchStatus = (status: string) =>
    ({
      SCHEDULED: t("Dijadualkan", "Scheduled"),
      IN_PROGRESS: t("Berlangsung", "In progress"),
      FINALIZED: t("Muktamad", "Finalized"),
      RESULT_SUBMITTED: t("Menunggu semakan", "Under review"),
      DISPUTED: t("Dipertikaikan", "Disputed"),
      VOIDED: t("Dibatalkan", "Voided"),
      BYE: "BYE",
    })[status] ?? status.replaceAll("_", " ");

  function choose(matchId: string, entrant: BracketEntrant, label: string) {
    const removing = picks[matchId] === entrant.id;
    setPicks((current) =>
      selectBracketWinner(source, current, matchId, entrant.id),
    );
    setAnnouncement(
      removing
        ? t(
            `Pilihan ${label} dibuang. Pilihan seterusnya pada laluan ini dikosongkan.`,
            `${label} pick removed. Later picks on this path cleared.`,
          )
        : t(
            `${display(entrant)} mara dari ${label}. Pilihan seterusnya pada laluan ini dikosongkan.`,
            `${display(entrant)} advances from ${label}. Later picks on this path cleared.`,
          ),
    );
  }

  return (
    <section className={styles.bracket} aria-labelledby={`${id}-title`}>
      <div className={styles.heading}>
        <div>
          <div className={styles.eyebrow}>
            <GitBranch size={14} aria-hidden="true" />
            {category} ·{" "}
            {category === "SOLO"
              ? t("Liga ke juara", "League to champion")
              : t("Penyingkiran tunggal", "Single elimination")}
          </div>
          <h4 id={`${id}-title`}>
            {t("Bracket kejohanan", "Tournament bracket")}
          </h4>
          <p>
            {source[0].size} {t("slot", "places")} · {resolved.length}{" "}
            {t("peringkat", "rounds")}
          </p>
        </div>
        {hasOfficial ? (
          <div
            className={styles.mode}
            role="group"
            aria-label={t("Paparan bracket", "Bracket view")}
          >
            <button
              type="button"
              aria-pressed={activeMode === "official"}
              onClick={() => setMode("official")}
            >
              {t("Rasmi", "Official")}
            </button>
            <button
              type="button"
              aria-pressed={activeMode === "picks"}
              onClick={() => setMode("picks")}
            >
              {t("Pilihan saya", "My picks")}
            </button>
          </div>
        ) : (
          <span className={styles.previewBadge}>
            {t("Bracket latihan", "Practice bracket")}
          </span>
        )}
      </div>

      <div className={styles.instructions}>
        <p>
          {activeMode === "official"
            ? t(
                "Keputusan yang disahkan oleh petugas kejohanan. Pilih “Pilihan saya” untuk mencuba laluan sendiri.",
                "Results confirmed by tournament staff. Switch to “My picks” to try your own path.",
              )
            : hasOfficial
              ? t(
                  "Pilih pemenang setiap perlawanan. Pilihan peribadi ini kekal dalam tab ini dan tidak mengubah keputusan rasmi.",
                  "Choose each match winner. Personal picks stay in this tab and do not change official results.",
                )
              : t(
                  `Cuba bracket yang dirancang dengan ${category === "TEAM" ? "pasukan" : "seed"} contoh. Pairing rasmi akan dipaparkan selepas seeding disahkan. Pilihan kekal dalam tab ini.`,
                  `Try the planned bracket with sample ${category === "TEAM" ? "teams" : "seeds"}. Official pairings will appear after seeding is confirmed. Picks stay in this tab.`,
                )}
        </p>
        {activeMode === "picks" && (
          <button
            type="button"
            className={styles.reset}
            disabled={!Object.keys(picks).length}
            onClick={() => {
              setPicks({});
              setAnnouncement(
                t("Semua pilihan dikosongkan.", "All picks reset."),
              );
            }}
          >
            <RotateCcw size={13} aria-hidden="true" />
            {t("Mula semula", "Reset picks")}
          </button>
        )}
      </div>

      <div className={styles.progress}>
        <span>
          {activeMode === "picks"
            ? t(
                "Pilih pasukan atau seed untuk mara",
                "Select a team or seed to advance",
              )
            : t("Keputusan rasmi", "Official results")}
        </span>
        <strong>
          {completed}/{total}{" "}
          {activeMode === "picks"
            ? t("pilihan", "picked")
            : t("selesai", "complete")}
        </strong>
        <div
          role="progressbar"
          aria-label={
            activeMode === "picks"
              ? t("Pilihan bracket", "Bracket picks")
              : t("Kemajuan kejohanan", "Tournament progress")
          }
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={completed}
        >
          <span
            style={{ width: `${total ? (completed / total) * 100 : 0}%` }}
          />
        </div>
      </div>

      <div
        className={`${styles.podium}${champion ? ` ${styles.decided}` : ""}`}
      >
        <div>
          <Trophy size={23} aria-hidden="true" />
          {category === "TEAM" && champion && avatar(champion)}
          <span>
            <small>
              {activeMode === "picks"
                ? t("Pilihan juara", "Champion pick")
                : t("Juara", "Champion")}
            </small>
            <strong>
              {champion
                ? display(champion)
                : t("Menunggu pemenang final", "Awaiting final winner")}
            </strong>
          </span>
        </div>
        <div>
          <Medal size={23} aria-hidden="true" />
          {category === "TEAM" && runnerUp && avatar(runnerUp)}
          <span>
            <small>
              {activeMode === "picks"
                ? t("Pilihan naib juara", "Runner-up pick")
                : t("Naib juara", "Runner-up")}
            </small>
            <strong>
              {runnerUp
                ? display(runnerUp)
                : t("Menunggu final", "Awaiting final")}
            </strong>
          </span>
        </div>
      </div>

      {category === "SOLO" && (
        <BracketQualification
          configuration={configuration}
          stages={stages}
          participants={participants}
        />
      )}

      <div
        className={styles.scroll}
        tabIndex={0}
        role="region"
        aria-label={t(
          "Bracket, skrol mendatar untuk semua peringkat",
          "Bracket, scroll horizontally to see every round",
        )}
      >
        <div
          className={styles.columns}
          style={
            {
              "--bracket-height": `${source[0].matches.length * 164}px`,
            } as CSSProperties
          }
        >
          {resolved.map((round, roundIndex) => (
            <div className={styles.column} key={round.number}>
              <div className={styles.roundHeading}>
                <span>{String(roundIndex + 1).padStart(2, "0")}</span>
                <div>
                  <h5>{roundName(round.size)}</h5>
                  <small>
                    {round.matches.length}{" "}
                    {t(
                      "perlawanan",
                      round.matches.length === 1 ? "match" : "matches",
                    )}
                  </small>
                </div>
              </div>
              <div
                className={styles.matches}
                style={{
                  gridTemplateRows: `repeat(${round.matches.length}, minmax(0, 1fr))`,
                }}
              >
                {round.matches.map((match) => {
                  const label = bracketMatchLabel(round.size, match.order);
                  const canPick =
                    activeMode === "picks" && Boolean(match.a && match.b);
                  const previous = resolved[roundIndex - 1];
                  const placeholder = (side: number) =>
                    previous
                      ? t("Pemenang", "Winner") +
                        " " +
                        bracketMatchLabel(
                          previous.size,
                          match.order * 2 - 1 + side,
                        )
                      : t("Menunggu peserta", "Awaiting entrant");
                  const score =
                    activeMode === "official" && match.result
                      ? `${match.result.games.filter((game) => game.scoreA > game.scoreB).length}–${match.result.games.filter((game) => game.scoreB > game.scoreA).length}`
                      : null;
                  return (
                    <div
                      className={`${styles.slot}${roundIndex < resolved.length - 1 ? ` ${styles.outgoing}` : ""}`}
                      key={match.id}
                    >
                      {previous && (
                        <span className={styles.connector} aria-hidden="true" />
                      )}
                      <article
                        className={`${styles.match}${match.winner ? ` ${styles.complete}` : ""}`}
                        aria-label={label}
                      >
                        <div className={styles.matchHeading}>
                          <strong>{label}</strong>
                          <span>
                            {t("Series", "Series")} BO{match.bestOf}
                          </span>
                        </div>
                        {([match.a, match.b] as const).map((entrant, side) => {
                          const winner = Boolean(
                            entrant && match.winner?.id === entrant.id,
                          );
                          const name = entrant
                            ? display(entrant)
                            : match.status === "BYE" && side === 1
                              ? "BYE"
                              : placeholder(side);
                          const origin =
                            entrant && !entrant.seed
                              ? origins.get(entrant.label.split(" · ")[0])
                              : undefined;
                          const contents = (
                            <>
                              {category === "TEAM" && entrant ? (
                                avatar(entrant)
                              ) : (
                                <span className={styles.seed}>
                                  {entrant?.seed ?? (side === 0 ? "A" : "B")}
                                </span>
                              )}
                              <span className={styles.entrantName}>
                                {name}
                                {origin && (
                                  <small className={styles.origin}>
                                    {origin.stage === "league"
                                      ? t("Liga", "League")
                                      : t("Kelayakan", "Qualification")}{" "}
                                    #{origin.rank}
                                  </small>
                                )}
                              </span>
                              {winner && <Check size={15} aria-hidden="true" />}
                            </>
                          );
                          return activeMode === "picks" ? (
                            <button
                              type="button"
                              key={side}
                              className={`${styles.entrant}${winner ? ` ${styles.winner}` : ""}`}
                              disabled={!canPick}
                              aria-pressed={winner}
                              aria-label={t(
                                `Pilih ${name} sebagai pemenang ${label}`,
                                `Pick ${name} as winner of ${label}`,
                              )}
                              title={name}
                              onClick={() =>
                                entrant && choose(match.id, entrant, label)
                              }
                            >
                              {contents}
                            </button>
                          ) : (
                            <div
                              key={side}
                              className={`${styles.entrant}${winner ? ` ${styles.winner}` : ""}`}
                              title={name}
                            >
                              {contents}
                            </div>
                          );
                        })}
                        <div className={styles.matchFooter}>
                          {match.winner ? (
                            <span>
                              {t("Pemenang", "Winner")}: {display(match.winner)}
                              {score &&
                              !match.result?.outcome.includes("FORFEIT")
                                ? ` · ${score}`
                                : ""}
                              {activeMode === "official" &&
                              match.result?.outcome.includes("FORFEIT")
                                ? ` · ${t("Menang tanpa bertanding", "Forfeit")}`
                                : ""}
                            </span>
                          ) : (
                            <span>
                              {activeMode === "official"
                                ? matchStatus(match.status)
                                : canPick
                                  ? t("Pilih pemenang", "Pick a winner")
                                  : t(
                                      "Menunggu pemenang sebelumnya",
                                      "Awaiting earlier winners",
                                    )}
                            </span>
                          )}
                        </div>
                      </article>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
      <p className={styles.scrollHint}>
        {t(
          "Skrol mendatar untuk ikut laluan ke final. Selamat bertanding!",
          "Scroll across to follow the path to the final. Good luck & have fun!",
        )}
      </p>
      <span className="sr-only" role="status" aria-live="polite">
        {announcement}
        {champion
          ? ` ${t("Juara", "Champion")}: ${display(champion)}. ${t("Naib juara", "Runner-up")}: ${runnerUp ? display(runnerUp) : "—"}.`
          : ""}
      </span>
    </section>
  );
}
