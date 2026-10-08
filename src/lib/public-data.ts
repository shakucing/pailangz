import "server-only";
import { configuration } from "./tournament-config";
import { getLocale } from "./i18n";
import { db, ensureRuntime } from "./db";
import {
  calculateStandings,
  rankStandings,
  stageRankingRules,
  type Standing,
  type Rules,
} from "./domain";
export async function publishedTournaments() {
  if (!process.env.DATABASE_URL) return [];
  await ensureRuntime();
  const locale = await getLocale();
  const records = await db.tournament.findMany({
    where: { published: true, status: { notIn: ["DRAFT", "ARCHIVED"] } },
    select: {
      slug: true,
      name: true,
      overview: true,
      overviewEn: true,
      startsAt: true,
      status: true,
      configuration: true,
      categories: { select: { kind: true, capacity: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  return records.map(({ overviewEn, ...r }) => ({
    ...r,
    configuration: configuration(r.configuration),
    overview: locale === "en" && overviewEn ? overviewEn : r.overview,
  }));
}
export async function publishedAnnouncements() {
  if (!process.env.DATABASE_URL) return [];
  await ensureRuntime();
  const locale = await getLocale();
  const records = await db.announcement.findMany({
    where: { published: true, archived: false },
    select: { id: true, title: true, body: true, titleEn: true, bodyEn: true },
    orderBy: { createdAt: "desc" },
  });
  return records.map(({ titleEn, bodyEn, ...r }) => ({
    ...r,
    title: locale === "en" && titleEn ? titleEn : r.title,
    body: locale === "en" && bodyEn ? bodyEn : r.body,
  }));
}
export async function publicTournament(slug: string) {
  if (!process.env.DATABASE_URL) return null;
  await ensureRuntime();
  const t = await db.tournament.findFirst({
    where: { slug, published: true, status: { notIn: ["DRAFT", "ARCHIVED"] } },
    select: {
      name: true,
      slug: true,
      overview: true,
      overviewEn: true,
      startsAt: true,
      status: true,
      gameTitle: true,
      configuration: true,
      participants: {
        where: {
          withdrawn: false,
          eligible: true,
          member: { verified: true, archived: false },
        },
        select: {
          id: true,
          code: true,
        },
      },
      categories: {
        select: {
          kind: true,
          teams: {
            where: { archived: false },
            orderBy: { code: "asc" },
            select: {
              id: true,
              code: true,
              name: true,
              _count: {
                select: { memberships: { where: { active: true } } },
              },
            },
          },
          stages: {
            where: { published: true, archived: false },
            select: {
              id: true,
              key: true,
              name: true,
              format: true,
              rules: true,
              confirmedRules: true,
              rounds: {
                orderBy: { number: "asc" },
                select: {
                  number: true,
                  name: true,
                  matches: {
                    orderBy: { order: "asc" },
                    select: {
                      id: true,
                      order: true,
                      sideAId: true,
                      sideBId: true,
                      sideKind: true,
                      bestOf: true,
                      status: true,
                      scheduledAt: true,
                      currentResult: {
                        select: {
                          outcome: true,
                          status: true,
                          games: {
                            orderBy: { number: "asc" },
                            select: {
                              number: true,
                              scoreA: true,
                              scoreB: true,
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  });
  if (!t) return null;
  const snapshots = await db.$queryRaw<
    { stageId: string; stale: boolean; rankings: Standing[] }[]
  >`SELECT "stageId",stale,rankings FROM "PublicRanking" WHERE "stageId" IN (SELECT s.id FROM "Stage" s JOIN "Category" c ON c.id=s."categoryId" JOIN "Tournament" t ON t.id=c."tournamentId" WHERE t.slug=${slug})`;
  const standings = new Map<string, Standing[]>();
  for (const category of t.categories)
    for (const stage of category.stages) {
      if (stage.format !== "LEAGUE") continue;
      const policy = stageRankingRules(
        stage.key,
        stage.rules as Rules,
        stage.confirmedRules,
      );
      const baseStage = category.stages.find((s) => s.key === "league");
      const base = snapshots.find((s) => s.stageId === baseStage?.id);
      const qualifierIds = new Set(
        stage.rounds.flatMap((r) =>
          r.matches.flatMap((m) => [m.sideAId, m.sideBId]),
        ),
      );
      const players = t.participants.filter(
        (p) => stage.key !== "qualification" || qualifierIds.has(p.id),
      );
      let rows = calculateStandings(
        players.map((p) => ({
          id: p.id,
          code: p.code,
          ign: p.code,
        })),
        stage.rounds
          .flatMap((r) => r.matches)
          .map((m) => ({
            a: m.sideAId,
            b: m.sideBId,
            status: m.status,
            outcome:
              m.currentResult?.status === "ACCEPTED"
                ? m.currentResult.outcome
                : undefined,
            games: m.currentResult?.games ?? [],
          })),
        policy.rules,
        policy.confirmed,
      );
      if (
        stage.key === "qualification" &&
        (stage.rules as Rules).qualificationCarry
      )
        rows = rankStandings(
          rows.map((r) => ({
            ...r,
            points:
              r.points +
              (base?.rankings.find((b) => b.id === r.id)?.points ?? 0),
          })),
          policy.rules,
          policy.confirmed,
        );
      const frozen = snapshots.find((s) => s.stageId === stage.id);
      if (frozen && !frozen.stale)
        rows = rows
          .map((r) => ({
            ...r,
            rank: frozen.rankings.find((b) => b.id === r.id)?.rank ?? r.rank,
            tied: false,
          }))
          .sort((a, b) => (a.rank ?? 1000) - (b.rank ?? 1000));
      standings.set(stage.id, rows);
    }
  const names = new Map(t.participants.map((p) => [p.id, p.code]));
  for (const c of t.categories)
    for (const team of c.teams)
      names.set(team.id, `${team.code} · ${team.name}`);
  const locale = await getLocale();
  return {
    name: t.name,
    slug: t.slug,
    overview: locale === "en" && t.overviewEn ? t.overviewEn : t.overview,
    startsAt: t.startsAt,
    status: t.status,
    gameTitle: t.gameTitle,
    configuration: configuration(t.configuration),
    participants: t.participants.map((p) => ({
      code: p.code,
    })),
    categories: t.categories.map((c) => ({
      kind: c.kind,
      teams: c.teams.map((team) => ({
        code: team.code,
        name: team.name,
        playerCount: team._count.memberships,
      })),
      stages: c.stages.map((s) => ({
        name: s.name,
        key: s.key,
        format: s.format,
        rankingsFinalized: snapshots.some(
          (r) => r.stageId === s.id && !r.stale,
        ),
        qualificationBestOf:
          s.key === "qualification" &&
          s.confirmedRules.includes("qualificationBestOf")
            ? ((s.rules as Rules).qualificationBestOf ?? null)
            : null,
        rankingsStale: snapshots.some(
          (r) =>
            r.stale &&
            (r.stageId === s.id ||
              (s.key === "qualification" &&
                c.stages.some(
                  (base) => base.key === "league" && base.id === r.stageId,
                ))),
        ),
        standings: (standings.get(s.id) ?? []).map(
          ({ id, ign, ...row }) => row,
        ),
        rounds: s.rounds.map((r) => ({
          name: r.name,
          number: r.number,
          matches: r.matches.map((m) => ({
            id: m.id,
            order: m.order,
            a:
              names.get(m.sideAId ?? "") ??
              (locale === "en" ? "Awaiting entrant" : "Menunggu peserta"),
            b:
              m.status === "BYE"
                ? "BYE"
                : (names.get(m.sideBId ?? "") ??
                  (locale === "en" ? "Awaiting entrant" : "Menunggu peserta")),
            bestOf: m.bestOf,
            status: m.status,
            scheduledAt: m.scheduledAt,
            result:
              m.status === "FINALIZED" && m.currentResult?.status === "ACCEPTED"
                ? {
                    outcome: m.currentResult.outcome,
                    games: m.currentResult.games,
                  }
                : null,
          })),
        })),
      })),
    })),
  };
}
export function dateText(value: Date | null, locale: "ms" | "en" = "ms") {
  return value
    ? new Intl.DateTimeFormat(locale === "en" ? "en-MY" : "ms-MY", {
        timeZone: "Asia/Kuala_Lumpur",
        dateStyle: "long",
      }).format(value)
    : locale === "en"
      ? "Dates to be announced."
      : "Tarikh akan diumumkan.";
}
export function operationalTime(value: Date) {
  return new Intl.DateTimeFormat("en-MY", {
    timeZone: "Asia/Kuala_Lumpur",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(value);
}
