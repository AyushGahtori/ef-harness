import { countTokens } from "../text.js";
import type { WorkerLevel } from "../types.js";

/**
 * Task 088 ceilings used by pull-to-push.
 * Promotion refuses a MUST placement above the target ceiling (Junior 3,000 / Senior 6,000),
 * which is inside the hard ceilings (3,200 / 6,400).
 */
export const JUNIOR_MUST_CEILING = 3_000;
export const SENIOR_MUST_CEILING = 6_000;
export const JUNIOR_MUST_HARD_CEILING = 3_200;
export const SENIOR_MUST_HARD_CEILING = 6_400;

export function mustCeiling(level: WorkerLevel): number {
  return level === "senior" ? SENIOR_MUST_CEILING : JUNIOR_MUST_CEILING;
}

export function mustFits(level: WorkerLevel, currentMustTokens: number, addedTokens: number): boolean {
  return currentMustTokens + addedTokens <= mustCeiling(level);
}

export function estimateTokens(title: string, prose: string): number {
  return countTokens(`${title} ${prose}`);
}
