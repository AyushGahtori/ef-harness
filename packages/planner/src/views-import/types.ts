/**
 * Shared types for the Markdown direct-edit importer.
 * Sibling contracts (Task 009, 017, 085, 087) are not on this base.
 * The shapes below are the local ports those tasks will replace.
 */

export const NODE_STATUSES = ["draft", "active", "retired", "superseded"] as const;
export type NodeStatus = (typeof NODE_STATUSES)[number];

/** Workflow values that appear in ef-fields. `in_progress` is not a nodes.status column value. */
export const WORKFLOW_STATUSES = ["draft", "active", "retired", "superseded", "in_progress"] as const;
export type WorkflowStatus = (typeof WORKFLOW_STATUSES)[number];

export const SETTLED_BASES = [
  "explicit",
  "derived",
  "delegated",
  "defaulted",
  "proposed",
  "observed",
] as const;
export type SettledBasis = (typeof SETTLED_BASES)[number];

export const CHANGE_CLASSES = [
  "cosmetic",
  "clarifying",
  "compatible",
  "breaking",
  "created",
  "retired",
] as const;
export type ChangeClass = (typeof CHANGE_CLASSES)[number];

export const CHANGE_ORIGINS = [
  "chat",
  "markdown_edit",
  "research",
  "planner",
  "sweep",
  "undo",
  "intake",
  "kernel",
  "import",
] as const;
export type ChangeOrigin = (typeof CHANGE_ORIGINS)[number];

export const NODE_KINDS = [
  "decision",
  "spec_item",
  "edge_case",
  "rule",
  "journey",
  "contract",
  "arch_node",
  "research_fact",
  "plan",
  "feature",
  "task",
  "check",
  "waiver",
  "ccr",
  "source",
  "asset",
  "comment",
] as const;
export type NodeKind = (typeof NODE_KINDS)[number];

/** Closed 28 touches tags. Local port of Task 010 until the shared-contracts barrel exports them. */
export const TOUCHES_TAGS = [
  "personal_data",
  "credentials",
  "money",
  "user_content",
  "authn",
  "authz",
  "session",
  "scheduling",
  "time_display",
  "file_upload",
  "file_download",
  "external_api",
  "inbound_webhook",
  "outbound_message",
  "background_job",
  "realtime",
  "destructive_write",
  "bulk_write",
  "migration",
  "search",
  "form_input",
  "route",
  "interactive_ui",
  "logging",
  "config_env",
  "caching",
  "rate_limited",
  "concurrent_edit",
] as const;
export type TouchesTag = (typeof TOUCHES_TAGS)[number];

export const RELATION_KEYS = [
  "links",
  "implements",
  "consumes",
  "consumes_contract",
  "belongs_to",
  "derived_from",
  "verifies",
  "depends_on",
  "obeys",
  "handles_edge_case",
  "produces_contract",
  "waives",
  "documents",
  "cites",
] as const;

export const MARKDOWN_ACTOR = "user:markdown_view" as const;
export const MARKDOWN_SOURCE = "markdown_direct_edit" as const;

export type FieldValue =
  | string
  | number
  | boolean
  | null
  | FieldValue[]
  | { [key: string]: FieldValue };

export type FieldMap = { [key: string]: FieldValue };

export interface GraphNode {
  readonly id: string;
  readonly kind: string;
  readonly version: number;
  readonly contentHash: string;
  readonly title: string;
  readonly text: string;
  readonly fields: FieldMap;
  readonly status: NodeStatus;
  readonly feature: string | null;
  readonly basis: string | null;
  readonly changeSetId: string;
  readonly createdRev: number;
  readonly updatedRev: number;
}

export interface GraphEdge {
  readonly src: string;
  readonly type: string;
  readonly dst: string;
}

export interface NameRecord {
  readonly kind: string;
  readonly value: string;
  readonly ownerNode: string;
}

export interface NodeCreate {
  readonly op: "create";
  readonly id: string;
  readonly kind: string;
  readonly title: string;
  readonly text?: string;
  readonly fields?: FieldMap;
  readonly status?: NodeStatus;
}

export interface NodeUpdate {
  readonly op: "update";
  readonly id: string;
  readonly class: ChangeClass;
  readonly expectedVersion: number;
  readonly title?: string;
  readonly text?: string;
  readonly fields?: FieldMap;
  readonly status?: NodeStatus;
}

export interface NodeRetire {
  readonly op: "retire";
  readonly id: string;
  readonly expectedVersion: number;
  readonly status?: "retired" | "superseded";
}

export type NodeMutation = NodeCreate | NodeUpdate | NodeRetire;

