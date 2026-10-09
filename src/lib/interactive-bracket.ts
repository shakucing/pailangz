import {
  seededBracketPairs,
  knockoutBestOf,
  type TournamentConfiguration,
} from "./tournament-config";
import type { EventMatch } from "./event-presentation-data";

export type BracketEntrant = { id: string; label: string; seed?: number };
export type BracketMatch = {
  id: string;
  order: number;
  a: BracketEntrant | null;
  b: BracketEntrant | null;
  bestOf: number;
  status: string;
  result: EventMatch["result"];
};
export type BracketRound = {
  number: number;
  size: number;
  matches: BracketMatch[];
};
export type BracketPicks = Record<string, string>;
export type ResolvedBracketMatch = BracketMatch & {
  winner: BracketEntrant | null;
};
export type ResolvedBracketRound = Omit<BracketRound, "matches"> & {
  matches: ResolvedBracketMatch[];
};

export function bracketMatchLabel(size: number, order: number) {
  return size === 2
    ? "FINAL"
    : size === 4
      ? `SF${order}`
      : size === 8
        ? `QF${order}`
        : `BO${size}-${order}`;
}

export function previewBracket(
  config: TournamentConfiguration,
  category: "SOLO" | "TEAM",
): BracketRound[] {
  const size =
    category === "TEAM" ? config.teamBracketSize : config.soloBracketSize;
  const capacity =
    category === "TEAM"
      ? config.teamCapacity
      : config.directSlots + config.playoffSlots;
  const pairs = seededBracketPairs(
    Array.from({ length: capacity }, (_, i) => String(i + 1)),
    size,
    config.bracketByePolicy,
  );
  const entrant = (value: string | null): BracketEntrant | null =>
    value ? { id: `seed-${value}`, label: value, seed: Number(value) } : null;
  const rounds: BracketRound[] = [];
  for (let n = size; n >= 2; n /= 2) {
    rounds.push({
      number: rounds.length + 1,
      size: n,
      matches: Array.from({ length: n / 2 }, (_, i) => {
        const pair = n === size ? pairs[i] : null;
        return {
          id: `${category}-${n}-${i + 1}`,
          order: i + 1,
          a: entrant(pair?.a ?? null),
          b: entrant(pair?.b ?? null),
          bestOf: knockoutBestOf(config, category, n === 2),
          status: pair && pair.b === null ? "BYE" : "SCHEDULED",
          result: null,
        };
      }),
    });
  }
  return rounds;
}

export function officialBracket(
  rounds: { number: number; matches: EventMatch[] }[],
): BracketRound[] {
  const entrant = (value: string | null): BracketEntrant | null =>
    !value ||
    [
      "BYE",
      "Awaiting entrant",
      "Awaiting participant",
      "Menunggu peserta",
    ].includes(value)
      ? null
      : { id: value, label: value };
  return [...rounds]
    .sort((a, b) => a.number - b.number)
    .map((round) => ({
      number: round.number,
      size: round.matches.length * 2,
      matches: [...round.matches]
        .sort((a, b) => a.order - b.order)
        .map((match) => ({
          ...match,
          a: entrant(match.a),
          b: entrant(match.b),
        })),
    }));
}

export function resolveBracket(
  rounds: BracketRound[],
  picks: BracketPicks,
  mode: "official" | "picks",
): ResolvedBracketRound[] {
  const resolved: ResolvedBracketRound[] = [];
  for (const [index, round] of rounds.entries()) {
    const previous = resolved[index - 1];
    resolved.push({
      ...round,
      matches: round.matches.map((match) => {
        const a =
          mode === "picks" && previous
            ? (previous.matches.find((m) => m.order === match.order * 2 - 1)
                ?.winner ?? null)
            : match.a;
        const b =
          mode === "picks" && previous
            ? (previous.matches.find((m) => m.order === match.order * 2)
                ?.winner ?? null)
            : match.b;
        let winner: BracketEntrant | null = null;
        if (match.status === "BYE" && a && !b) winner = a;
        else if (mode === "picks" && a && b)
          winner = [a, b].find((side) => side.id === picks[match.id]) ?? null;
        else if (
          mode === "official" &&
          match.status === "FINALIZED" &&
          a &&
          b
        ) {
          if (["A_WIN", "B_FORFEIT"].includes(match.result?.outcome ?? ""))
            winner = a;
          else if (["B_WIN", "A_FORFEIT"].includes(match.result?.outcome ?? ""))
            winner = b;
        }
        return { ...match, a, b, winner };
      }),
    });
  }
  return resolved;
}

export function selectBracketWinner(
  rounds: BracketRound[],
  picks: BracketPicks,
  matchId: string,
  entrantId: string,
): BracketPicks {
  const resolved = resolveBracket(rounds, picks, "picks");
  const index = resolved.findIndex((round) =>
    round.matches.some((match) => match.id === matchId),
  );
  const match = resolved[index]?.matches.find((entry) => entry.id === matchId);
  if (!match?.a || !match.b || ![match.a.id, match.b.id].includes(entrantId))
    return picks;
  const next = { ...picks };
  if (next[matchId] === entrantId) delete next[matchId];
  else next[matchId] = entrantId;
  let order = match.order;
  for (const round of rounds.slice(index + 1)) {
    order = Math.ceil(order / 2);
    const descendant = round.matches.find((entry) => entry.order === order);
    if (descendant) delete next[descendant.id];
  }
  return next;
}

export function bracketPlacings(rounds: ResolvedBracketRound[]) {
  const last = rounds.at(-1);
  const final = last?.size === 2 ? last.matches[0] : null;
  const champion = final?.winner ?? null;
  const runnerUp =
    champion && final?.a && final.b
      ? champion.id === final.a.id
        ? final.b
        : final.a
      : null;
  return { champion, runnerUp };
}
