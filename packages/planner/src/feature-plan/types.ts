import type { WorkerTier } from "@ef-harness/shared-contracts";

import type { TouchTag } from "./touches.js";

export const FEATURE_PLANNER_SCHEMA = "feature-planner@1" as const;
export const ORACLE_AUTHOR_SCHEMA = "oracle-author@1" as const;
export const FEATURE_INTEGRATION_SLOT = "096" as const;
export const MIN_LEAF_FILES = 1;
export const MAX_LEAF_FILES = 5;
export const MIN_ORACLE_CASES = 3;

export const RELATION_KEYS = [
  "implements",
  "verifies",
  "depends_on",
  "touches_entity",
  "belongs_to",
  "consumes_contract",
  "consumes",
] as const;

export type RelationKey = (typeof RELATION_KEYS)[number];

export const EDGE_TYPES = [
  "implements",
  "verifies",
  "depends_on",
  "touches_entity",
  "belongs_to",
  "consumes_contract",
] as const;

export type EdgeType = (typeof EDGE_TYPES)[number];

export type CheckKind = "api" | "ui" | "unit";
export type Diversity = "happy" | "boundary" | "negative" | "adversarial";
export type TaskLevel = WorkerTier;
export type TaskType = "leaf" | "wiring" | "feature_integration";
export type OracleIndependence = "cross_family" | "same_family_only";
export type RequirementNodeKind = "spec_item" | "edge_case" | "rule";

export interface ModelTierAssignment {
  readonly id: string;
  readonly tier: "senior" | "mid" | "cheap";
}

export interface ModelFamily {
  readonly id: string;
  readonly models: readonly ModelTierAssignment[];
}

export interface ModelRoster {
  readonly families: readonly ModelFamily[];
}

export interface ModelAssignment {
  readonly family: string;
  readonly model: string;
}

export interface RequirementInput {
  readonly id: string;
  readonly title: string;
  readonly ears: string;
  readonly oracleSketch: string;
  readonly touches: readonly TouchTag[];
  readonly trivial: boolean;
  readonly nodeKind: RequirementNodeKind;
  readonly kind: CheckKind;
  readonly entryPoint: string;
  readonly files: readonly string[];
  readonly contractId: string | null;
  readonly entityId: string | null;
  readonly ruleId: string | null;
}

export interface ContractInput {
  readonly id: string;
  readonly title: string;
  readonly entryPoint: string;
  readonly schemaName: string;
  readonly route: string;
}

export interface EntityInput {
  readonly id: string;
  readonly title: string;
  readonly touches: readonly TouchTag[];
}

export interface CheckExample {
  readonly input: string;
  readonly expected: string;
  readonly assertion: string;
}

export interface PlannedCheck {
  readonly id: string;
  readonly kind: CheckKind;
  readonly requirementIds: readonly string[];
  readonly visibility: "visible";
  readonly entryPoint: string;
  readonly example: CheckExample;
}

export interface PlannedTask {
  readonly id: string;
  readonly goal: string;
  readonly writeScope: readonly string[];
  readonly files: readonly string[];
  readonly touches: readonly TouchTag[];
  readonly requirementIds: readonly string[];
  readonly dependsOn: readonly string[];
  readonly level: TaskLevel;
  readonly behaviors: readonly [string];
  readonly taskType: TaskType;
  readonly integrationSlot: typeof FEATURE_INTEGRATION_SLOT | null;
  readonly contractIds: readonly string[];
  readonly entityIds: readonly string[];
  readonly checks: readonly PlannedCheck[];
}

export interface FeaturePlanDocument {
  readonly schema: typeof FEATURE_PLANNER_SCHEMA;
  readonly featureId: string;
  readonly tasks: readonly PlannedTask[];
  readonly integration: PlannedTask;
  readonly journeyCheck: PlannedCheck;
}

export interface HeldBackCase {
  readonly checkId: string;
  readonly requirementIds: readonly string[];
  readonly input: string;
  readonly expected: string;
  readonly ruleId: string | null;
  readonly diversity: Diversity;
  readonly kind: CheckKind;
  readonly entryPoint: string;
  readonly assertion: string;
}

export interface OracleRubric {
  readonly checkId: string;
  readonly criteria: string;
  readonly threshold: string;
}

export interface OracleAuthorDocument {
  readonly schema: typeof ORACLE_AUTHOR_SCHEMA;
  readonly heldBack: readonly HeldBackCase[];
  readonly rubrics: readonly OracleRubric[];
}

export interface VisibleExample {
  readonly requirementId: string;
  readonly kind: CheckKind;
  readonly entryPoint: string;
  readonly input: string;
  readonly expected: string;
  readonly assertion: string;
}

export interface RelationSource {
  readonly id: string;
  readonly kind: string;
  readonly title: string;
  readonly text: string;
  readonly featureId: string | null;
  readonly fields: Readonly<Record<string, unknown>>;
}

export interface StoredEdge {
  readonly src: string;
  readonly type: EdgeType;
  readonly dst: string;
}

export interface DiagnosticEntry {
  readonly code: string;
  readonly message: string;
}

export interface SealReceipt {
  readonly featureId: string;
  readonly sealedAt: number;
  readonly sealedBeforeCompile: true;
  readonly oracleIndependence: OracleIndependence;
  readonly selectedFamily: string;
  readonly selectedModel: string;
  readonly buildWorkerFamily: string;
  readonly warnings: readonly DiagnosticEntry[];
  readonly repairAttempts: number;
  readonly checkIds: readonly string[];
  readonly caseCount: number;
}

export interface WorkerBrief {
  readonly schema: "task-packet@1";
  readonly task: string;
  readonly goal: string;
  readonly write_scope: readonly string[];
  readonly must: readonly { readonly id: string; readonly text: string }[];
  readonly checks_visible: readonly string[];
  readonly checks_visible_examples: readonly {
    readonly id: string;
    readonly entry_point: string;
    readonly input: string;
    readonly expected: string;
    readonly assertion: string;
  }[];
  readonly checks_hidden_count: number;
}

export interface ModelRepair {
  readonly attempt: 1;
  readonly reasons: readonly string[];
}

export interface ModelRequest {
  readonly role: typeof FEATURE_PLANNER_SCHEMA | typeof ORACLE_AUTHOR_SCHEMA;
  readonly family: string;
  readonly model: string;
  readonly input: unknown;
  readonly repair: ModelRepair | null;
}

export interface PlannerOracleModel {
  complete(request: ModelRequest): Promise<unknown>;
}
