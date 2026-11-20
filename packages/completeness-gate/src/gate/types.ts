/**
 * Public shapes for the two-level STATIC_AUDIT gate.
 * Kernel-owned lists (registry, static data, deferrals, write scope, grants)
 * are injected by the caller. They are never read from the worker diff.
 */

export type AuditLevel = "leaf" | "feature";

export type AuditActor = "worker" | "integrator" | "human";

export type CoverageMode = "full" | "reduced_text_only";

export type FindingSeverity = "hard" | "soft";

export type NameKind =
  | "http_route"
  | "page_route"
  | "db_table"
  | "db_column"
  | "db_index"
  | "env_var"
  | "storage_key"
  | "cookie"
  | "event"
  | "permission";

export interface StaticAuditFinding {
  readonly ruleId: string;
  readonly severity: FindingSeverity;
  readonly file: string;
  readonly line: number;
  readonly column: number;
  readonly snippet: string;
  readonly message: string;
  readonly remediation: string;
}

export interface ChangedFile {
  readonly path: string;
  readonly status: "added" | "modified" | "deleted" | "renamed";
  readonly beforeText?: string;
  readonly afterText?: string;
  readonly previousPath?: string;
}

export interface WorkspaceFile {
  readonly path: string;
  readonly content: string;
}

export interface ProducedFunction {
  readonly kind: "function";
  readonly name: string;
  readonly plannedConsumerTaskId?: string;
  readonly allowsConstantReturn?: boolean;
}

export interface ProducedRoute {
  readonly kind: "route";
  readonly name: string;
  readonly routeKind?: "http_route" | "page_route";
}

export interface ProducedOperation {
  readonly kind: "operation";
  readonly name: string;
  readonly method: string;
  readonly path: string;
}

export interface ProducedAria {
  readonly kind: "ui_aria";
  readonly name: string;
}

export type ProducedContract =
  | ProducedFunction
  | ProducedRoute
  | ProducedOperation
  | ProducedAria;

export interface SchemaFieldPlan {
  readonly name: string;
  readonly declarationFile?: string;
  readonly assignedToLaterTaskId?: string;
}

export interface StaticDataDeclaration {
  readonly id: string;
  readonly pathGlob: string;
  readonly source: string;
}

export interface ConflictHunk {
  readonly file: string;
  readonly startLine: number;
  readonly endLine: number;
}

export interface RegisteredName {
  readonly kind: NameKind | string;
  readonly value: string;
  readonly feature: string;
  readonly owner: string;
}

export interface RegistrySnapshot {
  readonly names: readonly RegisteredName[];
}

export interface RegisteredAsset {
  readonly id: string;
  readonly path: string;
  readonly kind?: "image" | "icon" | "font";
}

export interface HumanOverrideRequest {
  readonly signedBy: "developer";
  readonly reason: string;
}

export interface AllowedEscape {
  readonly file: string;
  readonly line: number;
  readonly kind: string;
  readonly noteId: string;
}

export interface HumanOverrideRecord {
  readonly signedBy: "developer";
  readonly reason: string;
  readonly findingCount: number;
}

export interface StaticAuditReceipt {
  readonly lintEscapesCount: number;
  readonly allowedEscapes: readonly AllowedEscape[];
  readonly recordedDeferrals: readonly string[];
  readonly softFindingCount: number;
  readonly fingerprint: string;
  readonly humanOverride: HumanOverrideRecord | null;
  readonly secretHitCount: number;
}

export interface StaticAuditReport {
  readonly level: AuditLevel;
  readonly taskId: string;
  readonly featureId: string;
  readonly actor: AuditActor;
  readonly passed: boolean;
  readonly coverageMode: CoverageMode;
  readonly findings: readonly StaticAuditFinding[];
  readonly softFindings: readonly StaticAuditFinding[];
  readonly receipt: StaticAuditReceipt;
  readonly fingerprint: string;
  readonly overrideApplied: boolean;
  readonly landingSummary: string;
}

export interface LeafAuditInput {
  readonly taskId: string;
  readonly featureId: string;
  readonly actor: AuditActor;
  readonly baseRef: string;
  readonly candidateRef: string;
  readonly files: readonly ChangedFile[];
  readonly workspaceFiles?: readonly WorkspaceFile[];
  readonly produces: readonly ProducedContract[];
  readonly schemaFields: readonly SchemaFieldPlan[];
  readonly staticData: readonly StaticDataDeclaration[];
  readonly approvedDeferralIds: readonly string[];
  readonly excludedGeneratedPaths: readonly string[];
  readonly seedFixturePaths: readonly string[];
  readonly protectedTestPaths: readonly string[];
  readonly protectedTestConfigPaths: readonly string[];
  readonly lockedSnapshotPaths: readonly string[];
  readonly verificationScopeGrant: boolean;
  readonly writeScope: readonly string[];
  readonly integratorConflictHunks: readonly ConflictHunk[];
  readonly declaredSharedFiles: readonly string[];
  readonly errorHandlingRequiresSurface: boolean;
  readonly entryPoints: readonly string[];
  readonly registeredAssets: readonly RegisteredAsset[];
  readonly publicFiles: readonly string[];
  readonly assetModuleSources: readonly string[];
  readonly visibleExampleLiterals: readonly string[];
  readonly taskSizeEstimateLines?: number;
  readonly mustBranchCount?: number;
  readonly deletionDeclared: boolean;
  readonly justifiedTaskNotes: readonly string[];
  readonly registry: RegistrySnapshot;
  readonly vaultSecrets: readonly string[];
  readonly humanOverride?: HumanOverrideRequest;
}

export interface FeatureAuditInput extends LeafAuditInput {
  readonly featureFiles: readonly WorkspaceFile[];
  readonly mergedTaskIds: readonly string[];
  readonly allFeatureTaskIds: readonly string[];
}
