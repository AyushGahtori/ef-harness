export type TargetPlatform = "windows" | "posix";

export type TaskLevel = "junior" | "senior";

export type TaskKind = "leaf" | "integration" | "scaffold" | "wiring" | "sweep";

export type RequirementKind = "spec_item" | "edge_case" | "rule" | "journey";

export type RequirementRisk = "low" | "medium" | "high";

export type RequirementSensitivity = "auth" | "payments" | "pii";

export type NameKind =
  | "http_route"
  | "page_route"
  | "db_table"
  | "db_column"
  | "db_index"
  | "env_var"
  | "storage_key"
  | "event"
  | "permission"
  | "exported_symbol";

export interface TokenAttribution {
  readonly nodeId: string;
  readonly tokens: number;
}

export interface PlannedName {
  readonly kind: NameKind;
  readonly value: string;
  readonly method: string | null;
}

export interface BrownfieldName {
  readonly kind: NameKind;
  readonly value: string;
  readonly owner: string;
  readonly method: string | null;
}

export interface PlanTask {
  readonly id: string;
  readonly featureId: string;
  readonly title: string;
  readonly taskKind: TaskKind;
  readonly level: TaskLevel;
  readonly writeScope: readonly string[];
  readonly primaryFiles: readonly string[];
  readonly responsibilities: readonly string[];
  readonly touches: readonly string[];
  readonly mustBandTokens: number;
  readonly mustTokenAttribution: readonly TokenAttribution[];
  readonly mustBandRuleIds: readonly string[];
  readonly implements: readonly string[];
  readonly obeys: readonly string[];
  readonly handlesEdgeCases: readonly string[];
  readonly dependsOn: readonly string[];
  readonly names: readonly PlannedName[];
  readonly mutatesSharedContract: boolean;
  readonly createsMigration: boolean;
  readonly migrationIntentSlot: string | null;
  readonly estimatedMinCostMicroUsd: number;
  readonly generatedScaffold: boolean;
}

export interface PlanFeature {
  readonly id: string;
  readonly title: string;
  readonly dependsOn: readonly string[];
  readonly active: boolean;
}

export interface PlanRequirement {
  readonly id: string;
  readonly featureId: string;
  readonly title: string;
  readonly kind: RequirementKind;
  readonly active: boolean;
  readonly risk: RequirementRisk;
  readonly sensitivities: readonly RequirementSensitivity[];
  readonly waived: boolean;
  readonly waiverApprovedBy: string | null;
  readonly waiverReason: string | null;
}

export interface PlanCheck {
  readonly id: string;
  readonly featureId: string;
  readonly requirementIds: readonly string[];
  readonly visibility: "visible" | "sealed";
}

export interface ContradictionEdge {
  readonly src: string;
  readonly dst: string;
  readonly resolved: boolean;
}

export interface MustAskCriterion {
  readonly id: string;
  readonly blocking: boolean;
  readonly settled: boolean;
}

export interface BudgetSnapshot {
  readonly remainingProjectMicroUsd: number;
  readonly remainingWaveMicroUsd: number;
}

export interface CompilationWaiver {
  readonly code: string;
  readonly reason: string;
  readonly approvedBy: string;
  readonly risk: RequirementRisk;
  readonly audited: boolean;
  readonly taskId: string | null;
}

export interface CompilationInput {
  readonly tasks: readonly PlanTask[];
  readonly features: readonly PlanFeature[];
  readonly requirements: readonly PlanRequirement[];
  readonly checks: readonly PlanCheck[];
  readonly contradictions: readonly ContradictionEdge[];
  readonly brownfieldNames: readonly BrownfieldName[];
  readonly mustAsk: readonly MustAskCriterion[];
  readonly budget: BudgetSnapshot;
  readonly waivers: readonly CompilationWaiver[];
  readonly sharedContractOwnerTaskIds: readonly string[];
  readonly platform: TargetPlatform;
  readonly planEpoch: number;
  readonly compiledAt: string;
}

export type DiagnosticDetail =
  | string
  | number
  | boolean
  | readonly string[]
  | readonly TokenAttribution[];

export interface CompilationDiagnostic {
  readonly pass: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
  readonly code: string;
  readonly message: string;
  readonly taskIds: readonly string[];
  readonly requirementIds: readonly string[];
  readonly featureIds: readonly string[];
  readonly paths: readonly string[];
  readonly details: Readonly<Record<string, DiagnosticDetail>>;
}

export interface CompiledTaskStamp {
  readonly taskId: string;
  readonly compiledSliceSha256: string;
  readonly compiledAt: string;
  readonly planEpoch: number;
  readonly passedAllNinePasses: true;
  readonly state: "READY";
}

export interface CompiledPlanSnapshot {
  readonly fingerprint: string;
  readonly planEpoch: number;
  readonly compiledAt: string;
  readonly passCount: 9;
  readonly tasks: readonly CompiledTaskStamp[];
  readonly appliedWaivers: readonly string[];
}

export interface CompilationSuccess {
  readonly ok: true;
  readonly repairRounds: number;
  readonly escalated: false;
  readonly elapsedMs: number;
  readonly diagnostics: readonly CompilationDiagnostic[];
  readonly snapshot: CompiledPlanSnapshot;
  readonly unverifiedRequirements: readonly string[];
  readonly unimplementedRequirements: readonly string[];
  readonly orphanTasks: readonly string[];
}

export interface CompilationFailure {
  readonly ok: false;
  readonly repairRounds: number;
  readonly escalated: true;
  readonly elapsedMs: number;
  readonly diagnostics: readonly CompilationDiagnostic[];
  readonly snapshot: null;
  readonly unverifiedRequirements: readonly string[];
  readonly unimplementedRequirements: readonly string[];
  readonly orphanTasks: readonly string[];
}

export type CompilationResult = CompilationSuccess | CompilationFailure;

export function diagnostic(fields: {
  readonly pass: CompilationDiagnostic["pass"];
  readonly code: string;
  readonly message: string;
  readonly taskIds?: readonly string[];
  readonly requirementIds?: readonly string[];
  readonly featureIds?: readonly string[];
  readonly paths?: readonly string[];
  readonly details?: Readonly<Record<string, DiagnosticDetail>>;
}): CompilationDiagnostic {
  return {
    pass: fields.pass,
    code: fields.code,
    message: fields.message,
    taskIds: fields.taskIds ?? [],
    requirementIds: fields.requirementIds ?? [],
    featureIds: fields.featureIds ?? [],
    paths: fields.paths ?? [],
    details: fields.details ?? {},
  };
}
