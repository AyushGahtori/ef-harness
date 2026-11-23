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

export interface ExportManifest {
  readonly schemaVersion: number;
  readonly projectId: string;
  readonly exportedAt: string;
  readonly canonicalGraphSha256: string;
  readonly deviceId: string;
  readonly writerEpoch: number;
}

export interface LeaseDocument {
  readonly deviceId: string;
  readonly holder: string;
  readonly epoch: number;
  readonly heartbeat: string;
  readonly revision: number;
  readonly buildActive?: boolean;
}

export interface HarnessStateTree {
  readonly manifest: ExportManifest;
  readonly lease: LeaseDocument;
  readonly entities: readonly ExportEntity[];
  readonly history: readonly HistoryRecord[];
  readonly sealedChecksByPath: Readonly<Record<string, string>>;
  readonly filesByPath: Readonly<Record<string, string>>;
}

export interface RehydratedGraph {
  readonly projectId: string;
  readonly canonicalGraphSha256: string;
  readonly entities: readonly ExportEntity[];
  readonly history: readonly HistoryRecord[];
  readonly writerEpoch: number;
  readonly deviceId: string;
}

export type ProjectOpenMode = "writer" | "read_only_viewer" | "read_only_fenced";

export interface OpenModeDecision {
  readonly mode: ProjectOpenMode;
  readonly message: string;
  readonly remoteEpoch: number;
  readonly localEpoch: number;
}

export interface IndependentOracleAuthorSealerPort {
  regenerateSealedChecksFromSpecs(input: {
    readonly projectId: string;
    readonly entities: readonly ExportEntity[];
    readonly recipientPublicKey: string;
  }): Promise<
    Array<{
      readonly featureId: string;
      readonly path: string;
      readonly ageContent: string;
    }>
  >;
}

export interface GlobalDeviceIdentityPort {
  readDeviceId(): string | null;
  persistDeviceId(deviceId: string): void;
  readDeviceLabel(): string | null;
  persistDeviceLabel(label: string): void;
}

export interface GitCommandPort {
  run(args: readonly string[], cwd: string, input?: string): { readonly stdout: string; readonly status: number };
  readRef(repoPath: string, ref: string): string | null;
}

export const HARNESS_STATE_BRANCH = "refs/heads/harness-state" as const;

export const ENTITY_PATH_PREFIX: Readonly<Record<EntityKind, string>> = {
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

export const CURRENT_SCHEMA_VERSION = 1 as const;
export const SUPPORTED_SCHEMA_VERSIONS: readonly number[] = [1];