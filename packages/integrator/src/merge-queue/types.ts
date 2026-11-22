import type { DoneConditionId, QueueStatus } from "./constants.js";

export interface FeatureCanonicalSpec {
  readonly id: string;
  readonly title: string;
  readonly text: string;
  readonly contracts: readonly { readonly id: string; readonly text: string }[];
}

export interface TaskSnapshot {
  readonly id: string;
  readonly state: string;
  readonly briefVersion: number;
  readonly acceptedBriefVersion: number;
  readonly contracts: readonly { readonly id: string; readonly pin: number; readonly currentVersion: number }[];
}

export interface RequirementSnapshot {
  readonly id: string;
  readonly kind: string;
  readonly status: string;
}

export interface CheckSnapshot {
  readonly id: string;
  readonly gate: "static_audit" | "feature_journey" | "sealed_step_3b";
  readonly version: number;
  readonly status: string;
}

export interface DoneSnapshot {
  readonly tasks: readonly TaskSnapshot[];
  readonly requirements: readonly RequirementSnapshot[];
  readonly scopes: readonly string[];
  readonly checks: readonly CheckSnapshot[];
  readonly screenBearing: boolean;
  readonly openCcrIds: readonly string[];
  readonly earlierDoneFeatureIds: readonly string[];
}

export interface FeatureDoneEvidenceInput {
  readonly feature: string;
  readonly staticAudit: {
    readonly clean: boolean;
    readonly integratorCommitsIncluded: boolean;
    readonly paths: readonly string[];
  };
  readonly journey: {
    readonly passed: boolean;
    readonly entryPoint: string;
    readonly cleanEnvironment: boolean;
  };
  readonly integrationMerge: {
    readonly ref: string;
    readonly mergeCommit: string;
    readonly earlierDoneRegressionGreen: boolean;
    readonly regressedFeatureIds: readonly string[];
  };
  readonly accessibility: {
    readonly seriousFindingIds: readonly string[];
  };
}

export interface FeatureDoneCheckResult {
  readonly ok: boolean;
  readonly failedConditions: readonly DoneConditionId[];
  readonly blockingCcrIds: readonly string[];
  readonly failingRequirements: readonly string[];
}

export interface MergeFeatureRequest {
  readonly featureId: string;
  readonly featureRef: string;
  readonly priority?: number;
  readonly spec: FeatureCanonicalSpec;
  readonly snapshot: DoneSnapshot;
  readonly taskIds: readonly string[];
  readonly requirementIds: readonly string[];
  readonly checkIds: readonly string[];
  readonly journeyEntryPoint: string;
  readonly staticAuditPaths: readonly string[];
  readonly seriousFindingIds?: readonly string[];
}

export interface QueuedFeature {
  readonly id: string;
  readonly featureId: string;
  readonly featureRef: string;
  readonly priority: number;
  readonly sequence: number;
  readonly status: QueueStatus;
  readonly phase: string;
  readonly evictionCount: number;
  readonly failureTrace: string;
  readonly request: MergeFeatureRequest;
  readonly mergeSha: string;
}

export interface EfTrailers {
  readonly feature: string;
  readonly tasks: readonly string[];
  readonly requirements: readonly string[];
  readonly checksPassed: string;
  readonly harnessVersion: string;
}

export interface FailingCheck {
  readonly id: string;
  readonly owners: readonly string[];
  readonly trace: string;
  readonly step: string;
}

export interface ConflictHunk {
  readonly path: string;
  readonly ours: readonly string[];
  readonly theirs: readonly string[];
  readonly contextBefore: readonly string[];
  readonly contextAfter: readonly string[];
}

export interface MigrationStatement {
  readonly file: string;
  readonly kind: string;
  readonly name: string;
  readonly table: string;
  readonly column: string;
  readonly references: string;
  readonly sql: string;
}

export interface MigrationIssue {
  readonly code: "sequence_collision" | "fk_order" | "duplicate_object" | "column_clash";
  readonly detail: string;
  readonly files: readonly string[];
}

