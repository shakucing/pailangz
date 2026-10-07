import { caseFold } from "unicode-case-folding";
import { z } from "zod";

export class DomainError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export const ignSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .refine(
    (v) => !/[\p{Cc}\p{Cf}]/u.test(v),
    "IGN contains invisible control characters",
  );
export function canonicalIgn(value: string) {
  return caseFold(ignSchema.parse(value).normalize("NFC")).normalize("NFC");
}
export const gameSchema = z.object({
  scoreA: z.number().int().min(0).max(100000),
  scoreB: z.number().int().min(0).max(100000),
});
export const resultSchema = z.object({
  matchId: z.string().uuid(),
  outcome: z.enum(["A_WIN", "B_WIN", "DRAW", "A_FORFEIT", "B_FORFEIT"]),
  games: z.array(gameSchema).max(5),
  reason: z.string().trim().min(3).max(1000),
  idempotencyKey: z.string().uuid(),
});
export type Outcome = z.infer<typeof resultSchema>["outcome"];
export type Rules = {
  byePolicy?: string;
  seriesPoints?: boolean;
  drawPolicy?: string;
  tiebreakers?: string[];
  qualificationBestOf?: number;
  qualificationCarry?: boolean;
  qualificationPairing?: string;
  qualificationTiebreakers?: string[];
  knockoutPairing?: string;
  teamSeeding?: string;
  specialOutcomes?: string;
  evidenceDeadline?: string;
  disputeDeadline?: string;
};
export const RULE_LABELS: Record<string, string> = {
  dates: "Dates and registration deadline",
  gameTitle: "Game title",
  drawPolicy: "Draw rules",
  seriesPoints: "Points for each match",
  tiebreakers: "League tiebreakers",
  qualificationBestOf: "Qualification series length",
  qualificationCarry: "Starting points for playoffs",
  qualificationPairing: "Qualification pairings",
  qualificationTiebreakers: "Qualification tiebreakers",
  knockoutPairing: "SOLO knockout opponents and starting order",
  teamSeeding: "Team lineups and starting order",
  specialOutcomes: "No-shows, forfeits, withdrawals and disconnections",
  evidenceDeadline: "Evidence deadline",
  disputeDeadline: "Dispute deadline",
};
export function validateSeries(
  bestOf: number,
  games: { scoreA: number; scoreB: number }[],
  outcome: string,
  rules: Rules,
  confirmed: string[],
) {
  if (!confirmed.includes("drawPolicy") || !confirmed.includes("seriesPoints"))
    throw new DomainError(
      "Confirm draw policy and series-level scoring first.",
    );
  if (![3, 5].includes(bestOf))
    throw new DomainError("A confirmed BO3 or BO5 series is required.");
  const needed = Math.floor(bestOf / 2) + 1;
  let a = 0,
    b = 0;
  for (const game of games) {
    gameSchema.parse(game);
    if (a >= needed || b >= needed)
      throw new DomainError(
        "Games cannot continue after the series has been won.",
      );
    if (game.scoreA === game.scoreB)
      throw new DomainError("Individual game draws are not configured.");
    if (game.scoreA > game.scoreB) a++;
    else b++;
  }
  if (outcome.includes("FORFEIT")) {
    if (
      !confirmed.includes("specialOutcomes") ||
      rules.specialOutcomes !== "forfeit"
    )
      throw new DomainError("Forfeits require a confirmed rule and reason.");
  } else if (outcome === "DRAW") {
    if (rules.drawPolicy !== "moderated_draw" || a >= needed || b >= needed)
      throw new DomainError(
        "A draw requires the confirmed moderated-draw policy.",
      );
  } else if (
    games.length > bestOf ||
    (outcome === "A_WIN"
      ? a !== needed || b >= needed
      : b !== needed || a >= needed)
  )
    throw new DomainError(
      `A completed BO${bestOf} requires ${needed} wins for the proposed winner.`,
    );
  return { a, b };
}
export type Standing = {
  id: string;
  code: string;
  ign: string;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  points: number;
  gameWins: number;
  gameLosses: number;
  differential: number;
  rank: number | null;
  tied: boolean;
};
export function calculateStandings(
  players: { id: string; code: string; ign: string }[],
  matches: {
    a: string | null;
    b: string | null;
    status: string;
    outcome?: string;
    games: { scoreA: number; scoreB: number }[];
  }[],
  rules: Rules,
  confirmed: string[],
) {
  const rows = new Map(
    players.map((p) => [
      p.id,
      {
        ...p,
        played: 0,
        wins: 0,
        draws: 0,
        losses: 0,
        points: 0,
        gameWins: 0,
        gameLosses: 0,
        differential: 0,
        rank: null,
        tied: false,
      } as Standing,
    ]),
  );
  for (const m of matches) {
    if (m.status !== "FINALIZED" || !m.outcome || !m.a || !m.b) continue;
    const a = rows.get(m.a),
      b = rows.get(m.b);
    if (!a || !b) continue;
    a.played++;
    b.played++;
    const aw = m.outcome === "A_WIN" || m.outcome === "B_FORFEIT",
      bw = m.outcome === "B_WIN" || m.outcome === "A_FORFEIT";
    if (aw) {
      a.wins++;
      b.losses++;
      a.points += 3;
    } else if (bw) {
      b.wins++;
      a.losses++;
      b.points += 3;
    } else {
      a.draws++;
      b.draws++;
      a.points++;
      b.points++;
    }
    for (const g of m.games) {
      if (g.scoreA > g.scoreB) {
        a.gameWins++;
        b.gameLosses++;
      } else if (g.scoreB > g.scoreA) {
        b.gameWins++;
        a.gameLosses++;
      }
    }
  }
  return rankStandings([...rows.values()], rules, confirmed);
}
export function compareStandings(
  a: Standing,
  b: Standing,
  rules: Rules,
  confirmed: string[],
) {
  const criteria = confirmed.includes("tiebreakers")
    ? (rules.tiebreakers ?? [])
    : [];
  const value = (r: Standing, key: string) =>
    key === "differential"
      ? r.gameWins - r.gameLosses
      : key === "wins"
        ? r.wins
        : key === "gameWins"
          ? r.gameWins
          : 0;
  return (
    b.points - a.points ||
    criteria.reduce((n, k) => n || value(b, k) - value(a, k), 0)
  );
}
export function rankStandings(
  rows: Standing[],
  rules: Rules,
  confirmed: string[],
) {
  const compare = (a: Standing, b: Standing) =>
    compareStandings(a, b, rules, confirmed);
  const sorted = rows
    .map((r) => ({ ...r, differential: r.gameWins - r.gameLosses }))
    .sort(compare);
  sorted.forEach((r, i) => {
    r.tied = !!(
      (i > 0 && compare(sorted[i - 1], r) === 0) ||
      (i + 1 < sorted.length && compare(r, sorted[i + 1]) === 0)
    );
    r.rank = r.tied ? null : i + 1;
  });
  return sorted;
}
export function stageRankingRules(
  key: string,
  rules: Rules,
  confirmed: string[],
) {
  return key === "qualification"
    ? {
        rules: { ...rules, tiebreakers: rules.qualificationTiebreakers },
        confirmed: confirmed
          .filter((k) => k !== "tiebreakers")
          .concat(
            confirmed.includes("qualificationTiebreakers")
              ? ["tiebreakers"]
              : [],
          ),
      }
    : { rules, confirmed };
}

