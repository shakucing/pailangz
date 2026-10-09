import type { Metadata } from "next";
import localFont from "next/font/local";
import Image from "next/image";
import {
  ArrowDown,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  Check,
  Crosshair,
  Crown,
  Diamond,
  Flame,
  Flag,
  HeartHandshake,
  ShieldCheck,
  Swords,
  Timer,
  Trophy,
  Users,
  X,
  Zap,
} from "lucide-react";
import { NavigationLink as Link } from "@/components/navigation-link";
import { SoloExperience } from "@/components/solo-experience";
import { getLocale, translate } from "@/lib/i18n";
import styles from "@/components/solo-experience.module.css";

const display = localFont({
  src: "../../../public/fonts/barlow-condensed-black-italic.ttf",
  variable: "--font-solo-display",
  weight: "900",
  style: "italic",
  display: "swap",
});

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  return {
    title: "Solo Tournament — One arena. Your legacy.",
    description: translate(
      locale,
      "Kejohanan Solo PAILANGZ & PAILANGZZ. Terokai format liga, laluan Top 16, peraturan, hadiah dan peluang menjadi skuad utama.",
      "The PAILANGZ & PAILANGZZ Solo Tournament. Explore the league format, Top 16 pathway, rules, rewards and your shot at the main squad.",
    ),
  };
}

function ChapterLabel({
  number,
  children,
}: {
  number: string;
  children: React.ReactNode;
}) {
  return (
    <div className={styles.chapterLabel}>
      <span>{number}</span>
      <span>{children}</span>
      <span aria-hidden="true">↗</span>
    </div>
  );
}

function Gem({ className = "" }: { className?: string }) {
  return (
    <svg
      className={`${styles.gem} ${className}`}
      viewBox="0 0 300 260"
      fill="none"
      aria-hidden="true"
    >
      <defs>
        <linearGradient
          id="solo-gem-a"
          x1="50"
          y1="25"
          x2="210"
          y2="230"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#ffb3e5" />
          <stop offset=".45" stopColor="#fa41a7" />
          <stop offset="1" stopColor="#8a124d" />
        </linearGradient>
        <linearGradient
          id="solo-gem-b"
          x1="150"
          y1="70"
          x2="150"
          y2="250"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#ffe3f4" />
          <stop offset="1" stopColor="#ff4fb0" />
        </linearGradient>
      </defs>
      <path
        d="M61 35h178l46 57-135 153L15 92l46-57Z"
        fill="url(#solo-gem-a)"
        stroke="#ffb0dc"
        strokeWidth="2"
      />
      <path
        d="m61 35 35 57 54-57 54 57 35-57M15 92h270M96 92l54 153 54-153"
        stroke="#ffd4ed"
        strokeWidth="2"
      />
      <path
        d="m96 92 54-57 54 57-54 153-54-153Z"
        fill="url(#solo-gem-b)"
        fillOpacity=".6"
      />
      <path d="m61 35 35 57H15l46-57Z" fill="#fff" fillOpacity=".3" />
      <path d="m204 92 35-57 46 57h-81Z" fill="#ff55ac" />
      <path d="m150 35 54 57H96l54-57Z" fill="#fff" fillOpacity=".45" />
    </svg>
  );
}

