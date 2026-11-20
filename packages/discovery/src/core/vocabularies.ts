/**
 * Local port for Task 010 `SETTLED_BASES` and `CRITERION_STATUSES`.
 * `@ef-harness/shared-contracts` does not export these tuples on this base.
 * Swap this module for the shared-contracts barrel once that wiring lands.
 */

export const SETTLED_BASES = [
  "explicit",
  "derived",
  "delegated",
  "defaulted",
  "proposed",
  "observed",
] as const;

export const CRITERION_STATUSES = [
  "open",
  "partial",
  "missing",
  "conflict",
  "asked",
  "deferred",
  "not_applicable",
  "settled",
] as const;

export type SettledBasis = (typeof SETTLED_BASES)[number];
export type CriterionStatus = (typeof CRITERION_STATUSES)[number];

const SETTLED_BASIS_SET: ReadonlySet<string> = new Set(SETTLED_BASES);
const CRITERION_STATUS_SET: ReadonlySet<string> = new Set(CRITERION_STATUSES);

export function isSettledBasis(value: unknown): value is SettledBasis {
  return typeof value === "string" && SETTLED_BASIS_SET.has(value);
}

export function isCriterionStatus(value: unknown): value is CriterionStatus {
  return typeof value === "string" && CRITERION_STATUS_SET.has(value);
}
