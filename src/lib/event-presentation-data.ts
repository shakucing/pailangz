import "server-only";
import { db, ensureRuntime } from "./db";
import {
  configuration,
  type TournamentConfiguration,
} from "./tournament-config";
import { publicTournament } from "./public-data";
import { publicPlayerNames } from "./public-player-names";
import { calculateStandings, type Rules } from "./domain";

export type EventMatch = {
  id: string;
  order: number;
  a: string | null;
  b: string | null;
  bestOf: number;
  status: string;
  scheduledAt: string | Date | null;
  result: {
    outcome: string;
    games: { number: number; scoreA: number; scoreB: number }[];
  } | null;
};
export type EventStage = {
  key: string;
  name: string;
  format: string;
  qualificationBestOf: number | null;
  qualificationCarry?: boolean | null;
  rankingsFinalized?: boolean;
  rankingsStale?: boolean;
  standings: {
    code: string;
    rank: number | null;
    played: number;
    wins: number;
    draws: number;
    losses: number;
    points: number;
  }[];
  rounds: { number: number; name: string; matches: EventMatch[] }[];
};
export type EventPresentationData = {
  name: string;
  slug: string;
  status: string;
  configuration: TournamentConfiguration;
  participants: { code: string; ign?: string }[];
  categories: {
    kind: string;
    teams: {
      code: string;
      name: string;
      playerCount: number;
      roster?: { ign: string; owner: boolean }[];
    }[];
    stages: EventStage[];
  }[];
  preview: boolean;
  testResults?: boolean;
};

async function localTestResults(data: EventPresentationData) {
  if (
    !data.preview ||
    process.env.APP_ENV !== "development" ||
    process.env.DATABASE_ENV !== "development" ||
    process.env.LOCAL_PGLITE !== "true" ||
    process.env.VERCEL
  )
    return data;

  // Only the explicitly seeded local results may augment the public draft
  // schedule. Real unpublished results retain the publication boundary.
  const results = await db.$queryRaw<
    {
      id: string;
      a: string;
      b: string;
      rules: Rules;
      confirmedRules: string[];
      result: NonNullable<EventMatch["result"]>;
    }[]
  >`
    SELECT m.id, pa.code AS a, pb.code AS b, s.rules, s."confirmedRules",
      jsonb_build_object('outcome', rv.outcome, 'games', (
        SELECT jsonb_agg(jsonb_build_object(
          'number', g.number, 'scoreA', g."scoreA", 'scoreB', g."scoreB"
        ) ORDER BY g.number) FROM "GameResult" g WHERE g."resultId" = rv.id
      )) AS result
    FROM "Match" m
    JOIN "Round" r ON r.id = m."roundId"
    JOIN "Stage" s ON s.id = r."stageId"
    JOIN "Category" c ON c.id = s."categoryId"
    JOIN "Tournament" t ON t.id = c."tournamentId"
    JOIN "ResultVersion" rv ON rv.id = m."currentResultId"
    JOIN "Participant" pa ON pa.id = m."sideAId" AND pa."tournamentId" = t.id
    JOIN "Participant" pb ON pb.id = m."sideBId" AND pb."tournamentId" = t.id
    WHERE t.slug = ${data.slug} AND c.kind = 'SOLO' AND s.key = 'league'
      AND NOT s.archived AND m.status = 'FINALIZED' AND rv.status = 'ACCEPTED'
      AND rv."submittedBy" = 'SYNTHETIC_LOCAL_SIX_ROUND_SCORES'
  `;
  if (!results.length) return data;
  const byMatch = new Map(results.map((r) => [r.id, r]));
  return {
    ...data,
    testResults: true,
    categories: data.categories.map((category) => ({
      ...category,
      stages: category.stages.map((stage) => {
        if (category.kind !== "SOLO" || stage.key !== "league") return stage;
        const stageResults = stage.rounds
          .flatMap((r) => r.matches)
          .flatMap((m) => {
            const result = byMatch.get(m.id);
            return result ? [result] : [];
          });
        if (!stageResults.length) return stage;
        return {
          ...stage,
          standings: calculateStandings(
            data.participants.map((p) => ({
              id: p.code,
              code: p.code,
              ign: p.code,
            })),
            stageResults.map((r) => ({
              a: r.a,
              b: r.b,
              status: "FINALIZED",
              outcome: r.result.outcome,
              games: r.result.games,
            })),
            stageResults[0].rules,
            stageResults[0].confirmedRules,
          ).map(({ code, rank, played, wins, draws, losses, points }) => ({
            code,
            rank,
            played,
            wins,
            draws,
            losses,
            points,
          })),
          rounds: stage.rounds.map((round) => ({
            ...round,
            matches: round.matches.map((match) => {
              const result = byMatch.get(match.id);
              return result
                ? { ...match, status: "FINALIZED", result: result.result }
                : match;
            }),
          })),
        };
      }),
    })),
  };
}