export interface EdgeCreate {
  readonly op: "create";
  readonly src: string;
  readonly type: string;
  readonly dst: string;
}

export interface EdgeRetire {
  readonly op: "retire";
  readonly src: string;
  readonly type: string;
  readonly dst: string;
}

export type EdgeMutation = EdgeCreate | EdgeRetire;

export interface ChangeSetProposal {
  readonly id?: string;
  readonly origin: ChangeOrigin;
  readonly originRef?: string;
  readonly author: string;
  readonly summary?: string;
  readonly createdAt?: number;
  readonly nodes?: readonly NodeMutation[];
  readonly edges?: readonly EdgeMutation[];
}

export interface CommitResult {
  readonly rev: number;
  readonly changeSetId: string;
  readonly noop: boolean;
}

export interface ChangeSetRecord {
  readonly id: string;
  readonly rev: number;
  readonly origin: string;
  readonly author: string;
  readonly summary: string;
  readonly createdAt: number;
  readonly originRef: string | null;
}

export interface NodeVersionRecord {
  readonly id: string;
  readonly version: number;
  readonly title: string;
  readonly text: string;
  readonly fields: FieldMap;
  readonly status: string;
  readonly changeSetId: string;
  readonly contentHash: string;
}

export interface TaskRuntimeRecord {
  readonly task: string;
  readonly state: string;
  readonly epoch: number;
  readonly feature: string;
}

/**
 * Local port of Task 017 `KnowledgeGraphRepo`.
 * Swap `LocalSqliteKnowledgeGraph` for the published repo when Task 017 is integrated.
 * Callers only need the methods the importer uses.
 */
export interface KnowledgeGraphRepo {
  getNode(id: string): GraphNode | null;
  getNodeVersion(id: string, version: number): GraphNode | null;
  listNodeIds(): readonly string[];
  listCurrentEdges(): readonly GraphEdge[];
  listNames(ownerNode: string): readonly NameRecord[];
  currentRevision(): number;
  commitChangeSet(proposal: ChangeSetProposal): CommitResult;
  listChangeSets(): readonly ChangeSetRecord[];
  listNodeVersions(id: string): readonly NodeVersionRecord[];
  taskRuntime(taskId: string): TaskRuntimeRecord | null;
  close(): void;
}

export interface ManifestNodeRecord {
  readonly filePath: string;
  readonly nodeId: string;
  readonly exportedRev: number;
  readonly nodeVersion: number;
  readonly contentSha256: string;
  readonly fieldsSha256: string;
  readonly proseSha256: string;
  readonly exportedAt: number;
}

export interface ManifestFileRecord {
  readonly filePath: string;
  readonly contentSha256: string;
  readonly exportedAt: number;
  readonly exportedRev: number;
  readonly featureId: string | null;
  readonly efFile: string;
  readonly title: string;
  readonly nodeIds: readonly string[];
}

export interface ViewManifest {
  readonly files: readonly ManifestFileRecord[];
  readonly nodes: readonly ManifestNodeRecord[];
}

export interface DiskDelta {
  readonly filePath: string;
  readonly reason: "content_mismatch" | "missing" | "untracked";
  readonly manifestSha256: string | null;
  readonly diskSha256: string | null;
}

/** Local port of Task 085 `ViewManifestHashScanner`. */
export interface ViewManifestHashScanner {
  scan(viewsRoot: string, manifest: ViewManifest): readonly DiskDelta[];
}

/** Local port of Task 085 `ExportPauseLock`. */
export interface ExportPauseLock {
  acquire(filePath: string, reason: string): void;
  release(filePath: string): void;
  isHeld(filePath: string): boolean;
  heldFiles(): readonly string[];
  reason(filePath: string): string | null;
}

export interface DocImportProposal {
  readonly kind: "new_node" | "update" | "new_edge" | "note";
  readonly target_id: string | null;
  readonly node_type: string | null;
  readonly fields: readonly { readonly key: string; readonly value: string | number | boolean | null }[];
  readonly text: string;
  readonly confidence: number;
}

export interface DocImportSuccess {
  readonly blocked: false;
  readonly changeClass: "cosmetic" | "semantic";
  readonly proposals: readonly DocImportProposal[];
}

export interface DocImportBlocked {
  readonly blocked: true;
  readonly reason: string;
}

export type DocImportV1 = DocImportSuccess | DocImportBlocked;

/**
 * Invocation shape required by Task 086.
 * Task 009's published success object is `{ proposals }` plus an honest blocked exit.
 * This port also requires `changeClass` because the importer must separate cosmetic from semantic.
 */
export interface DocImportRequest {
  readonly baseProse: string;
  readonly editedProse: string;
  readonly currentFields: FieldMap;
  readonly validNodeIds: readonly string[];
}