const transitions: Record<string, string[]> = {
  DRAFT: ["REGISTRATION_OPEN", "ARCHIVED"],
  REGISTRATION_OPEN: ["REGISTRATION_CLOSED", "ARCHIVED"],
  REGISTRATION_CLOSED: ["IN_PROGRESS", "ARCHIVED"],
  IN_PROGRESS: ["COMPLETED", "ARCHIVED"],
  COMPLETED: ["ARCHIVED"],
  ARCHIVED: [],
};
export function assertTransition(from: string, to: string) {
  if (from !== to && !transitions[from]?.includes(to))
    throw new DomainError(`Cannot transition ${from} to ${to}.`);
}
export function canAccess(
  role: string,
  suspended: boolean,
  authenticated: boolean,
  required: "STAFF" | "ADMIN" = "STAFF",
) {
  return (
    !suspended &&
    authenticated &&
    (role === "ADMIN" || (required === "STAFF" && role === "MODERATOR"))
  );
}
export function requireReason(reason: unknown) {
  return z.string().trim().min(3).max(1000).parse(reason);
}
export function readiness(
  t: {
    startsAt: Date | null;
    registrationDeadline: Date | null;
    gameTitle: string | null;
    mappingConfirmed: boolean;
  },
  stages: { confirmedRules: string[] }[],
  eligible: number,
  teams: number,
  targets: { soloCapacity: number; teamCapacity: number },
) {
  const confirmed = new Set(stages.flatMap((s) => s.confirmedRules));
  return Object.entries(RULE_LABELS)
    .map(([key, label]) => ({
      key,
      label,
      done:
        key === "dates"
          ? !!t.startsAt && !!t.registrationDeadline
          : key === "gameTitle"
            ? !!t.gameTitle
            : confirmed.has(key),
    }))
    .concat([
      {
        key: "mapping",
        label: "Player list confirmed",
        done: t.mappingConfirmed,
      },
      {
        key: "eligibility",
        label: `${targets.soloCapacity} approved and eligible SOLO players`,
        done: eligible === targets.soloCapacity,
      },
      {
        key: "teams",
        label: `${targets.teamCapacity} teams with four eligible players each`,
        done: teams === targets.teamCapacity,
      },
    ]);
}
