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
  participants: { code: string }[];
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
  if (slug) {
    const published = await publicTournament(slug);
    if (published) return { ...published, preview: false };
  }
  const [record] = await db.$queryRaw<
    { data: Omit<EventPresentationData, "preview"> }[]
  >`
    SELECT data FROM "PublicEventPreview" LIMIT 1
  `;
  return record
    ? {
        ...record.data,
        configuration: configuration(record.data.configuration),
        preview: true,
      }
    : null;
}
