import { MasterPlanError } from "./errors.js";
import {
  ENVELOPE_IDS,
  PAPERWORK_ENVELOPE_IDS,
  type CurrencyKind,
  type EnvelopeAllocation,
  type EnvelopeId,
  type ProjectAllocation,
} from "./types.js";

/** Scale for both micro-USD and allowance ppm. */
export const UNIT_SCALE = 1_000_000n;

/**
 * Task 090 shares of the project budget, in ppm.
 * Research 3%, architecture 5%, planning and sealed oracles 6%,
 * integration and reviews 4%, final audits 2%, implementation 80%.
 */
export const ENVELOPE_PPM: Readonly<Record<EnvelopeId, bigint>> = {
  research: 30_000n,
  architecture: 50_000n,
  planning: 60_000n,
  integration_review: 40_000n,
  final_audit: 20_000n,
  build: 800_000n,
};

export const PAPERWORK_PPM = 200_000n;
export const BUILD_PPM = 800_000n;
export const WARN_RATIO_PPM = 850_000n;

export const DEFAULT_COST_PER_LEAF_MICRO_USD = 100_000n;
export const DEFAULT_COST_PER_LEAF_PPM = 1_000n;

export function defaultCostPerLeaf(currency: CurrencyKind): bigint {
  return currency === "usd" ? DEFAULT_COST_PER_LEAF_MICRO_USD : DEFAULT_COST_PER_LEAF_PPM;
}

export function assertNonNegativeUnits(total: bigint, label: string): void {
  if (total < 0n) {
    throw new MasterPlanError("negative_budget", `${label} must be a non-negative integer`);
  }
}

export function usdDecimalToMicroUnits(input: string): bigint {
  const cleaned = input.trim().replace(/^\$/, "");
  const match = /^(\d+)(?:\.(\d{1,6}))?$/.exec(cleaned);
  if (!match) {
    throw new MasterPlanError(
      "invalid_budget",
      `USD amount ${input} is not a non-negative decimal with at most 6 fractional digits`,
    );
  }
  const whole = BigInt(match[1] ?? "0");
  const fraction = (match[2] ?? "").padEnd(6, "0");
  return whole * UNIT_SCALE + BigInt(fraction);
}

export interface WeightShare {
  readonly key: string;
  readonly weight: bigint;
}

function compareRemainder(
  a: { readonly rem: bigint; readonly ppm: bigint; readonly key: string },
  b: { readonly rem: bigint; readonly ppm: bigint; readonly key: string },
): number {
  if (a.rem !== b.rem) return a.rem > b.rem ? -1 : 1;
  if (a.ppm !== b.ppm) return a.ppm < b.ppm ? -1 : 1;
  if (a.key !== b.key) return a.key < b.key ? -1 : 1;
  return 0;
}

/**
 * Largest-remainder split. The parts sum to `total` with zero drift.
 * Smaller weights win remainder ties so a tiny share still receives a quantum.
 */
export function splitByWeights(total: bigint, weights: readonly WeightShare[]): Map<string, bigint> {
  assertNonNegativeUnits(total, "split total");
  if (weights.length === 0) {
    throw new MasterPlanError("invalid_budget", "Allocation weights are empty");
  }
  let weightSum = 0n;
  const seen = new Set<string>();
  for (const share of weights) {
    if (share.weight <= 0n) {
      throw new MasterPlanError("invalid_budget", `Weight for ${share.key} must be positive`);
    }
    if (seen.has(share.key)) {
      throw new MasterPlanError("invalid_budget", `Duplicate allocation weight ${share.key}`);
    }
    seen.add(share.key);
    weightSum += share.weight;
  }
  const rows = weights.map((share) => {
    const product = total * share.weight;
    return {
      key: share.key,
      ppm: share.weight,
      floor: product / weightSum,
      rem: product % weightSum,
    };
  });
  let leftover = total;
  const amounts = new Map<string, bigint>();
  for (const row of rows) {
    amounts.set(row.key, row.floor);
    leftover -= row.floor;
  }
  const order = [...rows].sort(compareRemainder);
  for (const row of order) {
    if (leftover === 0n) break;
    amounts.set(row.key, (amounts.get(row.key) ?? 0n) + 1n);
    leftover -= 1n;
  }
  if (leftover !== 0n) {
    throw new MasterPlanError("budget_drift", "Weight split could not absorb the remainder");
  }
  return amounts;
}