export default async function SoloPage() {
  const locale = await getLocale();
  const t = (ms: string, en: string) => translate(locale, ms, en);
  const hero = (
    <section className={styles.hero} id="solo-top" aria-labelledby="solo-title">
      <div className={styles.heroGrid} aria-hidden="true" />
      <div className={styles.heroInner}>
        <div className={styles.heroMeta}>
          <span>
            <i /> {t("PENGUMUMAN TOURNAMENT", "TOURNAMENT ANNOUNCEMENT")}
          </span>
          <span>PAILANGZ × PAILANGZZ</span>
        </div>
        <div className={styles.heroCopy}>
          <p className={styles.kicker}>
            {t("SATU ARENA. GILIRAN ANDA.", "ONE ARENA. YOUR MOMENT.")}
          </p>
          <h1 id="solo-title" className={styles.heroTitle}>
            <span>SOLO</span>
            <span>
              TOURNAMENT
              <span className={styles.titleStar} aria-hidden="true">
                ✳
              </span>
            </span>
          </h1>
          <p className={styles.heroDescription}>
            {t(
              "Bulan hadapan, kita turun ke arena. Buktikan skill, rebut ganjaran, dan cipta nama bersama komuniti.",
              "Next month, we enter the arena. Prove your skill, claim your rewards, and build your name with the community.",
            )}
          </p>
          <div className={styles.heroActions}>
            <a className={styles.primaryButton} href="#format">
              {t("Terokai kejohanan", "Explore the tournament")}{" "}
              <ArrowDownRight size={19} aria-hidden="true" />
            </a>
            <a className={styles.simpleLink} href="#hadiah">
              {t("Lihat hadiah", "See the rewards")}{" "}
              <ArrowUpRight size={16} aria-hidden="true" />
            </a>
          </div>
        </div>
        <div className={styles.heroArt} aria-hidden="true">
          <div className={styles.orbitDisc} />
          <div className={styles.orbitRing} />
          <span className={styles.artCross}>+</span>
          <span className={styles.artCrossTwo}>+</span>
          <div className={styles.trophyLayer} data-parallax="0.12">
            <div className={styles.floatingTrophy}>
              <Image
                src="/solo/chrome-trophy.webp"
                alt=""
                width={1000}
                height={1000}
                sizes="(max-width: 700px) 90vw, 570px"
                preload
              />
            </div>
          </div>
          <div className={styles.prizeTag}>
            <Diamond size={19} />
            <span>
              GRAND PRIZE
              <strong>
                1,500 <small>PINK DIAMOND</small>
              </strong>
            </span>
            <ArrowUpRight size={17} />
          </div>
          <span className={styles.artCoordinate}>PZ / SOLO DIVISION</span>
          <span className={styles.artCaption}>BUILT FOR THE GANG.</span>
        </div>
        <div className={styles.heroBottom}>
          <a href="#format">
            <span className={styles.scrollIcon}>
              <ArrowDown size={16} aria-hidden="true" />
            </span>
            {t("SCROLL UNTUK MULA", "SCROLL TO BEGIN")}
          </a>
          <span>
            SOLO SKILL. <b>GANG SPIRIT.</b>
          </span>
          <span>01 — 07</span>
        </div>
      </div>
      <div className={styles.ticker} aria-hidden="true">
        <div className={styles.tickerTrack}>
          {[0, 1, 2, 3].map((i) => (
            <span key={i}>
              ONE ARENA <span>✳</span> YOUR LEGACY <span>✳</span> PAILANGZ SOLO{" "}
              <span>✳</span>
            </span>
          ))}
        </div>
      </div>
    </section>
  );
  return (
    <SoloExperience
      locale={locale}
      fontClassName={display.variable}
      hero={hero}
    >
      <section
        className={`${styles.container} ${styles.manifesto}`}
        aria-labelledby="spirit-title"
      >
        <div data-reveal>
          <span className={styles.kicker}>
            {t("DUA GANG. SATU SEMANGAT.", "TWO GANGS. ONE SPIRIT.")}
          </span>
          <h2 id="spirit-title" className={styles.manifestoTitle}>
            {t("LEBIH DARIPADA", "MORE THAN")}
            <br />
            <span>{t("SEBUAH GAME.", "JUST A GAME.")}</span>
          </h2>
        </div>
        <div className={styles.objectives}>
          {[
            [
              HeartHandshake,
              t("Rapatkan komuniti", "Bring us together"),
              t(
                "Mengeratkan silaturahim dan memeriahkan aktiviti grup.",
                "Build stronger friendships and bring more life to our group.",
              ),
            ],
            [
              Zap,
              t("Raikan yang aktif", "Reward the active"),
              t(
                "Habuan istimewa untuk ahli yang sentiasa aktif bersama.",
                "Special rewards for members who consistently show up.",
              ),
            ],
            [
              Flag,
              t("Angkat nama gang", "Raise the gang’s name"),
              t(
                "Penghargaan buat yang konsisten menaikkan PAILANGZ & PAILANGZZ dalam gang leaderboard.",
                "Recognition for those consistently lifting PAILANGZ & PAILANGZZ up the gang leaderboard.",
              ),
            ],
          ].map(([Icon, title, body], index) => {
            const Mark = Icon as typeof Zap;
            return (
              <div className={styles.objective} key={index} data-reveal>
                <Mark size={22} aria-hidden="true" />
                <div>
                  <h3>{title as string}</h3>
                  <p>{body as string}</p>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section
        className={`${styles.chapter} ${styles.formatSection}`}
        id="format"
        data-chapter
        aria-labelledby="format-title"
      >
        <div className={styles.container}>
          <ChapterLabel number="01">
            {t("FORMAT TOURNAMENT", "TOURNAMENT FORMAT")}
          </ChapterLabel>
          <div className={styles.formatLayout}>
            <div data-reveal>
              <h2 id="format-title" className={styles.sectionTitle}>
                {t("MASUK SOLO.", "ENTER SOLO.")}
                <br />
                <span>{t("MAIN HABIS.", "GIVE IT ALL.")}</span>
              </h2>
              <p className={styles.sectionIntro}>
                {t(
                  "Semua pemain dikumpulkan dalam Group League. Enam perlawanan untuk buktikan konsistensi anda.",
                  "Everyone competes in the Group League. Six matches to prove your consistency.",
                )}
              </p>
              <div className={styles.formatBadges}>
                <span>
                  <Users size={15} aria-hidden="true" /> GROUP LEAGUE
                </span>
                <span>
                  <Swords size={15} aria-hidden="true" /> BEST OF 3
                </span>
              </div>
            </div>
            <div className={styles.sixPanel} data-reveal>
              <div className={styles.sixHeader}>
                <Crosshair size={20} aria-hidden="true" />
                <span>{t("SETIAP PEMAIN", "EVERY PLAYER")}</span>
                <span>↙</span>
              </div>
              <strong className={styles.sixNumber}>
                06<span>×</span>
              </strong>
              <div className={styles.sixFooter}>
                <span>{t("PERLAWANAN LIGA", "LEAGUE MATCHES")}</span>
                <span>BO3 / GAME</span>
              </div>
            </div>
          </div>
          <div className={styles.pointsRow} data-reveal>
            {[
              ["03", "WIN", t("Menang", "Win"), styles.win],
              ["01", "DRAW", t("Seri", "Draw"), styles.draw],
              ["00", "LOSE", t("Kalah", "Loss"), styles.lose],
            ].map(([score, label, description, color]) => (
              <div className={`${styles.point} ${color}`} key={label}>
                <span className={styles.pointLabel}>
                  <i />
                  {label}
                </span>
                <strong>
                  {score}
                  <small>{t("MATA", "PTS")}</small>
                </strong>
                <span>{description}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section
        className={`${styles.chapter} ${styles.qualifySection}`}
        id="kelayakan"
        data-chapter
        aria-labelledby="qualify-title"
      >
        <div className={styles.container}>
          <ChapterLabel number="02">
            {t("KELAYAKAN TOP 16", "TOP 16 QUALIFICATION")}
          </ChapterLabel>
          <div className={styles.sectionHeading} data-reveal>
            <h2 id="qualify-title" className={styles.sectionTitle}>
              {t("DUA LALUAN.", "TWO PATHS.")}
              <br />
              <span>{t("SATU PENTAS.", "ONE STAGE.")}</span>
            </h2>
            <p className={styles.sectionIntro}>
              {t(
                "Tamat Group League? Kedudukan anda menentukan laluan ke peringkat kalah mati.",
                "Group League complete? Your ranking determines your route to the knockout stage.",
              )}
            </p>
          </div>
          <div className={styles.pathways}>
            <article className={styles.pathway} data-reveal>
              <div className={styles.pathwayTop}>
                <span>FAST TRACK</span>
                <ArrowUpRight size={24} aria-hidden="true" />
              </div>
              <span className={styles.rankLabel}>{t("KEDUDUKAN", "RANK")}</span>
              <strong className={styles.rank}>01—08</strong>
              <h3>{t("Terus ke Top 16.", "Straight to the Top 16.")}</h3>
              <p>
                {t(
                  "Lapan pemain teratas layak secara automatik. Konsistensi anda, tiket anda.",
                  "The top eight players qualify automatically. Your consistency is your ticket.",
                )}
              </p>
              <div className={styles.slotTag}>
                <Check size={16} aria-hidden="true" />{" "}
                {t("8 SLOT AUTOMATIK", "8 AUTOMATIC PLACES")}
              </div>
            </article>
            <article
              className={`${styles.pathway} ${styles.playoffPath}`}
              data-reveal
            >
              <div className={styles.pathwayTop}>
                <span>SECOND CHANCE</span>
                <Swords size={24} aria-hidden="true" />
              </div>
              <span className={styles.rankLabel}>{t("KEDUDUKAN", "RANK")}</span>
              <strong className={styles.rank}>09—24</strong>
              <h3>{t("Rebut baki slot.", "Fight for your place.")}</h3>
              <p>
                {t(
                  "Bermain 2 perlawanan penentuan. Lapan pemain terbaik mengisi slot Top 9–16.",
                  "Play two deciding matches. The best eight players fill the remaining Top 9–16 places.",
                )}
              </p>
              <div className={styles.slotTag}>
                <Flame size={16} aria-hidden="true" />{" "}
                {t("8 SLOT PENENTUAN", "8 QUALIFYING PLACES")}
              </div>
            </article>
          </div>
          <div className={styles.qualificationSum} data-reveal>
            <span>
              <b>8</b> {t("PEMAIN UTAMA", "DIRECT QUALIFIERS")}
            </span>
            <i>+</i>
            <span>
              <b>8</b> {t("PEMENANG PENENTUAN", "PLAYOFF WINNERS")}
            </span>
            <i>=</i>
            <span className={styles.sumResult}>
              <b>16</b> {t("PEMAIN LAYAK", "QUALIFIED PLAYERS")}
            </span>
          </div>
        </div>
      </section>

      <section
        className={`${styles.chapter} ${styles.knockoutSection}`}
        id="knockout"
        data-chapter
        aria-labelledby="knockout-title"
      >
        <div className={styles.container}>
          <ChapterLabel number="03">
            {t("PERINGKAT KALAH MATI", "KNOCKOUT STAGE")}
          </ChapterLabel>
          <div className={styles.sectionHeading} data-reveal>
            <h2 id="knockout-title" className={styles.sectionTitle}>
              {t("SATU DEMI SATU.", "ROUND BY ROUND.")}
              <br />
              <span>{t("HINGGA JUARA.", "UNTIL ONE REMAINS.")}</span>
            </h2>
            <span className={styles.bo5Badge}>
              BO5
              <span>
                {t("DARI TOP 16 HINGGA FINAL", "FROM TOP 16 TO THE FINAL")}
              </span>
            </span>
          </div>
          <div className={styles.knockoutTrack}>
            {[
              ["16", "ROUND OF 16", t("Best of 16", "Round of 16")],
              ["08", "QUARTER FINAL", t("Suku akhir", "Quarterfinal")],
              ["04", "SEMI FINAL", t("Separuh akhir", "Semifinal")],
              ["02", "THE FINAL", t("Perlawanan akhir", "The final")],
            ].map(([number, label, name], index) => (
              <div
                className={styles.knockoutStep}
                key={number}
                data-reveal
                style={{ "--step": index } as React.CSSProperties}
              >
                <span className={styles.stepIndex}>
                  0{index + 1} / {label}
                </span>
                <strong>{number}</strong>
                <div className={styles.stepBottom}>
                  <h3>{name}</h3>
                  {index === 3 ? (
                    <Trophy size={25} aria-hidden="true" />
                  ) : (
                    <ArrowRight size={25} aria-hidden="true" />
                  )}
                </div>
                <span className={styles.stepLine} />
              </div>
            ))}
          </div>
          <div className={styles.formatRecap} data-reveal>
            <span>
              GROUP LEAGUE <b>BO3</b>
            </span>
            <ArrowRight size={16} aria-hidden="true" />
            <span>
              PLAYOFF <b>{t("2 PERLAWANAN", "2 MATCHES")}</b>
            </span>
            <ArrowRight size={16} aria-hidden="true" />
            <span>
              TOP 16 → FINAL <b>BO5</b>
            </span>
          </div>
        </div>
      </section>

      <section
        className={`${styles.chapter} ${styles.rulesSection}`}
        id="peraturan"
        data-chapter
        aria-labelledby="rules-title"
      >
        <div className={styles.container}>
          <ChapterLabel number="04">
            {t("SENJATA, ITEM & INTEGRITI", "WEAPONS, ITEMS & INTEGRITY")}
          </ChapterLabel>
          <div className={styles.rulesLayout}>
            <div className={styles.rulesHeading} data-reveal>
              <ShieldCheck size={42} strokeWidth={1.2} aria-hidden="true" />
              <h2 id="rules-title" className={styles.sectionTitle}>
                REAL SKILL.
                <br />
                <span>FAIR PLAY.</span>
              </h2>
              <p className={styles.sectionIntro}>
                {t(
                  "Pentas yang adil untuk semua. Biar skill yang bercakap.",
                  "An even playing field for everyone. Let your skill do the talking.",
                )}
              </p>
              <span className={styles.noCheatStamp}>
                100% SKILL
                <br />
                0% CHEAT
              </span>
            </div>
            <div className={styles.rulesList}>
              <div className={styles.banHeading} data-reveal>
                <span>
                  {t(
                    "DILARANG SEPANJANG KEJOHANAN",
                    "BANNED THROUGHOUT THE TOURNAMENT",
                  )}
                </span>
                <span>NO EXCEPTIONS</span>
              </div>
              {["RPG", "SNIPER", "BOMB", "VEST", "MOD AMMO"].map((item, i) => (
                <div className={styles.banRow} key={item} data-reveal>
                  <span className={styles.banNumber}>0{i + 1}</span>
                  <strong>{item}</strong>
                  <X size={24} aria-label={t("Dilarang", "Banned")} />
                </div>
              ))}
              <div className={styles.integrity} data-reveal>
                <div>
                  <X size={18} aria-hidden="true" />
                  <h3>OFF PROFILE</h3>
                  <span>{t("DILARANG", "BANNED")}</span>
                </div>
                <p>
                  {t(
                    "Dilarang menggunakan Off Profile sepanjang kejohanan. Sebarang eksploitasi, kecurangan atau manipulasi sistem akan menyebabkan penyertaan dibatalkan serta-merta.",
                    "Off Profile is prohibited throughout the tournament. Any exploitation, cheating or system manipulation results in immediate disqualification.",
                  )}
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section
        className={`${styles.chapter} ${styles.commitSection}`}
        id="komitmen"
        data-chapter
        aria-labelledby="commit-title"
      >
        <div className={styles.container}>
          <ChapterLabel number="05">
            {t("KOMITMEN & KEHADIRAN", "COMMITMENT & ATTENDANCE")}
          </ChapterLabel>
          <div className={styles.commitLayout}>
            <div data-reveal>
              <span className={styles.warningLabel}>
                <Timer size={15} aria-hidden="true" />
                {t(
                  "MASA ANDA. TANGGUNGJAWAB ANDA.",
                  "YOUR TIME. YOUR RESPONSIBILITY.",
                )}
              </span>
              <h2 id="commit-title" className={styles.sectionTitle}>
                {t("DAFTAR.", "SIGN UP.")}
                <br />
                {t("HADIR.", "SHOW UP.")}
                <br />
                <span>{t("BERSAING.", "COMPETE.")}</span>
              </h2>
            </div>
            <div className={styles.commitDetails}>
              <div className={styles.commitNotice} data-reveal>
                <span>!</span>
                <div>
                  <h3>
                    {t(
                      "Pastikan anda ada masa.",
                      "Make sure you have the time.",
                    )}
                  </h3>
                  <p>
                    {t(
                      "Semak jadual sebelum mendaftar. Jangan daftar sekiranya ragu-ragu dengan komitmen masa anda.",
                      "Check the schedule before registering. Only sign up if you can commit to being there.",
                    )}
                  </p>
                </div>
              </div>
              <p className={styles.walkoverText} data-reveal>
                {t(
                  "Gagal hadir atau lewat tanpa notis? Anda disingkirkan serta-merta dan mata perlawanan dikira 0 / Kalah. Pihak lawan menerima Auto Win.",
                  "Absent or late without notice? You are disqualified immediately and receive 0 points / a loss. Your opponent receives an automatic win.",
                )}
              </p>
              <div className={styles.walkoverScores} data-reveal>
                {[
                  ["BO3", "2—0"],
                  ["BO5", "3—0"],
                ].map(([format, score]) => (
                  <div key={format}>
                    <span>{format} / AUTO WIN</span>
                    <strong>{score}</strong>
                    <small>{t("KEPADA PIHAK LAWAN", "TO YOUR OPPONENT")}</small>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section
        className={`${styles.chapter} ${styles.rewardSection}`}
        id="hadiah"
        data-chapter
        aria-labelledby="rewards-title"
      >
        <div className={styles.rewardGlow} aria-hidden="true" />
        <div className={styles.container}>
          <ChapterLabel number="06">
            {t("HADIAH PEMENANG", "WINNER REWARDS")}
          </ChapterLabel>
          <div className={styles.sectionHeading} data-reveal>
            <h2 id="rewards-title" className={styles.sectionTitle}>
              {t("MAIN UNTUK NAMA.", "PLAY FOR GLORY.")}
              <br />
              <span>{t("MENANG GANJARAN.", "CLAIM YOUR REWARD.")}</span>
            </h2>
            <span className={styles.rewardEyebrow}>
              <Diamond size={18} aria-hidden="true" />{" "}
              {t("TOP 16 SEMUA DAPAT HADIAH", "REWARDS FOR ALL TOP 16")}
            </span>
          </div>
          <div className={styles.grandPrize} data-reveal>
            <div className={styles.grandPrizeCopy}>
              <span className={styles.winnerBadge}>
                <Crown size={16} aria-hidden="true" />{" "}
                {t("01 / JUARA", "01 / CHAMPION")}
              </span>
              <strong className={styles.prizeNumber}>1,500</strong>
              <span className={styles.prizeCurrency}>PINK DIAMOND</span>
              <p>
                {t(
                  "Satu juara. Satu ganjaran luar biasa.",
                  "One champion. One extraordinary reward.",
                )}
              </p>
            </div>
            <div
              className={styles.prizeArt}
              aria-hidden="true"
              data-parallax="0.09"
            >
              <div className={styles.gemHalo} />
              <Gem />
              <span className={styles.prizeSpark}>✦</span>
              <span className={styles.prizeSparkTwo}>✦</span>
            </div>
            <span className={styles.prizeCorner} aria-hidden="true">
              ↗
            </span>
          </div>
          <div className={styles.rewardList}>
            {[
              [
                "02",
                t("NAIB JUARA", "RUNNER-UP"),
                "740",
                "Pink Diamond",
                Diamond,
              ],
              [
                "03",
                t("TEMPAT KETIGA", "THIRD PLACE"),
                "Battle Pass",
                "Basic",
                Trophy,
              ],
              [
                "04",
                t("TEMPAT KEEMPAT", "FOURTH PLACE"),
                "Monthly",
                "Pass",
                Crown,
              ],
              [
                "05—16",
                t("SEMUA BAKI TOP 16", "THE REST OF THE TOP 16"),
                "Weekly",
                "Pass",
                Zap,
              ],
            ].map(([rank, name, amount, unit, Icon], index) => {
              const Mark = Icon as typeof Zap;
              return (
                <div className={styles.rewardRow} key={index} data-reveal>
                  <span className={styles.rewardRank}>{rank as string}</span>
                  <span className={styles.rewardPlace}>{name as string}</span>
                  <Mark size={21} aria-hidden="true" />
                  <strong>
                    {amount as string}
                    <small>{unit as string}</small>
                  </strong>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section
        className={`${styles.chapter} ${styles.squadSection}`}
        id="skuad"
        data-chapter
        aria-labelledby="squad-title"
      >
        <div className={styles.container}>
          <ChapterLabel number="07">
            {t("TOP 4 & SKUAD UTAMA", "TOP 4 & THE MAIN SQUAD")}
          </ChapterLabel>
          <div className={styles.squadLayout}>
            <div data-reveal>
              <span className={styles.kicker}>
                {t(
                  "HADIAH CUMA PERMULAAN.",
                  "THE REWARD IS JUST THE BEGINNING.",
                )}
              </span>
              <h2 id="squad-title" className={styles.sectionTitle}>
                {t("EMPAT PEMAIN.", "FOUR PLAYERS.")}
                <br />
                {t("SATU PASUKAN.", "ONE TEAM.")}
                <br />
                <span>{t("LEGASI KITA.", "OUR LEGACY.")}</span>
              </h2>
              <p className={styles.sectionIntro}>
                {t(
                  "Top 4 Solo akan digabungkan secara automatik menjadi SATU TEAM UTAMA PAILANGZ — wakil komuniti dalam kejohanan luar dan acara rasmi akan datang.",
                  "The Solo Top 4 automatically become ONE MAIN PAILANGZ TEAM — representing our community in future external tournaments and official events.",
                )}
              </p>
            </div>
            <div className={styles.squadVisual} data-reveal aria-hidden="true">
              <div className={styles.squadRing} />
              <span className={styles.squadCaption}>THE NEXT MAIN SQUAD</span>
              <div className={styles.squadPlayers}>
                {[1, 2, 3, 4].map((number) => (
                  <div className={styles.squadPlayer} key={number}>
                    <Crosshair size={28} strokeWidth={1} />
                    <strong>0{number}</strong>
                    <span>TOP {number}</span>
                  </div>
                ))}
              </div>
              <div className={styles.squadWordmark}>
                PAILANGZ<span>UNITED BY SKILL.</span>
              </div>
            </div>
          </div>
          <div className={styles.squadCondition} data-reveal>
            <ShieldCheck size={24} aria-hidden="true" />
            <div>
              <h3>
                {t(
                  "Tanggungjawab baharu untuk Top 4.",
                  "A new responsibility for the Top 4.",
                )}
              </h3>
              <p>
                {t(
                  "Pemain Top 4 Solo dilarang menyertai kategori Team pada tournament berikutnya. Ruang itu diberi kepada ahli lain supaya semua berpeluang untuk bersaing.",
                  "Solo Top 4 players cannot enter the Team category in the next tournament. Those places give other members a fair chance to compete.",
                )}
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className={styles.finale} aria-labelledby="finale-title">
        <div
          className={styles.finaleText}
          aria-hidden="true"
          data-parallax="-0.06"
        >
          LET’S GO!
        </div>
        <div className={styles.container} data-reveal>
          <span className={styles.kicker}>PAILANGZ & PAILANGZZ</span>
          <h2 id="finale-title">
            {t("BUKAN SEKADAR", "MORE THAN")}
            <br />
            <span>{t("MENANG HADIAH.", "WINNING PRIZES.")}</span>
          </h2>
          <p>
            {t(
              "Ini peluang menjadi wakil utama PAILANGZ. Buktikan kehebatan anda, berikan komitmen penuh, dan bawa nama komuniti kita ke puncak.",
              "This is your chance to represent PAILANGZ. Prove your skill, give your full commitment, and take our community to the top.",
            )}
          </p>
          <Link className={styles.primaryButton} href="/tournaments">
            {t("Ke pusat kejohanan", "Go to the tournament hub")}{" "}
            <ArrowUpRight size={19} aria-hidden="true" />
          </Link>
          <span className={styles.finaleSignoff}>
            <Flame size={16} aria-hidden="true" /> TWO GANGS. ONE LEGACY.
          </span>
        </div>
      </section>
    </SoloExperience>
  );
}
