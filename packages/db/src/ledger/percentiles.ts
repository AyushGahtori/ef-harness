import { LedgerInputError } from "./errors.js";
import { assertNonNegativeIntegerUnits } from "./integer-units.js";

/**
 * Nearest-rank 95th percentile of observed output units.
 * Routes that reject max_output_tokens reserve this amount and settle the streamed actual.
 */
export function estimateP95OutputUnits(samples: readonly number[]): number {
  if (samples.length === 0) {
    throw new LedgerInputError("p95 stream cutoff requires at least one observed output");
  }
  const sorted = samples.map((value) => {
    assertNonNegativeIntegerUnits(value);
    return value;
  });
  sorted.sort((left, right) => left - right);
  const rank = Number((BigInt(95) * BigInt(sorted.length) + 99n) / 100n);
  const picked = sorted[rank - 1];
  if (picked === undefined) {
    throw new LedgerInputError("p95 rank fell outside the observed sample");
  }
  return picked;
}
