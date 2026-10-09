import { Prisma } from "@/generated/prisma/client";
import type { Tx } from "./db";

type ParticipationEntry = {
  id: string;
  tournamentId: string;
  tournamentName: string;
  tournamentPublished: boolean;
  format: "SOLO" | "TEAM" | null;
  memberId: string;
  receivedAt: Date | null;
};

export async function staffParticipation(
  tx: Tx,
  { search, page }: { search?: string; page: number },
) {
  // A draft assignment is participation even when no player signup was sent.
  // Keep signup metadata when both records exist for the same player/event.
  const entries = Prisma.sql`
    WITH entries AS (
      SELECT r.id, r."tournamentId", r."memberId", r."createdAt" AS "receivedAt"
      FROM "ParticipationRequest" r
      UNION ALL
      SELECT p.id, p."tournamentId", p."memberId", NULL::timestamptz AS "receivedAt"
      FROM "Participant" p
      WHERE NOT EXISTS (
        SELECT 1 FROM "ParticipationRequest" r
        WHERE r."tournamentId"=p."tournamentId" AND r."memberId"=p."memberId"
      )
    )
  `;
  const from = Prisma.sql`
    FROM entries e
    JOIN "Member" m ON m.id=e."memberId"
    JOIN "Tournament" t ON t.id=e."tournamentId"
    ${search ? Prisma.sql`WHERE position(lower(${search}) in lower(m."displayIgn")) > 0` : Prisma.empty}
  `;
  const [rows, counts] = await Promise.all([
    tx.$queryRaw<ParticipationEntry[]>(Prisma.sql`
      ${entries}
      SELECT e.*, t.name AS "tournamentName", t.published AS "tournamentPublished", t.configuration->>'format' AS format
      ${from}
      ORDER BY COALESCE(e."receivedAt",t."createdAt") DESC, t.id DESC, m."displayIgn" ASC, e.id DESC
      LIMIT 50 OFFSET ${(page - 1) * 50}
    `),
    tx.$queryRaw<{ total: number }[]>(Prisma.sql`
      ${entries} SELECT count(*)::int AS total ${from}
    `),
  ]);
  const tournamentIds = [...new Set(rows.map((row) => row.tournamentId))];
  const members = await tx.member.findMany({
    where: { id: { in: rows.map((row) => row.memberId) } },
    select: {
      id: true,
      displayIgn: true,
      verified: true,
      archived: true,
      participants: {
        where: { tournamentId: { in: tournamentIds } },
        select: {
          id: true,
          tournamentId: true,
          code: true,
          eligible: true,
          withdrawn: true,
        },
      },
      memberships: {
        where: {
          active: true,
          team: { archived: false },
          category: { tournamentId: { in: tournamentIds } },
        },
        select: {
          category: { select: { tournamentId: true } },
          team: { select: { name: true } },
        },
      },
    },
  });
  const byId = new Map(members.map((member) => [member.id, member]));
  return {
    rows: rows.map((row) => ({ ...row, member: byId.get(row.memberId)! })),
    total: counts[0]?.total ?? 0,
  };
}
