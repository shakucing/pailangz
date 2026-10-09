import { db, ensureRuntime } from "./db";

export type ParticipationStatus = "OPEN" | "FULL" | "CLOSED";

export async function participationStatus(
  slug = "pailangz-solo-team",
): Promise<ParticipationStatus> {
  if (!process.env.DATABASE_URL) return "CLOSED";
  await ensureRuntime();
  const [row] = await db.$queryRaw<{ status: ParticipationStatus }[]>`
    SELECT app_participation_status(${slug}) AS status
  `;
  return row?.status ?? "CLOSED";
}

export type RegistrationEvent = {
  slug: string;
  name: string;
  overview: string;
  overviewEn: string | null;
  gameTitle: string | null;
  startsAt: Date | null;
  registrationDeadline: Date | null;
  capacity: number;
  format: "SOLO" | "TEAM" | null;
  teamRosterManagement: "PLAYER" | "STAFF";
};
export async function registrationEvent(slug: string) {
  if (!process.env.DATABASE_URL) return null;
  await ensureRuntime();
  const [event] = await db.$queryRaw<RegistrationEvent[]>`
    SELECT * FROM "PublicTournamentRegistration" WHERE slug=${slug}
  `;
  return event ?? null;
}
