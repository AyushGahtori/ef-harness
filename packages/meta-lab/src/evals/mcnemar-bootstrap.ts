import { seedFromSha256 } from "./prng.js";
import type { BootstrapResult, ConfidenceInterval, McNemarResult, PairedContinuousCase } from "./types.js";

export const BOOTSTRAP_RESAMPLES = 10_000;
export const EFFICIENCY_SAVINGS_THRESHOLD = 0.15;
export const MC_NEMAR_ALPHA = 0.05;
export const PAPERWORK_BUDGET_MAX = 0.2;

function binomialCoefficient(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  if (k === 0 || k === n) return 1;
  let result = 1;
  const limit = Math.min(k, n - k);
  for (let i = 1; i <= limit; i += 1) {
    result = (result * (n - limit + i)) / i;
  }
  return result;
}

/**
 * Exact two-sided McNemar p-value on discordant pairs (binomial, never chi-square).
 */
export function exactMcNemarPValue(b: number, c: number): McNemarResult {
  const n = b + c;
  if (n === 0) {
    return { b, c, discordantTotal: 0, exactPValue: 1 };
  }
  if (b === c) {
    return { b, c, discordantTotal: n, exactPValue: 1 };
  }
  const lower = Math.min(b, c);
  const halfPow = 0.5 ** n;
  let cdf = 0;
  for (let k = 0; k <= lower; k += 1) {
    cdf += binomialCoefficient(n, k) * halfPow;
  }
  return {
    b,
    c,
    discordantTotal: n,
    exactPValue: Math.min(1, 2 * cdf),
  };
}

export function countDiscordantPairs(cases: readonly PairedContinuousCase[]): { b: number; c: number } {
  let b = 0;
  let c = 0;
  for (const row of cases) {
    if (!row.baselinePass && row.candidatePass) b += 1;
    else if (row.baselinePass && !row.candidatePass) c += 1;
  }
  return { b, c };
}

function savingsFraction(baseline: number, candidate: number): number {
  if (baseline <= 0) return 0;
  return (baseline - candidate) / baseline;
}

function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = (sorted.length - 1) * p;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower] ?? 0;
  const weight = index - lower;
  return (sorted[lower] ?? 0) * (1 - weight) + (sorted[upper] ?? 0) * weight;
}

function bootstrapCi(
  pairedDeltas: readonly number[],
  evalRunId: string,
  resamples: number,
): ConfidenceInterval {
  const { next } = seedFromSha256(`bootstrap:${evalRunId}`);
  const means: number[] = [];
  const n = pairedDeltas.length;
  if (n === 0) {
    return { lower: 0, upper: 0, level: 0.95 };
  }
  for (let r = 0; r < resamples; r += 1) {
    let sum = 0;
    for (let i = 0; i < n; i += 1) {
      const idx = Math.floor(next() * n);
      sum += pairedDeltas[idx] ?? 0;
    }
    means.push(sum / n);
  }
  means.sort((a, b) => a - b);
  return {
    lower: round4(percentile(means, 0.025)),
    upper: round4(percentile(means, 0.975)),
    level: 0.95,
  };
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

export class McNemarAndBootstrapCalculator {
  computeMcNemar(cases: readonly PairedContinuousCase[]): McNemarResult {
    const { b, c } = countDiscordantPairs(cases);
    return exactMcNemarPValue(b, c);
  }

  computeBootstrap(cases: readonly PairedContinuousCase[], evalRunId: string): BootstrapResult {
    const tokenDeltas = cases.map((row) => savingsFraction(row.tokenCostBaseline, row.tokenCostCandidate));
    const wallDeltas = cases.map((row) => savingsFraction(row.wallClockBaseline, row.wallClockCandidate));
    const seed = seedFromSha256(evalRunId).seed;
    return {
      resamples: BOOTSTRAP_RESAMPLES,
      seed,
      tokenCostSavingsCi: bootstrapCi(tokenDeltas, `${evalRunId}:token`, BOOTSTRAP_RESAMPLES),
      wallClockSavingsCi: bootstrapCi(wallDeltas, `${evalRunId}:wall`, BOOTSTRAP_RESAMPLES),
    };
  }
}

export function passesEfficiencyTieRule(
  mcnemar: McNemarResult,
  bootstrap: BootstrapResult,
): boolean {
  if (mcnemar.c > 0) return false;
  const tokenOk = bootstrap.tokenCostSavingsCi.lower >= EFFICIENCY_SAVINGS_THRESHOLD;
  const wallOk = bootstrap.wallClockSavingsCi.lower >= EFFICIENCY_SAVINGS_THRESHOLD;
  return tokenOk || wallOk;
}