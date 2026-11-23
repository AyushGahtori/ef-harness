export type EntityKind =
  | "decision"
  | "requirement"
  | "entity"
  | "contract"
  | "feature"
  | "screen"
  | "rule"
  | "task"
  | "edge";

export interface ExportEntity {
  readonly id: string;
  readonly kind: EntityKind;
  readonly fields: Record<string, unknown>;
  readonly title?: string;
  readonly text?: string;
  readonly revision: number;
  readonly deleted?: boolean;
}

export interface HistoryRecord {
  readonly changeId: string;
  readonly entityId: string;
  readonly revision: number;
  readonly at: string;
  readonly summary: string;
}

export interface SealedHiddenCheck {
  readonly featureId: string;
  readonly requirementId: string;
  readonly id: string;
  readonly contentJson: string;
}

export interface LeaseSnapshot {
  readonly deviceId: string;
  readonly holder: string;
  readonly epoch: number;
  readonly heartbeat: string;
  readonly revision: number;
}

export interface ExportManifest {
  readonly schemaVersion: 1;
  readonly projectId: string;
  readonly exportedAt: string;
  readonly canonicalGraphSha256: string;
  readonly deviceId: string;
  readonly writerEpoch: number;
}

export interface ExportState {
  readonly lastExportedRevisionByEntity: Readonly<Record<string, number>>;
  readonly lastCanonicalGraphSha256: string | null;
  readonly lastHarnessStateCommit: string | null;
  readonly lastBlobShasByPath: Readonly<Record<string, string>>;
}

export interface KnowledgeGraphSnapshot {
  readonly projectId: string;
  readonly deviceId: string;
  readonly writerEpoch: number;
  readonly entities: readonly ExportEntity[];
  readonly history: readonly HistoryRecord[];
  readonly lease: LeaseSnapshot;
  readonly canonicalGraphSha256: string;
}

export interface HiddenCheckPoolPort {
  listSealedForFeatures(featureIds: readonly string[]): readonly SealedHiddenCheck[];
}

export interface KnowledgeGraphRepoPort {
  loadExportSnapshot(): KnowledgeGraphSnapshot;
  readExportState(): ExportState;
  writeExportState(state: ExportState): void;
}

export interface CanonicalHashPort {
  sha256Hex(bytes: Uint8Array): string;
}

export interface PacketSecurityRedactorPort {
  scan(text: string): { readonly clean: boolean; readonly preview: string };
}

export interface MinGitRepoInspectorPort {
  run(args: readonly string[], cwd: string, input?: string): { readonly stdout: string; readonly status: number };
  readRef(repoPath: string, ref: string): string | null;
}

export interface GitHubRepoVisibility {
  readonly owner: string;
  readonly repo: string;
  readonly private: boolean;
  readonly visibility: "public" | "private" | "internal";
}

export interface GitHubAuthConnectorPort {
  remoteVisibility(owner: string, repo: string): Promise<GitHubRepoVisibility>;
}

export interface FastImportFileOp {
  readonly path: string;
  readonly mode: "add" | "modify" | "delete";
  readonly content?: string;
}

export interface HarnessStatePushPreference {
  readonly remote: string;
  readonly harnessStatePushAllowed: boolean;
  readonly askedOnce: boolean;
}

export const HARNESS_STATE_BRANCH = "refs/heads/harness-state" as const;
export const EXPORT_QUIET_DEBOUNCE_MS = 10_000 as const;
export const HISTORY_SEGMENT_MAX_BYTES = 2 * 1024 * 1024;

export const ENTITY_PATHS: Readonly<Record<EntityKind, string>> = {
  decision: "decisions",
  requirement: "requirements",
  entity: "entities",
  contract: "contracts",
  feature: "features",
  screen: "screens",
  rule: "rules",
  task: "tasks",
  edge: "edges",
};