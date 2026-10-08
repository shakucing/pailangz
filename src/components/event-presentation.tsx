"use client";

import { useId, useState } from "react";
import { ArrowRight, ShieldCheck, Swords, Trophy, Users } from "lucide-react";
import { useLocale } from "./locale-context";
import { InteractiveBracket, type BracketTeam } from "./interactive-bracket";
import {
  configuredByes,
  progressionRounds,
  qualificationRange,
} from "@/lib/tournament-presentation";
import type { TournamentConfiguration } from "@/lib/tournament-config";
import type {
  EventMatch,
  EventPresentationData,
} from "@/lib/event-presentation-data";
import styles from "./event-presentation.module.css";

export function EventPresentation({
  data,
  configuration: config,
  teams,
}: {
  data: EventPresentationData | null;
  configuration: TournamentConfiguration;
  teams?: BracketTeam[];
}) {
  const locale = useLocale();
  const t = (ms: string, en: string) => (locale === "en" ? en : ms);
  const id = useId();
  const [category, setCategory] = useState<"SOLO" | "TEAM">("SOLO");
  const [stageKey, setStageKey] = useState("league");
  const [roundNumber, setRoundNumber] = useState(1);
  const [view, setView] = useState<"fixtures" | "standings" | "bracket">(
    "fixtures",
  );
  const solo = category === "SOLO";
  const categoryData = data?.categories.find((c) => c.kind === category);
  const stages = solo
    ? [
        "league",
        ...(config.playoffEntrants ? ["qualification"] : []),
        "knockout",
      ]
    : ["knockout"];
  const stage = categoryData?.stages.find((s) => s.key === stageKey);
  const round =
    stage?.rounds.find((r) => r.number === roundNumber) ?? stage?.rounds[0];
  const knockout = categoryData?.stages.find((s) => s.key === "knockout");
  const entrants = solo
    ? (data?.participants ?? [])
    : (categoryData?.teams ?? []);
  const capacity = solo ? config.soloCapacity : config.teamCapacity;
  const teamNames = new Map(
    categoryData?.teams.map((team) => [team.code, team.name]) ?? [],
  );
  const playerNames = new Map(
    data?.participants.filter((p) => p.ign).map((p) => [p.code, p.ign]) ?? [],
  );
  const hasPlayerNames = playerNames.size > 0;
  const rounds = progressionRounds(config, category);
  const range = qualificationRange(config);
  const byes = configuredByes(config, category);
  const status =
    data?.preview || !data
      ? t("Pratonton jadual", "Schedule preview")
      : data.status === "IN_PROGRESS"
        ? t("Sedang berlangsung", "In progress")
        : data.status === "COMPLETED"
          ? t("Selesai", "Completed")
          : t("Kejohanan diterbitkan", "Published tournament");
  const name = (key: string) =>
    key === "league"
      ? t("Liga", "League")
      : key === "qualification"
        ? t("Kelayakan", "Qualification")
        : "Knockout";
  const roundName = (size: number) =>
    size === 2
      ? "Final"
      : size === 4
        ? t("Separuh akhir", "Semifinals")
        : size === 8
          ? t("Suku akhir", "Quarterfinals")
          : t(`${size} terbaik`, `Round of ${size}`);
  const code = (value: string | null) =>
    !value || ["Awaiting entrant", "Menunggu peserta"].includes(value)
      ? t("Menunggu peserta", "Awaiting entrant")
      : value;
  const matchStatus = (value: string) =>
    ({
      SCHEDULED: t("Dijadualkan", "Scheduled"),
      IN_PROGRESS: t("Berlangsung", "In progress"),
      FINALIZED: t("Muktamad", "Finalized"),
      RESULT_SUBMITTED: t("Menunggu semakan", "Under review"),
      DISPUTED: t("Dipertikaikan", "Disputed"),
      VOIDED: t("Dibatalkan", "Voided"),
      BYE: "BYE",
    })[value] ?? value.replaceAll("_", " ");
  const score = (match: EventMatch) => {
    if (!match.result) return "—";
    const games = match.result.games;
    return `${games.filter((g) => g.scoreA > g.scoreB).length}–${games.filter((g) => g.scoreB > g.scoreA).length}`;
  };
  const chooseStage = (key: string) => {
    setStageKey(key);
    setRoundNumber(1);
  };
  const chooseCategory = (next: "SOLO" | "TEAM") => {
    setCategory(next);
    chooseStage(next === "SOLO" ? "league" : "knockout");
    setView(next === "SOLO" ? "fixtures" : "bracket");
  };

  return (
    <div className={styles.presentation}>
      <div className={styles.heading}>
        <div>
          <div className="eyebrow">SOLO & TEAM · Event centre</div>
          <h2>
            {t("Dua kategori. Satu pentas.", "Two categories. One arena.")}
          </h2>
          <p>{data?.name ?? "PAILANGZ & PAILANGZZ — Solo & Team Tournament"}</p>
        </div>
        <span className="badge warning">{status}</span>
      </div>
      {!hasPlayerNames && (
        <div className={styles.privacy}>
          <ShieldCheck size={15} aria-hidden="true" />
          {t(
            "Ikuti pemain melalui kod dan pasukan melalui nama.",
            "Follow players by code and teams by name.",
          )}
        </div>
      )}
      <div
        className={styles.categorySwitch}
        role="group"
        aria-label={t("Kategori acara", "Event category")}
      >
        <button
          type="button"
          aria-pressed={solo}
          onClick={() => chooseCategory("SOLO")}
        >
          <Swords size={16} aria-hidden="true" />
          <span>
            SOLO
            <small>
              {t(
                "Liga → Kelayakan → Knockout",
                "League → Qualification → Knockout",
              )}
            </small>
          </span>
        </button>
        <button
          type="button"
          aria-pressed={!solo}
          onClick={() => chooseCategory("TEAM")}
        >
          <Users size={16} aria-hidden="true" />
          <span>
            TEAM
            <small>{t("4 pemain · Knockout", "4 players · Knockout")}</small>
          </span>
        </button>
      </div>
      <div className={styles.metrics}>
        <div>
          <strong>
            {entrants.length}
            <small> / {capacity}</small>
          </strong>
          <span>
            {solo
              ? t("Pemain berdaftar", "Registered players")
              : t("Kod pasukan berdaftar", "Registered team codes")}
          </span>
        </div>
        <div>
          <strong>{solo ? config.leagueRounds : rounds.length}</strong>
          <span>
            {solo
              ? t("Pusingan liga", "League rounds")
              : t("Pusingan knockout", "Knockout rounds")}
          </span>
        </div>
        <div>
          <strong>
            {solo ? config.soloBracketSize : config.teamBracketSize}
          </strong>
          <span>{t("Slot bracket knockout", "Knockout bracket places")}</span>
        </div>
        <div>
          <strong>{solo ? "BO3 / BO5" : "BO3 → BO5"}</strong>
          <span>{t("Format series", "Series format")}</span>
        </div>
      </div>

      <div
        className={styles.chart}
        role="region"
        aria-label={`${category} ${t("carta laluan", "progression chart")}`}
      >
        <div className={styles.chartHeading}>
          <h3>{t("Laluan ke trofi", "The road to the trophy")}</h3>
          <span>
            {t("Berdasarkan konfigurasi acara", "From the event configuration")}
          </span>
        </div>
        <div className={styles.route}>
          <div className={styles.routeCard}>
            <span className={styles.kicker}>
              {solo
                ? t("Liga · BO3", "League · BO3")
                : t("Roster pasukan", "Team rosters")}
            </span>
            <strong>{capacity}</strong>
            <span>
              {solo
                ? t("slot pemain", "player places")
                : t("slot pasukan", "team places")}
            </span>
            <p>
              {solo
                ? t(
                    `${config.leagueMatchesPerPlayer} perlawanan setiap pemain`,
                    `${config.leagueMatchesPerPlayer} matches per player`,
                  )
                : t(
                    "Empat pemain layak setiap pasukan",
                    "Four eligible players per team",
                  )}
            </p>
          </div>
          <ArrowRight
            className={styles.routeArrow}
            size={18}
            aria-hidden="true"
          />
          <div className={styles.qualification}>
            {solo ? (
              <>
                {config.directSlots > 0 && (
                  <div>
                    <span>{t("Layak terus", "Direct qualification")}</span>
                    <strong>Top {config.directSlots}</strong>
                    <small>
                      {config.directSlots}{" "}
                      {t("slot knockout", "knockout places")}
                    </small>
                  </div>
                )}
                {range && (
                  <div>
                    <span>{t("Kelayakan", "Qualification")}</span>
                    <strong>
                      {t("Kedudukan", "Ranks")} {range.from}–{range.to}
                    </strong>
                    <small>
                      Top {config.playoffSlots} {t("mara", "advance")} ·{" "}
                      {config.qualificationMatchesPerPlayer}{" "}
                      {t("perlawanan setiap pemain", "matches each")}
                    </small>
                  </div>
                )}
              </>
            ) : (
              <div>
                <span>{t("Seeding", "Seeding")}</span>
                <strong>{t("Roster disahkan", "Confirmed rosters")}</strong>
                <small>
                  {t(
                    "Susunan seed ditentukan penganjur",
                    "Seed order confirmed by the organizer",
                  )}
                </small>
              </div>
            )}
          </div>
          <ArrowRight
            className={styles.routeArrow}
            size={18}
            aria-hidden="true"
          />
          <div className={`${styles.routeCard} ${styles.knockoutCard}`}>
            <span className={styles.kicker}>Knockout</span>
            <strong>
              {solo
                ? config.directSlots + config.playoffSlots
                : config.teamCapacity}
            </strong>
            <span>
              {solo
                ? t("pemain layak", "qualifying players")
                : t("pasukan", "teams")}
            </span>
            <p>{solo ? "BO5" : t("BO3 · Final BO5", "BO3 · BO5 final")}</p>
            {byes > 0 && (
              <small>
                {byes} {t("bye untuk seed teratas", "byes for top seeds")}
              </small>
            )}
          </div>
        </div>
        <ol className={styles.knockoutFlow}>
          {rounds.map((r) => (
            <li key={r.key}>
              <strong>{r.size}</strong>
              <span>{roundName(r.size)}</span>
              <small>BO{r.bestOf}</small>
            </li>
          ))}
          <li className={styles.champion}>
            <Trophy size={19} aria-hidden="true" />
            <span>{t("Juara", "Champion")}</span>
          </li>
        </ol>
      </div>

      <div className={styles.workspace}>
        <div className={styles.workspaceHeading}>
          <div>
            <h3>
              {solo
                ? t("Papan acara SOLO", "SOLO event board")
                : t("Papan acara TEAM", "TEAM event board")}
            </h3>
            <p>
              {data?.preview
                ? t(
                    "Jadual tersimpan · Keputusan rasmi belum diterbitkan",
                    "Saved schedule · Official results not yet published",
                  )
                : t(
                    "Peserta, perlawanan dan keputusan rasmi",
                    "Entrants, fixtures and official results",
                  )}
            </p>
          </div>
          <div
            className={styles.viewSwitch}
            role="group"
            aria-label={t("Paparan acara", "Event view")}
          >
            {(["fixtures", "standings", "bracket"] as const)
              .filter((v) => solo || v !== "standings")
              .map((v) => (
                <button
                  type="button"
                  key={v}
                  aria-pressed={view === v}
                  onClick={() => setView(v)}
                >
                  {v === "fixtures"
                    ? t("Perlawanan", "Fixtures")
                    : v === "standings"
                      ? t("Kedudukan", "Standings")
                      : "Bracket"}
                </button>
              ))}
          </div>
        </div>

        {view !== "bracket" && (
          <div
            className={styles.stageSwitch}
            role="group"
            aria-label={t("Peringkat acara", "Event stage")}
          >
            {stages.map((key) => (
              <button
                type="button"
                key={key}
                aria-pressed={stageKey === key}
                onClick={() => chooseStage(key)}
              >
                {name(key)}
              </button>
            ))}
          </div>
        )}

        {view === "bracket" ? (
          <InteractiveBracket
            key={category}
            configuration={config}
            category={category}
            rounds={knockout?.rounds}
            storageScope={data?.slug}
            teams={teams}
          />
        ) : view === "standings" ? (
          stage?.standings.length ? (
            <div
              className={styles.tableScroll}
              tabIndex={0}
              role="region"
              aria-label={`${category} ${name(stageKey)} ${t("kedudukan", "standings")}`}
            >
              <table>
                <caption className="sr-only">
                  {category} {name(stageKey)} {t("kedudukan", "standings")}
                </caption>
                <thead>
                  <tr>
                    {[
                      t("Kedudukan", "Rank"),
                      t("Pemain", "Player"),
                      "P",
                      "W",
                      "D",
                      "L",
                      "Pts",
                    ].map((label) => (
                      <th scope="col" key={label}>
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {stage.standings.map((r) => (
                    <tr key={r.code}>
                      <td>{r.rank ?? t("Seri", "Tied")}</td>
                      <th scope="row">
                        {r.code}
                        {playerNames.get(r.code) &&
                          ` · ${playerNames.get(r.code)}`}
                      </th>
                      <td>{r.played}</td>
                      <td>{r.wins}</td>
                      <td>{r.draws}</td>
                      <td>{r.losses}</td>
                      <td>{r.points}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className={styles.empty}>
              <Trophy size={26} aria-hidden="true" />
              <strong>
                {t(
                  "Kedudukan rasmi belum diterbitkan",
                  "Official standings not yet published",
                )}
              </strong>
              <p>
                {t(
                  "Kedudukan dan mata akan dipaparkan selepas keputusan rasmi diterbitkan.",
                  "Rankings and points will appear after official results are published.",
                )}
              </p>
            </div>
          )
        ) : (
          <>
            {!!stage?.rounds.length && (
              <div
                className={styles.roundSwitch}
                role="group"
                aria-label={t("Pusingan acara", "Event round")}
              >
                {stage.rounds.map((r) => (
                  <button
                    type="button"
                    key={r.number}
                    aria-pressed={round?.number === r.number}
                    onClick={() => setRoundNumber(r.number)}
                  >
                    {t(`Pusingan ${r.number}`, `Round ${r.number}`)}
                  </button>
                ))}
              </div>
            )}
            {round?.matches.length ? (
              <div
                className={styles.tableScroll}
                id={`${id}-fixtures`}
                tabIndex={0}
                role="region"
                aria-label={`${name(stageKey)} · ${t(`Pusingan ${round.number}`, `Round ${round.number}`)}`}
              >
                <table>
                  <caption>
                    {name(stageKey)} ·{" "}
                    {t(`Pusingan ${round.number}`, `Round ${round.number}`)}{" "}
                    <span>
                      {round.matches.length} {t("perlawanan", "matches")}
                    </span>
                  </caption>
                  <thead>
                    <tr>
                      {[
                        "#",
                        t("Pihak A", "Side A"),
                        t("Pihak B", "Side B"),
                        "BO",
                        t("Skor", "Score"),
                        "Status",
                      ].map((label) => (
                        <th scope="col" key={label}>
                          {label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {round.matches.map((m, i) => (
                      <tr key={m.id}>
                        <td>{m.order ?? i + 1}</td>
                        <th scope="row">{code(m.a)}</th>
                        <td className={styles.opponent}>{code(m.b)}</td>
                        <td>{m.bestOf}</td>
                        <td>{score(m)}</td>
                        <td>
                          <span className={styles.matchStatus}>
                            {matchStatus(m.status)}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className={styles.empty}>
                <Swords size={26} aria-hidden="true" />
                <strong>
                  {t(
                    "Perlawanan belum disediakan",
                    "Fixtures not prepared yet",
                  )}
                </strong>
                <p>
                  {t(
                    "Perlawanan bagi peringkat ini akan dipaparkan apabila peserta dan pairing disahkan.",
                    "Fixtures for this stage will appear when entrants and pairings are confirmed.",
                  )}
                </p>
              </div>
            )}
          </>
        )}

        <div className={styles.entrants}>
          <div>
            <h4>
              {solo
                ? hasPlayerNames
                  ? t("Pemain & nama dalam game", "Players & in-game names")
                  : t("Kod pemain", "Player codes")
                : t("Pasukan & kod", "Teams & codes")}
            </h4>
            <span>
              {entrants.length} {t("rekod tersimpan", "saved records")}
            </span>
          </div>
          {entrants.length ? (
            <ul>
              {entrants.map((entrant) => (
                <li key={entrant.code}>
                  {entrant.code}
                  {solo && playerNames.get(entrant.code) && (
                    <span> · {playerNames.get(entrant.code)}</span>
                  )}
                  {!solo && <span> · {teamNames.get(entrant.code)}</span>}
                </li>
              ))}
            </ul>
          ) : (
            <p>
              {solo
                ? t(
                    "Pemain belum didaftarkan. Roster akan dipaparkan selepas rekod peserta diwujudkan.",
                    "Players have not been registered. The roster will appear after participant records are created.",
                  )
                : t(
                    "Pasukan belum didaftarkan. Nama dan kod akan dipaparkan selepas rekod pasukan diwujudkan.",
                    "Teams have not been registered. Names and codes will appear after team records are created.",
                  )}
            </p>
          )}
        </div>
      </div>
      <p className={styles.note}>
        {t(
          "Kod peserta merujuk rekod acara, bukan kedudukan atau seed. Roster, tarikh, format kelayakan dan keputusan menunggu pengesahan penganjur.",
          "Entrant codes identify event records, not rankings or seeds. Rosters, dates, qualification format and results are subject to organizer confirmation.",
        )}
      </p>
    </div>
  );
}
