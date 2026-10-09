import { z } from "zod";

export const MAX_BEST_OF = 99;
export const BEST_OF_HELP = "Enter an odd number from 1 to 99, e.g. 3, 5 or 7.";
export function isValidBestOf(value: number) {
  return (
    Number.isInteger(value) &&
    value >= 1 &&
    value <= MAX_BEST_OF &&
    value % 2 === 1
  );
}
export const bestOfSchema = z.number().refine(isValidBestOf, BEST_OF_HELP);
export const defaultSeriesLengths = {
  leagueBestOf: 3,
  soloKnockoutBestOf: 5,
  soloFinalBestOf: 5,
  teamKnockoutBestOf: 3,
  teamFinalBestOf: 5,
} as const;
