import type { ProjectKind, WorkerTier } from "@ef-harness/shared-contracts";

export type { ProjectKind, WorkerTier };

export const CURRENCIES = ["usd", "allowance_ppm"] as const;
export type CurrencyKind = (typeof CURRENCIES)[number];

export const ENVELOPE_IDS = [
  "research",
  "architecture",
  "planning",
  "integration_review",
  "final_audit",
  "build",
] as const;
export type EnvelopeId = (typeof ENVELOPE_IDS)[number];

export const PAPERWORK_ENVELOPE_IDS = [
  "research",
  "architecture",
  "planning",
  "integration_review",
  "final_audit",
] as const;
export type PaperworkEnvelopeId = (typeof PAPERWORK_ENVELOPE_IDS)[number];

export const CALL_CLASSES = [
  "optional_low_risk_research",
  "optional_web_fetch",
  "mandatory_research",
  "mandatory_architecture",
  "sealed_oracle",
  "determinism_gate",
  "mandatory_planning",
  "advisory_taste_review",
  "mandatory_review",
  "mandatory_audit",
  "implementation",
] as const;
export type CallClass = (typeof CALL_CLASSES)[number];

export interface Phase0Capabilities {
  readonly database: boolean;
  readonly auth: boolean;
  readonly ui: boolean;
}

export interface Phase0Recipe {
  readonly id: string;
  readonly title: string;
  readonly stage: "serial" | "parallel";
  readonly dependsOn: readonly string[];
  readonly level: WorkerTier;
  readonly writeScope: readonly string[];
  readonly steps: readonly string[];
  readonly expectedOutputs: readonly string[];
  readonly refs: readonly string[];
}

export interface Phase0Omission {
  readonly id: string;
  readonly reason: string;
}

export interface Phase0Plan {
  readonly projectKind: ProjectKind;
  readonly brownfield: boolean;
  readonly capabilities: Phase0Capabilities;
  readonly recipes: readonly Phase0Recipe[];
  readonly omitted: readonly Phase0Omission[];
}

export interface FeatureInput {
  readonly id: string;
  readonly title: string;
  readonly dependsOn: readonly string[];
  readonly active?: boolean;
  readonly verticalSlice?: boolean;
  readonly specItems?: number;
  readonly screens?: number;
  readonly endpoints?: number;
  readonly estimatedLeafTasks?: { readonly min: number; readonly max: number };
  readonly estimatedCostUnits?: { readonly min: bigint; readonly max: bigint };
}

export interface PlannedFeature {
  readonly id: string;
  readonly title: string;
  readonly dependsOn: readonly string[];
  readonly active: true;
  readonly verticalSlice: boolean | null;
  readonly specItems: number;
  readonly screens: number;
  readonly endpoints: number;
  readonly estimatedLeafTasks: { readonly min: number; readonly max: number } | null;
  readonly estimatedCostUnits: { readonly min: bigint; readonly max: bigint } | null;
}

export interface TaskCountRange {
  readonly min: number;
  readonly max: number;
}

export interface CostRange {
  readonly min: bigint;
  readonly max: bigint;
}

export interface ProjectedRange {
  readonly taskCount: TaskCountRange;
  readonly costUnits: CostRange;
}

export interface LeafTaskRef {
  readonly id: string;
}

export interface PlannedWave {
  readonly index: number;
  readonly kind: "feature";
  readonly featureIds: readonly string[];
  readonly dependsOn: readonly string[];
  readonly status: "planned" | "projected";
  readonly projected: ProjectedRange | null;
  readonly leafTasks: readonly LeafTaskRef[];
  readonly weightTasks: number;
}

export interface CompletionWave {
  readonly id: "completion";
  readonly kind: "completion";
  readonly ownerTask: "101";
  readonly index: number;
  readonly dependsOn: readonly string[];
  readonly status: "projected";
  readonly leafTasks: readonly [];
  readonly projected: ProjectedRange;
}

export interface EnvelopeAllocation {
  readonly research: bigint;
  readonly architecture: bigint;
  readonly planning: bigint;
  readonly integration_review: bigint;
  readonly final_audit: bigint;
  readonly build: bigint;
}

export interface AllocationBucket {
  readonly key: string;
  readonly weight: bigint;
  readonly envelopes: EnvelopeAllocation;
}

export interface ProjectAllocation {
  readonly currency: CurrencyKind;
  readonly totalUnits: bigint;
  readonly envelopes: EnvelopeAllocation;
  readonly paperworkUnits: bigint;
  readonly buildUnits: bigint;
  readonly buckets: readonly AllocationBucket[];
}

export interface MasterPlan {
  readonly schema: "master-planner@1";
  readonly payloadVersion: 1;
  readonly planId: string;
  readonly projectId: string;
  readonly projectKind: ProjectKind;
  readonly brownfield: boolean;
  readonly createdAt: number;
  readonly currency: CurrencyKind;
  readonly currencyCode: string;
  readonly connectionId: string | null;
  readonly totalUnits: bigint;
  readonly costPerLeafUnits: bigint;
  readonly breadthCap: number;
  readonly capabilities: Phase0Capabilities;
  readonly walkingSkeletonFeatureId: string;
  readonly walkingSkeletonSource: "explicit" | "implicit_first_root";
  readonly phase0: readonly Phase0Recipe[];
  readonly omittedPhase0: readonly Phase0Omission[];
  readonly waves: readonly PlannedWave[];
  readonly completionWave: CompletionWave;
  readonly features: readonly PlannedFeature[];
  readonly inactiveFeatureIds: readonly string[];
  readonly allocation: ProjectAllocation;
}