function emptyEnvelopes(): Record<EnvelopeId, bigint> {
  return {
    research: 0n,
    architecture: 0n,
    planning: 0n,
    integration_review: 0n,
    final_audit: 0n,
    build: 0n,
  };
}

/**
 * Integer envelope split.
 * Paperwork receives largest-remainder quanta up to the 20% floor.
 * Every leftover unit after that ceiling stays on the build envelope,
 * so paperwork cannot take from the 80% implementation pool.
 */
export function allocateEnvelopes(total: bigint): EnvelopeAllocation {
  assertNonNegativeUnits(total, "project budget");
  const amounts = emptyEnvelopes();
  const meta: Array<{ id: EnvelopeId; rem: bigint; ppm: bigint; key: string }> = [];
  let assigned = 0n;
  for (const id of ENVELOPE_IDS) {
    const ppm = ENVELOPE_PPM[id];
    const product = total * ppm;
    const floor = product / UNIT_SCALE;
    amounts[id] = floor;
    assigned += floor;
    meta.push({ id, rem: product % UNIT_SCALE, ppm, key: id });
  }
  let leftover = total - assigned;
  const ceiling = (total * PAPERWORK_PPM) / UNIT_SCALE;
  let paperwork = 0n;
  for (const id of PAPERWORK_ENVELOPE_IDS) {
    paperwork += amounts[id];
  }
  const paperworkOrder = meta.filter((row) => row.id !== "build").sort(compareRemainder);
  for (const row of paperworkOrder) {
    if (leftover === 0n || paperwork >= ceiling) break;
    amounts[row.id] += 1n;
    paperwork += 1n;
    leftover -= 1n;
  }
  amounts.build += leftover;
  const sum = ENVELOPE_IDS.reduce((acc, id) => acc + amounts[id], 0n);
  if (sum !== total || paperwork > ceiling) {
    throw new MasterPlanError("budget_drift", "Envelope split drifted from the project total");
  }
  const buildFloor = (total * BUILD_PPM) / UNIT_SCALE;
  if (amounts.build < buildFloor) {
    throw new MasterPlanError("budget_drift", "Build envelope fell below the 80% floor");
  }
  return amounts;
}

export function paperworkOf(envelopes: EnvelopeAllocation): bigint {
  return PAPERWORK_ENVELOPE_IDS.reduce((sum, id) => sum + envelopes[id], 0n);
}

export interface AllocationWeightInput {
  readonly currency: CurrencyKind;
  readonly totalUnits: bigint;
  readonly weights: readonly WeightShare[];
}

export function computeAllocation(input: AllocationWeightInput): ProjectAllocation {
  const envelopes = allocateEnvelopes(input.totalUnits);
  const buckets = input.weights.map((share) => ({
    key: share.key,
    weight: share.weight,
    envelopes: emptyEnvelopes(),
  }));
  for (const id of ENVELOPE_IDS) {
    const parts = splitByWeights(envelopes[id], input.weights);
    for (const bucket of buckets) {
      bucket.envelopes[id] = parts.get(bucket.key) ?? 0n;
    }
  }
  for (const id of ENVELOPE_IDS) {
    const bucketSum = buckets.reduce((sum, bucket) => sum + bucket.envelopes[id], 0n);
    if (bucketSum !== envelopes[id]) {
      throw new MasterPlanError("budget_drift", `Per-wave ${id} split drifted`);
    }
  }
  return {
    currency: input.currency,
    totalUnits: input.totalUnits,
    envelopes,
    paperworkUnits: paperworkOf(envelopes),
    buildUnits: envelopes.build,
    buckets,
  };
}

export function bigintToSqlite(value: bigint): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < 0n) {
    throw new MasterPlanError(
      "unsafe_integer",
      "Budget units must fit in a non-negative safe integer for state.db",
    );
  }
  return Number(value);
}

export function sqliteToBigint(value: unknown, label: string): bigint {
  if (typeof value === "bigint") {
    if (value < 0n) throw new MasterPlanError("corrupt_plan", `${label} is negative`);
    return value;
  }
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return BigInt(value);
  }
  if (typeof value === "string" && /^\d+$/.test(value)) return BigInt(value);
  throw new MasterPlanError("corrupt_plan", `${label} is not an integer`);
}
