import {
  seededBracketPairs,
  knockoutBestOf,
  thirdPlaceBestOf,
  THIRD_PLACE_ROUND,
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
  thirdPlace?: boolean;
  matches: BracketMatch[];
};
export type BracketPicks = Record<string, string>;
export type ResolvedBracketMatch = BracketMatch & {
  winner: BracketEntrant | null;
};
export type ResolvedBracketRound = Omit<BracketRound, "matches"> & {
  matches: ResolvedBracketMatch[];
};

export function bracketMatchLabel(
  size: number,
  order: number,
  thirdPlace = false,
) {
  return thirdPlace
    ? "3RD PLACE"
    : size === 2
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
  if (capacity >= 4)
    rounds.push({
      number: rounds.length + 1,
      size: 2,
      thirdPlace: true,
      matches: [
        {
          id: `${category}-third-place`,
          order: 1,
          a: null,
          b: null,
          bestOf: thirdPlaceBestOf(config, category),
          status: "SCHEDULED",
          result: null,
        },
      ],
    });
  return rounds;
}

export function officialBracket(
  rounds: { number: number; name?: string; matches: EventMatch[] }[],
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
      ...(round.name === THIRD_PLACE_ROUND ? { thirdPlace: true } : {}),
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
    const previous = round.thirdPlace
      ? resolved.find((r) => r.size === 4 && !r.thirdPlace)
      : resolved[index - 1];
    const advancing = (order: number) => {
      const source = previous?.matches.find((m) => m.order === order);
      return round.thirdPlace ? bracketLoser(source) : (source?.winner ?? null);
    };
    resolved.push({
      ...round,
      matches: round.matches.map((match) => {
        const a =
          mode === "picks" && previous
            ? advancing(match.order * 2 - 1)
            : match.a;
        const b =
          mode === "picks" && previous ? advancing(match.order * 2) : match.b;
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
    if (round.thirdPlace) {
      // Only changes before or during the semifinals affect the bronze match.
      if (rounds[index].size >= 4)
        for (const match of round.matches) delete next[match.id];
      continue;
    }
    order = Math.ceil(order / 2);
    const descendant = round.matches.find((entry) => entry.order === order);
    if (descendant) delete next[descendant.id];
  }
  return next;
}

export function bracketPlacings(rounds: ResolvedBracketRound[]) {
  const final = rounds.find((r) => r.size === 2 && !r.thirdPlace)?.matches[0];
  const playoff = rounds.find((r) => r.thirdPlace)?.matches[0];
  const champion = final?.winner ?? null;
  const runnerUp =
    champion && final?.a && final.b
      ? champion.id === final.a.id
        ? final.b
        : final.a
      : null;
  return {
    champion,
    runnerUp,
    third: playoff?.winner ?? null,
    fourth: bracketLoser(playoff),
  };
}

function bracketLoser(match?: ResolvedBracketMatch) {
  return match?.winner && match.a && match.b
    ? match.winner.id === match.a.id
      ? match.b
      : match.a
    : null;
}