export interface DocImportModel {
  complete(input: DocImportRequest): DocImportV1;
}

export interface AcceptedMutation {
  readonly nodeId: string;
  readonly filePath: string;
  readonly changeClass: ChangeClass;
  readonly invalidateTasks: boolean;
  readonly diff: string;
}

/** Local port of Task 087. The importer feeds accepted mutations; it does not run impact_walk. */
export interface RevisionFeedPort {
  accept(batch: { readonly changeSetId: string; readonly mutations: readonly AcceptedMutation[] }): void;
}

export interface ImpactEdge {
  readonly src: string;
  readonly type: string;
  readonly dst: string;
}

export interface ImpactPreview {
  readonly nodeId: string;
  readonly summary: string;
  readonly edges: readonly ImpactEdge[];
}

export type ConflictAction = "keep_mine" | "keep_current" | "edit_merged";

export interface ImportConflictCard {
  readonly cardId: string;
  readonly kind: "field" | "prose" | "title";
  readonly filePath: string;
  readonly nodeId: string;
  readonly field: string;
  readonly base: FieldValue | null;
  readonly basePresent: boolean;
  readonly yourEdit: FieldValue | null;
  readonly yourEditPresent: boolean;
  readonly currentDb: FieldValue | null;
  readonly currentDbPresent: boolean;
  readonly actions: readonly ConflictAction[];
  readonly summary: string;
}

export interface DeleteConfirmation {
  readonly cardId: string;
  readonly kind: "delete";
  readonly filePath: string;
  readonly nodeId: string;
  readonly title: string;
  readonly message: string;
  readonly prompt: "Restore or Deprecate?";
  readonly actions: readonly ["deprecate", "restore"];
  readonly impact: ImpactPreview;
}

export interface MoveConfirmation {
  readonly cardId: string;
  readonly kind: "move";
  readonly nodeId: string;
  readonly fromFile: string;
  readonly toFile: string;
  readonly fromFeatureId: string | null;
  readonly toFeatureId: string | null;
  readonly message: string;
  readonly actions: readonly ["confirm_move", "cancel_move"];
}

export interface MangledMarkerConfirmation {
  readonly cardId: string;
  readonly kind: "mangled_marker";
  readonly filePath: string;
  readonly nodeId: string;
  readonly heading: string;
  readonly similarity: number;
  readonly message: string;
  readonly actions: readonly ["reattach", "create_new"];
}

export interface ImportConfirmation {
  readonly cardId: string;
  readonly kind: "semantic_fields" | "new_node";
  readonly filePath: string;
  readonly nodeId: string | null;
  readonly heading: string | null;
  readonly message: string;
  readonly changeClass: "semantic";
  readonly proposals: readonly DocImportProposal[];
  readonly actions: readonly ["confirm", "reject"];
}

export interface SyntaxBanner {
  readonly filePath: string;
  readonly line: number;
  readonly message: string;
  readonly banner: string;
}

export interface SchemaBanner {
  readonly filePath: string;
  readonly nodeId: string | null;
  readonly line: number | null;
  readonly message: string;
}

export type Resolution =
  | { readonly cardId: string; readonly action: "keep_mine" }
  | { readonly cardId: string; readonly action: "keep_current" }
  | { readonly cardId: string; readonly action: "edit_merged"; readonly value: FieldValue }
  | { readonly cardId: string; readonly action: "deprecate" }
  | { readonly cardId: string; readonly action: "restore" }
  | { readonly cardId: string; readonly action: "confirm" }
  | { readonly cardId: string; readonly action: "reject" }
  | { readonly cardId: string; readonly action: "confirm_move" }
  | { readonly cardId: string; readonly action: "cancel_move" }
  | { readonly cardId: string; readonly action: "reattach" }
  | { readonly cardId: string; readonly action: "create_new" };

export interface ImportSession {
  readonly id: string;
  readonly committedChangeSetId: string | null;
  readonly committedRevision: number | null;
  readonly locksHeld: readonly string[];
  readonly conflicts: readonly ImportConflictCard[];
  readonly confirmations: readonly ImportConfirmation[];
  readonly deletions: readonly DeleteConfirmation[];
  readonly moves: readonly MoveConfirmation[];
  readonly mangled: readonly MangledMarkerConfirmation[];
  readonly syntaxErrors: readonly SyntaxBanner[];
  readonly schemaErrors: readonly SchemaBanner[];
  readonly modelErrors: readonly SchemaBanner[];
  readonly autoCommittedFiles: readonly string[];
  readonly pendingFiles: readonly string[];
  readonly blockedBatch: boolean;
}
