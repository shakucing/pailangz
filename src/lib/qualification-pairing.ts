import { DomainError } from "./domain";

export function generateQualificationPairs(
  rankedIds: string[],
  matchesPerPlayer: number,
): string[][] {
  const size = rankedIds.length;
  if (
    size < 2 ||
    new Set(rankedIds).size !== size ||
    !Number.isInteger(matchesPerPlayer) ||
    matchesPerPlayer < 1 ||
    matchesPerPlayer >= size ||
    (size * matchesPerPlayer) % 2
  )
    throw new DomainError(
      "Auto assignment requires distinct playoff entrants and a possible equal number of matches per player.",
    );

  const pairs: string[][] = [];
  if (size % 2 === 0) {
    const ring = [...rankedIds];
    for (let round = 0; round < matchesPerPlayer; round++) {
      for (let i = 0; i < size / 2; i++)
        pairs.push([ring[i], ring[size - 1 - i]]);
      ring.splice(1, 0, ring.pop()!);
    }
  } else {
    // An odd-sized pool needs an even match quota. Each distance adds
    // two distinct opponents per entrant, without requiring a full cycle.
    for (let distance = 1; distance <= matchesPerPlayer / 2; distance++)
      for (let i = 0; i < size; i++)
        pairs.push([rankedIds[i], rankedIds[(i + distance) % size]]);
  }
  return pairs;
}
