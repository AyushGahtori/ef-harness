import type { DATA_DROP, DATA_KEEP_DORMANT, MODE_FAST_PATH, MODE_SURGICAL } from "./constants.js";

export type DataHandlingChoice = typeof DATA_KEEP_DORMANT | typeof DATA_DROP;
export type UndoExecutionMode = typeof MODE_FAST_PATH | typeof MODE_SURGICAL;
export type DependentChoice = "undo_together" | "cancel";

export type ArtifactKind =
  | "file"
  | "route"
  | "screen"
  | "handler"
  | "test"
  | "component"
  | "helper"
  | "table"
  | "column"
  | "migration"
  | "package"
  | "permission"
  | "external_effect";

export type UsageEdgeType = "consumes" | "consumes_contract" | "depends_on" | "implements";
export type FileStatus = "A" | "M" | "D";

export interface FileChange {
  readonly path: string;
  readonly status: FileStatus;
}

export interface EfTrailers {
  readonly feature: string;
  readonly tasks: readonly string[];
  readonly requirements: readonly string[];
  readonly checksPassed: string;
  readonly harnessVersion: string;
}

export interface FeatureRecord {
  readonly featureId: string;
  readonly title: string;
  readonly lifecycle: string;
  readonly nodeStatus: string;
  readonly branch: string;
  readonly mergeSha: string;
  readonly specs: string;
  readonly decisions: readonly string[];
  readonly taskIds: readonly string[];
  readonly landed: boolean;
  readonly previousLifecycle: string;
}

export interface FeatureRegistration {
  readonly featureId: string;
  readonly title: string;
  readonly lifecycle: string;
  readonly branch: string;
  readonly mergeSha?: string;
  readonly specs?: string;
  readonly decisions?: readonly string[];
  readonly taskIds?: readonly string[];
  readonly landed: boolean;
}

export interface UsageEdge {
  readonly src: string;
  readonly type: UsageEdgeType;
  readonly dst: string;
  readonly artifactPath: string;
}

export interface InboxQuestion {
  readonly id: string;
  readonly featureId: string;
  readonly exclusive: boolean;
  readonly status: "open" | "retired";
  readonly text: string;
}

export interface WorkerRecord {
  readonly id: string;
  readonly featureId: string;
  readonly pid: number;
  readonly halted: boolean;
}

export interface OwnershipRecord {
  readonly path: string;
  readonly ownerFeatureId: string;
  readonly previousOwner: string;
}

export interface ClassifiedArtifact {
  readonly path: string;
  readonly kind: ArtifactKind;
  readonly symbol: string;
  readonly status: FileStatus;
  readonly bucket: "exclusive" | "shared" | "persistent_data";
  readonly referencedBy: readonly string[];
  readonly reasons: readonly string[];
}

export interface UndoInventory {
  readonly featureId: string;
  readonly title: string;
  readonly landed: boolean;
  readonly inFlight: boolean;
  readonly mergeSha: string;
  readonly nonFastForward: boolean;
  readonly exclusive: readonly ClassifiedArtifact[];
  readonly shared: readonly ClassifiedArtifact[];
  readonly persistentData: readonly ClassifiedArtifact[];
  readonly exclusiveRatio: number;
  readonly fastPathCandidate: boolean;
  readonly revertConflicts: readonly string[];
  readonly laterOverlapPaths: readonly string[];
  readonly hardDependents: readonly string[];
  readonly externalEffects: readonly string[];
  readonly llmTokens: 0;
}

export interface OwnershipTransfer {
  readonly path: string;
  readonly fromFeatureId: string;
  readonly toFeatureId: string;
  readonly reason: string;
}

export interface UndoPreview {
  readonly featureId: string;
  readonly plainEnglish: string;
  readonly filesToRemove: readonly string[];
  readonly routesToRemove: readonly string[];
  readonly testsToRemove: readonly string[];
  readonly sharedHelpers: readonly string[];
  readonly sharedTables: readonly string[];
  readonly transfers: readonly OwnershipTransfer[];
  readonly dataChoiceDefault: typeof DATA_KEEP_DORMANT;
  readonly dataOptions: readonly [typeof DATA_KEEP_DORMANT, typeof DATA_DROP];
  readonly executionMode: UndoExecutionMode;
  readonly hardDependents: readonly string[];
  readonly dependentChoices: readonly string[];
  readonly externalEffects: readonly string[];
  readonly llmTokens: 0;
}

export interface UndoChoice {
  readonly apply: boolean;
  readonly dataHandling?: DataHandlingChoice;
  readonly destructiveConfirmation?: boolean;
  readonly dependents?: DependentChoice;
}

export interface StaticAuditReport {
  readonly ok: boolean;
  readonly deadNav: readonly string[];
  readonly danglingImports: readonly string[];
  readonly orphanPermissions: readonly string[];
}

export interface RegressionReport {
  readonly ok: boolean;
  readonly remainingFeatures: readonly string[];
  readonly failed: readonly string[];
  readonly passed: readonly string[];
  readonly llmTokens: 0;
  readonly audit: StaticAuditReport;
}

export type UndoMode =
  | "fast_path_revert"
  | "surgical_removal"
  | "in_flight_cancel"
  | "blocked"
  | "cancelled";

export interface UndoResult {
  readonly landed: boolean;
  readonly mode: UndoMode;
  readonly commitSha: string;
  readonly previousSha: string;
  readonly integrationSha: string;
  readonly integrationUnchanged: boolean;
  readonly llmTokens: 0;
  readonly featureIds: readonly string[];
  readonly nodeStatus: string;
  readonly audit: StaticAuditReport;
  readonly regression: RegressionReport | null;
  readonly transfers: readonly OwnershipTransfer[];
  readonly preview: UndoPreview;
  readonly blockedReason: string;
  readonly elapsedMs: number;
  readonly historyRewritten: false;
  readonly commands: readonly string[];
  readonly haltedWorkerIds: readonly string[];
  readonly retiredQuestionIds: readonly string[];
}

export interface ReviveRequest {
  readonly featureId?: string;
  readonly text?: string;
}

export interface ReviveResult {
  readonly featureId: string;
  readonly title: string;
  readonly nodeStatus: string;
  readonly lifecycle: string;
  readonly specs: string;
  readonly decisions: readonly string[];
  readonly mergeSha: string;
  readonly revived: boolean;
}
