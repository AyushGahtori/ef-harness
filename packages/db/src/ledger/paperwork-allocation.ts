import { LedgerInputError, LedgerInvariantError } from "./errors.js";
import { assertNonNegativeIntegerUnits } from "./integer-units.js";

export const PAPERWORK_PHASES = ["spec", "research", "architecture", "planning", "audit"] as const;

export type PaperworkPhase = (typeof PAPERWORK_PHASES)[number];

/** Default share of the project budget. The five phases sum to the 20% paperwork cap. */
export const PAPERWORK_PHASE_PERCENT: Record<PaperworkPhase, number> = {
  spec: 3,
  research: 5,
  architecture: 6,
  planning: 4,
  audit: 2,
};

export const PAPERWORK_CAP_PERCENT = 20;

const WAVE_SCOPE_ID = /^w:(\d+):([^:*?[\]]+):([a-z_]+)$/u;

export interface ParsedWaveScopeId {
  ordinal: number;
  waveId: string;
  phase: PaperworkPhase;
}

export function paperworkPhaseLimits(projectLimitUnits: number): Record<PaperworkPhase, number> {
  assertNonNegativeIntegerUnits(projectLimitUnits);
  const limit = BigInt(projectLimitUnits);
  const cap = (limit * BigInt(PAPERWORK_CAP_PERCENT)) / 100n;
  const rows = PAPERWORK_PHASES.map((phase) => {
    const product = limit * BigInt(PAPERWORK_PHASE_PERCENT[phase]);
    return { phase, units: product / 100n, remainder: product % 100n };
  });
  let assigned = rows.reduce((sum, row) => sum + row.units, 0n);
  const order = [...rows].sort((left, right) => {
    if (left.remainder === right.remainder) {
      return PAPERWORK_PHASES.indexOf(left.phase) - PAPERWORK_PHASES.indexOf(right.phase);
    }
    return left.remainder > right.remainder ? -1 : 1;
  });
  let cursor = 0;
  while (assigned < cap) {
    const slot = order[cursor % order.length];
    if (!slot) throw new LedgerInvariantError("paperwork phase split lost a phase");
    slot.units += 1n;
    assigned += 1n;
    cursor += 1;
  }
  if (assigned !== cap) {
    throw new LedgerInvariantError("paperwork phase split did not sum to the 20% cap");
  }
  const result = {} as Record<PaperworkPhase, number>;
  for (const row of rows) {
    result[row.phase] = Number(row.units);
  }
  return result;
}

export function splitIntegerByWeights(total: number, weights: readonly number[]): number[] {
  assertNonNegativeIntegerUnits(total);
  if (weights.length === 0) throw new LedgerInputError("paperwork wave weights are empty");
  let weightSum = 0n;
  const bigWeights = weights.map((weight) => {
    if (!Number.isSafeInteger(weight) || weight <= 0) {
      throw new LedgerInputError("paperwork wave weights must be positive integers");
    }
    const big = BigInt(weight);
    weightSum += big;
    return big;
  });
  const totalBig = BigInt(total);
  const shares = bigWeights.map((weight) => (totalBig * weight) / weightSum);
  let assigned = shares.reduce((sum, value) => sum + value, 0n);
  const remainders = bigWeights.map((weight, index) => ({
    index,
    remainder: (totalBig * weight) % weightSum,
  }));
  remainders.sort((left, right) => {
    if (left.remainder === right.remainder) return left.index - right.index;
    return left.remainder > right.remainder ? -1 : 1;
  });
  let cursor = 0;
  while (assigned < totalBig) {
    const slot = remainders[cursor % remainders.length];
    if (!slot) throw new LedgerInvariantError("paperwork wave split lost a weight");
    const current = shares[slot.index];
    if (current === undefined) throw new LedgerInvariantError("paperwork wave split missed an index");
    shares[slot.index] = current + 1n;
    assigned += 1n;
    cursor += 1;
  }
  return shares.map((value) => Number(value));
}

export function formatWaveScopeId(ordinal: number, waveId: string, phase: PaperworkPhase): string {
  if (!Number.isSafeInteger(ordinal) || ordinal < 0) {
    throw new LedgerInputError("paperwork wave ordinal must be a non-negative integer");
  }
  assertWaveId(waveId);
  return `w:${String(ordinal).padStart(4, "0")}:${waveId}:${phase}`;
}

export function parseWaveScopeId(scopeId: string): ParsedWaveScopeId | null {
  const match = WAVE_SCOPE_ID.exec(scopeId);
  if (!match) return null;
  const ordinalText = match[1];
  const waveId = match[2];
  const phase = match[3];
  if (ordinalText === undefined || waveId === undefined || phase === undefined) return null;
  const ordinal = Number(ordinalText);
  if (!isPaperworkPhase(phase) || !Number.isSafeInteger(ordinal)) return null;
  return { ordinal, waveId, phase };
}

export function isPaperworkPhase(value: string): value is PaperworkPhase {
  return (PAPERWORK_PHASES as readonly string[]).includes(value);
}

export function assertWaveId(waveId: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(waveId)) {
    throw new LedgerInputError(
      "paperwork wave id must start with a letter or digit and contain no colon or glob character",
    );
  }
}
