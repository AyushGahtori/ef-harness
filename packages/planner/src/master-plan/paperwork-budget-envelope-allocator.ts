import { MasterPlanError } from "./errors.js";
import {
  allocateEnvelopes,
  computeAllocation,
  paperworkOf,
  WARN_RATIO_PPM,
  type AllocationWeightInput,
  type WeightShare,
} from "./integer-budget.js";
import type { CallClass, CurrencyKind, EnvelopeAllocation, EnvelopeId, ProjectAllocation } from "./types.js";

export type { WeightShare, AllocationWeightInput };

const OPTIONAL_CALLS = new Set<CallClass>([
  "optional_low_risk_research",
  "optional_web_fetch",
  "advisory_taste_review",
]);

const CALL_ENVELOPE: Record<CallClass, EnvelopeId> = {
  optional_low_risk_research: "research",
  optional_web_fetch: "research",
  mandatory_research: "research",
  mandatory_architecture: "architecture",
  sealed_oracle: "planning",
  determinism_gate: "planning",
  mandatory_planning: "planning",
  advisory_taste_review: "integration_review",
  mandatory_review: "integration_review",
  mandatory_audit: "final_audit",
  implementation: "build",
};

export interface AdmitRequest {
  readonly bucket: string;
  readonly envelope: EnvelopeId;
  readonly amountUnits: bigint;
  readonly callClass: CallClass;
  readonly userApprovedBuildRaid?: boolean;
}

export interface WarningMetric {
  readonly name: "paperwork_envelope_pressure";
  readonly envelope: EnvelopeId;
  readonly bucket: string;
  readonly spentUnits: bigint;
  readonly limitUnits: bigint;
  readonly threshold: "85_percent";
  readonly ratioPpm: bigint;
}

export interface AdmitDecision {
  readonly admitted: boolean;
  readonly reason:
    | "admitted"
    | "admitted_with_explicit_build_raid"
    | "compressed_optional"
    | "needs_explicit_build_approval"
    | "build_envelope_exhausted";
  readonly envelope: EnvelopeId;
  readonly bucket: string;
  readonly spentUnits: bigint;
  readonly limitUnits: bigint;
  readonly buildRemainingUnits: bigint;
  readonly planningRemainingUnits: bigint;
  readonly buildRaidedUnits: bigint;
  readonly warning: WarningMetric | null;
}

function cloneEnvelopes(source: EnvelopeAllocation): EnvelopeAllocation {
  return {
    research: source.research,
    architecture: source.architecture,
    planning: source.planning,
    integration_review: source.integration_review,
    final_audit: source.final_audit,
    build: source.build,
  };
}

type MutableEnvelopes = Record<EnvelopeId, bigint>;

function zeroSpent(): MutableEnvelopes {
  return {
    research: 0n,
    architecture: 0n,
    planning: 0n,
    integration_review: 0n,
    final_audit: 0n,
    build: 0n,
  };
}

function warningFor(bucket: string, envelope: EnvelopeId, spent: bigint, limit: bigint): WarningMetric | null {
  if (limit <= 0n || envelope === "build") return null;
  const ratioPpm = (spent * 1_000_000n) / limit;
  if (ratioPpm < WARN_RATIO_PPM) return null;
  return {
    name: "paperwork_envelope_pressure",
    envelope,
    bucket,
    spentUnits: spent,
    limitUnits: limit,
    threshold: "85_percent",
    ratioPpm,
  };
}

/**
 * Per-wave 20% paperwork envelope allocator.
 * Optional research fetches and advisory taste review compress at 100%.
 * Sealed oracles and determinism gates are never skipped; crossing their
 * envelope requires an explicit build-budget raid.
 */
export class PaperworkBudgetEnvelopeAllocator {
  private allocation: ProjectAllocation | null = null;
  private readonly spent = new Map<string, MutableEnvelopes>();

  allocate(input: AllocationWeightInput): ProjectAllocation {
    const allocation = computeAllocation(input);
    this.allocation = {
      ...allocation,
      envelopes: cloneEnvelopes(allocation.envelopes),
      buckets: allocation.buckets.map((bucket) => ({
        key: bucket.key,
        weight: bucket.weight,
        envelopes: cloneEnvelopes(bucket.envelopes),
      })),
    };
    this.spent.clear();
    for (const bucket of this.allocation.buckets) {
      this.spent.set(bucket.key, zeroSpent());
    }
    return computeAllocation(input);
  }

  allocationSnapshot(): ProjectAllocation {
    if (!this.allocation) {
      throw new MasterPlanError("invalid_budget", "Allocate a budget before reading it");
    }
    return this.allocation;
  }