export async function eventPresentationData(
  slug?: string,
): Promise<EventPresentationData | null> {
  if (!process.env.DATABASE_URL) return null;
  await ensureRuntime();
  let data: EventPresentationData | null = null;
  if (slug) {
    const published = await publicTournament(slug);
    if (published) data = { ...published, preview: false };
  }
  if (!data) {
    const [record] = await db.$queryRaw<
      { data: Omit<EventPresentationData, "preview"> }[]
    >`
      SELECT data FROM "PublicEventPreview"
      WHERE (${slug ?? null}::text IS NULL OR data->>'slug' = ${slug ?? null})
      ORDER BY CASE WHEN data->'configuration'->>'format' = 'TEAM' THEN 1 ELSE 0 END,
        data->>'slug'
      LIMIT 1
    `;
    if (!record) return null;
    data = {
      ...record.data,
      configuration: configuration(record.data.configuration),
      preview: true,
    };
  }
  data = await localTestResults(data);
  const players = await publicPlayerNames(data.slug);
  const names = new Map(players.map((p) => [p.code, p.ign]));
  const teamMembers = data.categories.some(
    (category) => category.kind === "TEAM" && category.teams.length > 0,
  )
    ? await db.$queryRaw<{ teamCode: string; ign: string; owner: boolean }[]>`
        SELECT "teamCode", ign, owner FROM "PublicEventTeamMember"
        WHERE slug = ${data.slug} ORDER BY "teamCode", owner DESC, ign
      `
    : [];
  const label = (code: string | null) => {
    const ign = code ? names.get(code) : undefined;
    return ign ? `${code} · ${ign}` : code;
  };
  return {
    ...data,
    participants: data.participants.map((p) => ({
      code: p.code,
      ...(names.has(p.code) ? { ign: names.get(p.code) } : {}),
    })),
    categories: data.categories.map((c) =>
      c.kind !== "SOLO"
        ? {
            ...c,
            teams: c.teams.map((team) => ({
              ...team,
              roster: teamMembers
                .filter((member) => member.teamCode === team.code)
                .map(({ ign, owner }) => ({ ign, owner })),
            })),
          }
        : {
            ...c,
            stages: c.stages.map((s) => ({
              ...s,
              rounds: s.rounds.map((r) => ({
                ...r,
                matches: r.matches.map((m) => ({
                  ...m,
                  a: label(m.a),
                  b: label(m.b),
                })),
              })),
            })),
          },
    ),
  };
}

export async function landingEventPresentations(): Promise<
  EventPresentationData[]
> {
  if (!process.env.DATABASE_URL) return [];
  await ensureRuntime();
  const highlights = await db.$queryRaw<{ slug: string }[]>`
    SELECT slug FROM "PublicLandingHighlight" ORDER BY format ASC
  `;
  const events = await Promise.all(
    highlights.map(({ slug }) => eventPresentationData(slug)),
  );
  return events.filter((event): event is EventPresentationData => !!event);
}