export interface OffendingCommit {
  readonly featureId: string;
  readonly sha: string;
  readonly subject: string;
}

export interface ProjectIntegratorSuccess {
  readonly migrations_order: readonly string[];
  readonly ccr_decisions: readonly {
    readonly id: string;
    readonly class: "additive" | "breaking";
    readonly decision: "approve" | "revise";
  }[];
  readonly rerun_suites: readonly string[];
}

export interface ProjectIntegratorBlocked {
  readonly blocked: true;
  readonly reason: string;
  readonly missing_ids?: readonly string[];
}

export type ProjectIntegratorV1 = ProjectIntegratorSuccess | ProjectIntegratorBlocked;

export interface FileReplacement {
  readonly path: string;
  readonly text: string | null;
}

export interface IntegratorPromptInput {
  readonly attempt: number;
  readonly featureIds: readonly string[];
  readonly conflicts: readonly ConflictHunk[];
  readonly specs: readonly FeatureCanonicalSpec[];
  readonly migrationAst: string;
  readonly migrationIssues: readonly MigrationIssue[];
  readonly failingChecks: readonly FailingCheck[];
  readonly offendingCommits: readonly OffendingCommit[];
  /** Local executor view. The model-facing prompt never includes these bodies. */
  readonly treeFiles?: readonly { readonly path: string; readonly text: string }[];
}

export interface IntegratorCandidate {
  readonly output: unknown;
  readonly files?: readonly FileReplacement[];
}

export type ProjectIntegratorModel = (input: IntegratorPromptInput & { readonly prompt: string }) => IntegratorCandidate;

export interface GateStepResult {
  readonly step: string;
  readonly ok: boolean;
  readonly trace: string;
  readonly durationMs: number;
}

export interface GateResult {
  readonly ok: boolean;
  readonly steps: readonly GateStepResult[];
  readonly failingChecks: readonly FailingCheck[];
  readonly durationMs: number;
  readonly staticAuditClean: boolean;
  readonly journeyPassed: boolean;
  readonly regressionPassed: boolean;
  readonly parallel: true;
  readonly coveredFeatureIds: readonly string[];
}

export interface PreviewReloadEvent {
  readonly kind: "preview-reload";
  readonly featureIds: readonly string[];
  readonly integrationSha: string;
  readonly restartPreview: true;
}

export interface Escalation {
  readonly to: "task-112" | "developer";
  readonly featureIds: readonly string[];
  readonly specs: readonly FeatureCanonicalSpec[];
  readonly attempts: number;
  readonly trace: string;
  readonly failingChecks: readonly FailingCheck[];
}

export interface LandedFeature {
  readonly featureId: string;
  readonly mergeSha: string;
  readonly done: true;
  readonly failedConditions: readonly DoneConditionId[];
  readonly trailers: EfTrailers;
  readonly parents: readonly string[];
}

export interface EvictedFeature {
  readonly featureId: string;
  readonly phase: "INTEGRATING";
  readonly evictionCount: number;
  readonly trace: string;
  readonly kind: "gate" | "contract_clash" | "done_refused";
}

export interface DrainReport {
  readonly blocked: "lease_held" | null;
  readonly landed: readonly LandedFeature[];
  readonly evicted: readonly EvictedFeature[];
  readonly escalations: readonly Escalation[];
  readonly integrationSha: string;
}

export interface RecoveryReport {
  readonly requeued: readonly string[];
  readonly reconciledLanded: readonly string[];
  readonly removedWorktrees: readonly string[];
  readonly integrationSha: string;
}

export interface AcquiredLease {
  readonly ref: string;
  readonly holder: string;
  readonly epoch: number;
  readonly expectedSha: string;
}

export type CasAdvanceResult =
  | { readonly ok: true; readonly sha: string }
  | { readonly ok: false; readonly reason: "cas_mismatch"; readonly actualSha: string };

export interface SlotHandle {
  readonly slotPath: string;
  readonly baseCommit: string;
  readonly headMode: "detached";
  readonly kind: "merge";
}
