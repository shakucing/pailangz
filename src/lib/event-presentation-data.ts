import "server-only";
import { db, ensureRuntime } from "./db";
import {
  configuration,
  type TournamentConfiguration,
} from "./tournament-config";
import { publicTournament } from "./public-data";

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
    teams: { code: string; name: string; playerCount: number }[];
    stages: EventStage[];
  }[];
  preview: boolean;
};

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
      SELECT data FROM "PublicEventPreview" LIMIT 1
    `;
    if (!record) return null;
    data = {
      ...record.data,
      configuration: configuration(record.data.configuration),
      preview: true,
    };
  }
  const players = await db.$queryRaw<{ code: string; ign: string }[]>`
    SELECT code, ign FROM "PublicEventPlayerName" WHERE slug = ${data.slug}
  `;
  const names = new Map(players.map((p) => [p.code, p.ign]));
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
        ? c
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
