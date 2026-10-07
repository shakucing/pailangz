import { DomainError } from "./domain";
export function validateFixtures(players: string[], rounds: string[][]) {
  if (
    players.length !== 64 ||
    new Set(players).size !== 64 ||
    rounds.length !== 6
  )
    throw new DomainError("Expected 64 distinct players and six rounds.");
  const seen = new Set<string>(),
    totals = new Map(players.map((_, i) => [i + 1, 0]));
  let count = 0;
  for (const round of rounds) {
    if (round.length !== 32)
      throw new DomainError("Expected 32 matches per round.");
    const appeared = new Set<number>();
    for (const token of round) {
      if (!/^\d{2}-\d{2}$/.test(token))
        throw new DomainError("Malformed fixture token.");
      const [a, b] = token.split("-").map(Number);
      if (
        a === b ||
        !totals.has(a) ||
        !totals.has(b) ||
        appeared.has(a) ||
        appeared.has(b)
      )
        throw new DomainError("Invalid player appearance.");
      const key = [a, b].sort((x, y) => x - y).join("-");
      if (seen.has(key)) throw new DomainError("Repeated opponents.");
      seen.add(key);
      appeared.add(a);
      appeared.add(b);
      totals.set(a, totals.get(a)! + 1);
      totals.set(b, totals.get(b)! + 1);
      count++;
    }
    if (appeared.size !== 64)
      throw new DomainError("Every player must play once each round.");
  }
  if (count !== 192 || [...totals.values()].some((n) => n !== 6))
    throw new DomainError("Expected 192 matches and six per player.");
  return { players: 64, rounds: 6, matches: 192 };
}
