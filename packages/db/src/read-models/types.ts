export const REQUIREMENT_STATUSES = [
  "uncovered",
  "pending",
  "passing",
  "failing",
  "waived",
] as const;

export type RequirementStatusName = (typeof REQUIREMENT_STATUSES)[number];

export const CANONICAL_READ_MODEL_QUERIES = [
  "rollup_drift",
  "requirement_status_recompute",
  "requirements_without_task",
  "requirements_without_check",
  "tasks_without_requirement",
] as const;

export type CanonicalReadModelQuery = (typeof CANONICAL_READ_MODEL_QUERIES)[number];

export interface FeatureProgress {
  readonly feature: string;
  readonly featureState: string | null;
  readonly taskCounts: Readonly<Record<string, number>>;
  readonly requirementCounts: Readonly<Record<RequirementStatusName, number>>;
  readonly taskTotal: number;
  readonly requirementTotal: number;
  readonly passing: number;
  readonly waived: number;
  readonly failing: number;
  readonly pending: number;
  readonly uncovered: number;
}

export interface BoardSummary {
  readonly features: readonly FeatureProgress[];
  readonly readRows: number;
}

export interface TaskRollupDriftRow {
  readonly feature: string;
  readonly state: string;
  readonly rollup_n: number | null;
  readonly actual_n: number | null;
}

export interface RequirementRollupDriftRow {
  readonly feature: string;
  readonly status: string;
  readonly rollup_n: number | null;
  readonly actual_n: number | null;
}

export interface RequirementStatusDriftRow {
  readonly requirement: string;
  readonly stored_feature: string | null;
  readonly stored_status: string | null;
  readonly recomputed_feature: string | null;
  readonly recomputed_status: string | null;
}

export interface DriftReport {
  readonly drifted: boolean;
  readonly healed: boolean;
  readonly timestampsAdjusted: number;
  readonly taskRollup: readonly TaskRollupDriftRow[];
  readonly requirementRollup: readonly RequirementRollupDriftRow[];
  readonly requirementStatus: readonly RequirementStatusDriftRow[];
}

export interface DriftBugAlert {
  readonly severity: "error";
  readonly event: "kernel_bug.read_model_drift";
  readonly message: string;
  readonly timestampsAdjusted: number;
  readonly taskRollup: readonly TaskRollupDriftRow[];
  readonly requirementRollup: readonly RequirementRollupDriftRow[];
  readonly requirementStatus: readonly RequirementStatusDriftRow[];
}

export interface TraceabilityGaps {
  readonly requirementsWithoutTask: readonly string[];
  readonly requirementsWithoutCheck: readonly string[];
  readonly tasksWithoutRequirement: readonly string[];
}

export interface RequirementStatusRow {
  readonly requirement: string;
  readonly feature: string | null;
  readonly status: RequirementStatusName;
  readonly updatedRev: number;
}

export interface RequirementStatusSyncRequest {
  readonly checkIds?: readonly string[];
  readonly requirementIds?: readonly string[];
  readonly updatedRev?: number;
}

export interface RequirementStatusSyncResult {
  readonly updated: readonly RequirementStatusRow[];
  readonly removed: readonly string[];
  readonly timestampsAdjusted: number;
}

export interface WaiverExposure {
  readonly id: string;
  readonly requirementId: string;
  readonly reason: string | null;
  readonly approvedBy: string | null;
  readonly riskMax: string | null;
  readonly requirementRisk: string | null;
  readonly developerApproved: boolean;
  readonly coversRequirement: boolean;
}

export interface RecomputedRequirement {
  readonly requirement: string;
  readonly feature: string | null;
  readonly status: RequirementStatusName;
}
