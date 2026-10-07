"use client";

import { useId, useState } from "react";
import { ChevronDown, GitBranch, Trophy } from "lucide-react";
import { useLocale } from "./locale-context";
import type { TournamentConfiguration } from "@/lib/tournament-config";
import {
  configuredByes,
  progressionRounds,
  qualificationRange,
} from "@/lib/tournament-presentation";

type StageDetail = {
  key: string;
  title: string;
  subtitle: string;
  format: string;
  entrants: string;
  description: string;
  condition: string;
  next: string;
};

export function TournamentProgression({
  configuration: config,
  planned = false,
  qualificationBestOf,
}: {
  configuration: TournamentConfiguration;
  planned?: boolean;
  qualificationBestOf?: number | null;
}) {
  const locale = useLocale();
  const t = (ms: string, en: string) => (locale === "en" ? en : ms);
  const id = useId();
  const [category, setCategory] = useState<"SOLO" | "TEAM">("SOLO");
  const [selected, setSelected] = useState("league");
  const player = (n: number) => t(`${n} pemain`, `${n} players`);
  const team = (n: number) => t(`${n} pasukan`, `${n} teams`);
  const roundName = (n: number) =>
    n === 2
      ? t("Pusingan Akhir (Final)", "Grand Final")
      : n === 4
        ? t("Separuh Akhir", "Semifinals")
        : n === 8
          ? t("Suku Akhir", "Quarterfinals")
          : t(`Peringkat ${n} Terbaik`, `Round of ${n}`);
  const rounds = progressionRounds(config, category);
  const range = qualificationRange(config);
  const byes = configuredByes(config, category);
  const knockoutEntrants = config.directSlots + config.playoffSlots;
  const soloRoute = [
    config.directSlots
      ? t(
          `Top ${config.directSlots} layak terus`,
          `Top ${config.directSlots} qualify directly`,
        )
      : "",
    range
      ? t(
          `Kedudukan ${range.from}–${range.to} ke playoff`,
          `Ranks ${range.from}–${range.to} enter the playoffs`,
        )
      : "",
  ]
    .filter(Boolean)
    .join(" · ");
  const league: StageDetail = {
    key: "league",
    title: "Group League (SOLO)",
    subtitle: t(
      `${config.leagueRounds} pusingan · ${config.leagueMatchesPerPlayer} perlawanan · BO3`,
      `${config.leagueRounds} rounds · ${config.leagueMatchesPerPlayer} matches · BO3`,
    ),
    format: "BO3",
    entrants: player(config.soloCapacity),
    description: t(
      `Setiap pemain mempunyai ${config.leagueMatchesPerPlayer} perlawanan dengan lawan berbeza dalam ${config.leagueRounds} pusingan. Kedudukan liga menentukan laluan ke peringkat seterusnya.`,
      `Each player has ${config.leagueMatchesPerPlayer} matches against different opponents across ${config.leagueRounds} rounds. League rankings determine the route to the next stage.`,
    ),
    condition: t(
      "Kedudukan disahkan mengikut mata dan peraturan pemutus seri",
      "Rankings confirmed using points and approved tiebreak rules",
    ),
    next: soloRoute,
  };
  const direct: StageDetail = {
    key: "direct",
    title: t(
      `Top ${config.directSlots} · Layak Terus`,
      `Top ${config.directSlots} · Direct Qualification`,
    ),
    subtitle: t(
      `${config.directSlots} slot knockout`,
      `${config.directSlots} knockout places`,
    ),
    format: t("Kelayakan terus", "Direct qualification"),
    entrants: player(config.directSlots),
    description: t(
      "Pemain teratas dalam kedudukan liga yang disahkan mendapat slot terus ke knockout.",
      "The highest-ranked players in the confirmed league standings receive direct knockout places.",
    ),
    condition: t(
      `Kedudukan 1–${config.directSlots} dalam liga`,
      `League ranks 1–${config.directSlots}`,
    ),
    next: roundName(config.soloBracketSize),
  };
  const playoff: StageDetail = {
    key: "playoff",
    title: t(
      `Kedudukan ${range?.from}–${range?.to}`,
      `Ranks ${range?.from}–${range?.to}`,
    ),
    subtitle: t(
      `Playoff · ${config.qualificationMatchesPerPlayer} perlawanan`,
      `Playoffs · ${config.qualificationMatchesPerPlayer} matches`,
    ),
    format: qualificationBestOf
      ? `BO${qualificationBestOf}`
      : t("Format menunggu pengesahan", "Format awaiting confirmation"),
    entrants: player(config.playoffEntrants),
    description: t(
      `Setiap peserta playoff bermain ${config.qualificationMatchesPerPlayer} perlawanan untuk merebut ${config.playoffSlots} slot knockout. Peraturan playoff yang disahkan menentukan kedudukan.`,
      `Each playoff entrant plays ${config.qualificationMatchesPerPlayer} matches for ${config.playoffSlots} knockout places. Confirmed playoff rules determine the rankings.`,
    ),
    condition: t(
      `Top ${config.playoffSlots} dalam kedudukan playoff yang disahkan`,
      `Top ${config.playoffSlots} in the confirmed playoff rankings`,
    ),
    next: roundName(config.soloBracketSize),
  };
  const winners: StageDetail = {
    ...playoff,
    key: "winners",
    title: t(
      `${config.playoffSlots} Pemenang Playoff`,
      `${config.playoffSlots} Playoff Qualifiers`,
    ),
    subtitle: t(
      `${config.playoffSlots} slot knockout`,
      `${config.playoffSlots} knockout places`,
    ),
    entrants: player(config.playoffSlots),
  };
  const entry: StageDetail = {
    key: "entry",
    title: t(
      `${config.teamCapacity} Pasukan Bertanding`,
      `${config.teamCapacity} Competing Teams`,
    ),
    subtitle: t("Empat pemain setiap pasukan", "Four players per team"),
    format: t("Kelayakan & seeding", "Eligibility & seeding"),
    entrants: team(config.teamCapacity),
    description: t(
      "Pasukan dengan empat pemain yang layak memasuki bracket mengikut susunan seed yang disahkan.",
      "Teams of four eligible players enter the bracket in the approved seed order.",
    ),
    condition: t(
      "Roster, kelayakan dan seeding disahkan",
      "Rosters, eligibility and seeding confirmed",
    ),
    next: roundName(config.teamBracketSize),
  };
  const knockout = rounds.map((r, index): StageDetail => ({
    key: r.key,
    title: roundName(r.size),
    subtitle: `${category === "SOLO" ? player(index === 0 && byes ? knockoutEntrants : r.size) : team(index === 0 && byes ? config.teamCapacity : r.size)} · BO${r.bestOf}`,
    format: `BO${r.bestOf}`,
    entrants:
      category === "SOLO"
        ? player(index === 0 && byes ? knockoutEntrants : r.size)
        : team(index === 0 && byes ? config.teamCapacity : r.size),
    description:
      index === 0 && byes
        ? t(
            `Bracket ${r.size} slot dengan ${category === "SOLO" ? player(knockoutEntrants) : team(config.teamCapacity)} dan ${byes} bye untuk seed teratas.`,
            `A ${r.size}-slot bracket with ${category === "SOLO" ? player(knockoutEntrants) : team(config.teamCapacity)} and ${byes} byes for the highest seeds.`,
          )
        : t(
            `${r.matches} perlawanan knockout. Pemenang series yang disahkan mara ke peringkat seterusnya.`,
            `${r.matches} knockout ${r.matches === 1 ? "match" : "matches"}. Confirmed series winners advance.`,
          ),
    condition: t(
      `Menang series BO${r.bestOf}${index === 0 && byes ? " atau menerima bye yang disahkan" : ""}`,
      `Win the BO${r.bestOf} series${index === 0 && byes ? " or receive an approved bye" : ""}`,
    ),
    next:
      index === rounds.length - 1
        ? t("Juara kejohanan", "Tournament champion")
        : roundName(rounds[index + 1].size),
  }));
  const available =
    category === "SOLO"
      ? [
          league,
          ...(config.directSlots ? [direct] : []),
          ...(range ? [playoff, winners] : []),
          ...knockout,
        ]
      : [entry, ...knockout];
  const detail = available.find((s) => s.key === selected) ?? available[0];
  function node(stage: StageDetail, accent = false, final = false) {
    return (
      <button
        type="button"
        key={stage.key}
        className={`progression-node${accent ? " entry" : ""}${final ? " final" : ""}${detail.key === stage.key ? " selected" : ""}`}
        aria-pressed={detail.key === stage.key}
        aria-controls={`${id}-detail`}
        onClick={() => setSelected(stage.key)}
      >
        <span>{stage.title}</span>
        <small>{stage.subtitle}</small>
      </button>
    );
  }
  const arrow = (
    <div className="progression-arrow" aria-hidden="true">
      <ChevronDown size={14} />
    </div>
  );
  return (
    <div className="tournament-presentation">
      <div className="progression-heading">
        <div>
          <span className="eyebrow">
            <GitBranch size={14} />
            {t("Laluan ke final", "Road to the final")}
          </span>
          <h2>{t("Satu arena. Dua laluan.", "One arena. Two paths.")}</h2>
          <p>
            {t(
              "Tekan mana-mana peringkat untuk melihat format dan syarat kelayakan.",
              "Select a stage to explore its format and qualification requirements.",
            )}
          </p>
        </div>
        {planned && (
          <span className="badge warning">
            {t("Format dirancang", "Planned format")}
          </span>
        )}
      </div>
      <div
        className="presentation-switch"
        role="group"
        aria-label={t("Kategori kejohanan", "Tournament category")}
      >
        {(["SOLO", "TEAM"] as const).map((kind) => (
          <button
            key={kind}
            type="button"
            aria-pressed={category === kind}
            className={category === kind ? "active" : ""}
            onClick={() => {
              setCategory(kind);
              setSelected(kind === "SOLO" ? "league" : "entry");
            }}
          >
            {t("Kategori", "Category")} <strong>{kind}</strong>
          </button>
        ))}
      </div>
      <div
        className="progression-canvas"
        role="group"
        aria-label={`${category} ${t("laluan kejohanan", "tournament progression")}`}
      >
        {category === "SOLO" ? (
          <>
            {node(league, true)}
            <div
              className={`progression-paths${config.directSlots && range ? " split" : ""}`}
            >
              {!!config.directSlots && (
                <div className="progression-path">
                  <span className="path-label">
                    {t("Layak terus", "Direct qualification")}
                  </span>
                  {arrow}
                  {node(direct)}
                </div>
              )}
              {range && (
                <div className="progression-path">
                  <span className="path-label">
                    {t("Penentuan playoff", "Playoff qualification")}
                  </span>
                  {arrow}
                  {node(playoff)}
                  {arrow}
                  {node(winners)}
                </div>
              )}
            </div>
            {arrow}
          </>
        ) : (
          <>
            {node(entry, true)}
            {arrow}
          </>
        )}
        {knockout.map((stage, i) => (
          <div className="progression-round" key={stage.key}>
            {node(stage, false, i === knockout.length - 1)}
            {i < knockout.length - 1 && arrow}
          </div>
        ))}
        <Trophy className="progression-trophy" size={20} aria-hidden="true" />
      </div>
      <article
        id={`${id}-detail`}
        className="progression-detail"
        aria-live="polite"
        aria-atomic="true"
      >
        <div className="progression-detail-heading">
          <h3>{detail.title}</h3>
          <div>
            <span>
              {t("Format", "Format")}: {detail.format}
            </span>
            <span>{detail.entrants}</span>
          </div>
        </div>
        <p>{detail.description}</p>
        <dl>
          <div>
            <dt>
              {t(
                "Syarat kelayakan / kemenangan",
                "Qualification / winning requirement",
              )}
            </dt>
            <dd>{detail.condition}</dd>
          </div>
          <div>
            <dt>{t("Laluan seterusnya", "Next stage")}</dt>
            <dd>{detail.next}</dd>
          </div>
        </dl>
      </article>
      {planned && (
        <p className="presentation-note">
          {t(
            "Format dalam persediaan. Roster, peraturan, jadual dan keputusan rasmi akan diterbitkan selepas disahkan.",
            "The format is in preparation. Official rosters, rules, fixtures and results will be published after confirmation.",
          )}
        </p>
      )}
    </div>
  );
}