  spentUnits(bucket: string, envelope: EnvelopeId): bigint {
    return this.bucketSpent(bucket)[envelope];
  }

  remainingUnits(bucket: string, envelope: EnvelopeId): bigint {
    return this.bucketLimit(bucket)[envelope] - this.spentUnits(bucket, envelope);
  }

  admit(request: AdmitRequest): AdmitDecision {
    if (request.amountUnits < 0n) {
      throw new MasterPlanError("negative_budget", "Spend amount must be non-negative");
    }
    const expected = CALL_ENVELOPE[request.callClass];
    if (expected !== request.envelope) {
      throw new MasterPlanError(
        "envelope_mismatch",
        `${request.callClass} belongs to ${expected}, not ${request.envelope}`,
      );
    }
    const limits = this.bucketLimit(request.bucket);
    const spent = this.bucketSpent(request.bucket);
    const limit = limits[request.envelope];
    const already = spent[request.envelope];
    const buildLimit = limits.build;
    const buildSpent = spent.build;
    const planningLimit = limits.planning;
    const planningSpent = spent.planning;
    const base = {
      envelope: request.envelope,
      bucket: request.bucket,
      limitUnits: limit,
      buildRemainingUnits: buildLimit - buildSpent,
      planningRemainingUnits: planningLimit - planningSpent,
      buildRaidedUnits: 0n,
    };

    if (request.amountUnits === 0n) {
      return {
        ...base,
        admitted: true,
        reason: "admitted",
        spentUnits: already,
        warning: warningFor(request.bucket, request.envelope, already, limit),
      };
    }

    const room = limit - already;
    if (request.amountUnits <= room) {
      spent[request.envelope] = already + request.amountUnits;
      const nextSpent = spent[request.envelope];
      return {
        ...base,
        admitted: true,
        reason: "admitted",
        spentUnits: nextSpent,
        buildRemainingUnits: buildLimit - spent.build,
        planningRemainingUnits: planningLimit - spent.planning,
        warning: warningFor(request.bucket, request.envelope, nextSpent, limit),
      };
    }

    if (OPTIONAL_CALLS.has(request.callClass)) {
      return {
        ...base,
        admitted: false,
        reason: "compressed_optional",
        spentUnits: already,
        warning: warningFor(request.bucket, request.envelope, already, limit),
      };
    }

    if (request.envelope === "build") {
      return {
        ...base,
        admitted: false,
        reason: "build_envelope_exhausted",
        spentUnits: already,
        warning: null,
      };
    }

    if (request.userApprovedBuildRaid !== true) {
      return {
        ...base,
        admitted: false,
        reason: "needs_explicit_build_approval",
        spentUnits: already,
        warning: warningFor(request.bucket, request.envelope, already, limit),
      };
    }

    const overflow = request.amountUnits - (room > 0n ? room : 0n);
    const buildRemaining = buildLimit - buildSpent;
    if (overflow > buildRemaining) {
      return {
        ...base,
        admitted: false,
        reason: "build_envelope_exhausted",
        spentUnits: already,
        warning: warningFor(request.bucket, request.envelope, already, limit),
      };
    }
    if (room > 0n) spent[request.envelope] = already + room;
    spent.build = buildSpent + overflow;
    return {
      admitted: true,
      reason: "admitted_with_explicit_build_raid",
      envelope: request.envelope,
      bucket: request.bucket,
      spentUnits: spent[request.envelope],
      limitUnits: limit,
      buildRemainingUnits: buildLimit - spent.build,
      planningRemainingUnits: planningLimit - spent.planning,
      buildRaidedUnits: overflow,
      warning: warningFor(request.bucket, request.envelope, spent[request.envelope], limit),
    };
  }

  private bucketLimit(bucket: string): EnvelopeAllocation {
    const found = this.allocation?.buckets.find((item) => item.key === bucket);
    if (!found) {
      throw new MasterPlanError("invalid_budget", `Unknown budget bucket ${bucket}`);
    }
    return found.envelopes;
  }

  private bucketSpent(bucket: string): MutableEnvelopes {
    const found = this.spent.get(bucket);
    if (!found) {
      throw new MasterPlanError("invalid_budget", `Unknown budget bucket ${bucket}`);
    }
    return found;
  }
}

export function allocationForCurrency(
  currency: CurrencyKind,
  totalUnits: bigint,
  weights: readonly WeightShare[],
): ProjectAllocation {
  return computeAllocation({ currency, totalUnits, weights });
}

export { allocateEnvelopes, paperworkOf };
