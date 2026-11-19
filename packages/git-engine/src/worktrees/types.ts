export const SLOT_OWNER_MARKER_FILE = ".ef-harness-slot-owner" as const;
export const FAILED_SLOT_RETENTION_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_SLOW_WORKTREE_MS = 10_000;
export const DEFAULT_RECOMMENDED_PARALLELISM = 4;
export const LOCKFILE_NAMES = ["pnpm-lock.yaml", "package-lock.json", "yarn.lock"] as const;
export const WARM_DEPENDENCY_EXCLUDES = ["node_modules", ".pnpm-store"] as const;

export type SlotKind = "attempt" | "integration" | "merge";
export type MarkerKind = SlotKind | "project-root";
export type SlotStatus = "active" | "free" | "failed" | "abandoned";
export type ReleaseOutcome = "merged" | "failed" | "abandoned";
export type AttemptBranchState = "created" | "updated" | "left-existing" | "not-applicable";
export type SlotExecutionPurpose = "worker" | "merge-candidate" | "app-preview" | "merge-queue";

export interface SlotOwnerMarker {
  readonly v: 1;
  readonly projectId: string;
  readonly slotId: string | null;
  readonly kind: MarkerKind;
}

export interface EnvironmentManifest {
  readonly allowlistedConfigFiles?: readonly string[];
  readonly preserveIgnored?: readonly string[];
  readonly vaultNames?: readonly string[];
  readonly sourceRoot?: string;
}

export interface ResolvedEnvironmentManifest {
  readonly allowlistedConfigFiles: readonly string[];
  readonly preserveIgnored: readonly string[];
  readonly vaultNames: readonly string[];
  readonly sourceRoot: string | null;
}

export interface SparseCheckoutRequest {
  readonly readSet: readonly string[];
  readonly sharedPackages: readonly string[];
}

export interface AcquireSlotRequest {
  readonly projectId: string;
  readonly mainRepoPath: string;
  readonly baseCommit: string;
  readonly taskId: string;
  readonly attempt: string | number;
  readonly taskPaths?: readonly string[];
  readonly sparse?: SparseCheckoutRequest;
  readonly environmentManifest?: EnvironmentManifest;
  readonly beforeSlotReset?: (slotPath: string) => void | Promise<void>;
}

export interface ResetSlotRequest {
  readonly projectId: string;
  readonly slotId: string;
  readonly mainRepoPath: string;
  readonly baseCommit: string;
  readonly taskId: string;
  readonly attempt: string | number;
  readonly taskPaths?: readonly string[];
  readonly sparse?: SparseCheckoutRequest;
  readonly environmentManifest?: EnvironmentManifest;
  readonly beforeSlotReset?: (slotPath: string) => void | Promise<void>;
}

export interface ReleaseSlotRequest {
  readonly projectId: string;
  readonly mainRepoPath: string;
  readonly slotId: string;
  readonly outcome: ReleaseOutcome;
  readonly beforeSlotReset?: (slotPath: string) => void | Promise<void>;
}

export interface AcquireMergeWorktreeRequest {
  readonly projectId: string;
  readonly mainRepoPath: string;
  readonly baseCommit: string;
  readonly purpose: "feature-integrator" | "project-integrator";
  readonly taskPaths?: readonly string[];
  readonly sparse?: SparseCheckoutRequest;
  readonly environmentManifest?: EnvironmentManifest;
}

export interface EnsureIntegrationWorktreeRequest {
  readonly projectId: string;
  readonly mainRepoPath: string;
  readonly baseCommit?: string;
}

export interface IntegrationLease {
  readonly holderId: string;
  readonly epoch: number;
}

export interface IntegrationLeaseProof {
  readonly holderId: string;
  readonly epoch: number;
  readonly role: string;
}

export interface FastForwardIntegrationRequest {
  readonly projectId: string;
  readonly mainRepoPath: string;
  readonly newSha: string;
  readonly lease: IntegrationLeaseProof;
}

export interface RepairWorktreesRequest {
  readonly projectId: string;
  readonly mainRepoPath: string;
}

export interface PruneStaleWorktreesRequest {
  readonly projectId: string;
  readonly mainRepoPath: string;
}

export interface ReconcileWorktreesRequest {
  readonly projectId: string;
  readonly mainRepoPath: string;
}

export interface SlotHandle {
  readonly projectId: string;
  readonly projectShortId: string;
  readonly slotId: string;
  readonly slotPath: string;
  readonly kind: SlotKind;
  readonly mainRepoPath: string;
  readonly baseCommit: string;
  readonly headCommit: string;
  readonly branch: string | null;
  readonly headMode: "detached";
  readonly reused: boolean;
  readonly nodeModulesPreserved: boolean;
  readonly lockfileChanged: boolean;
  readonly dependencySyncRequested: boolean;
  readonly recommendSparseCheckout: boolean;
  readonly recommendedParallelism: number;
  readonly worktreeAddDurationMs: number;
  readonly attemptBranchState: AttemptBranchState;
  readonly recreatedFromCheckpoint: string | null;
}

export interface RecoveryRecord {
  readonly slotId: string;
  readonly slotPath: string;
  readonly action: "fence_and_recreate";
  readonly checkpointRef: string | null;
  readonly checkpointSha: string | null;
  readonly headCommit: string;
}

export interface ReconcileResult {
  readonly recovered: readonly RecoveryRecord[];
}

export interface PruneResult {
  readonly recycledSlotIds: readonly string[];
  readonly recovered: readonly RecoveryRecord[];
}

export interface FastForwardResult {
  readonly slotPath: string;
  readonly previousSha: string;
  readonly newSha: string;
  readonly dirtyBefore: boolean;
  readonly restartedPreview: true;
}

export interface RepairWorktreesResult {
  readonly mainRepoPath: string;
  readonly repairedSlots: readonly {
    readonly slotId: string;
    readonly slotPath: string;
    readonly headCommit: string;
  }[];
}

export interface IntegrationAdvancedEvent {
  readonly type: "integration_worktree_advanced";
  readonly projectId: string;
  readonly slotPath: string;
  readonly previousSha: string;
  readonly newSha: string;
  readonly restartPreview: true;
}

export interface DependencySyncRequest {
  readonly projectId: string;
  readonly slotPath: string;
  readonly reason: "lockfile_changed";
  readonly oldHash: string;
  readonly newHash: string;
}

export interface WorktreeLogEvent {
  readonly code: string;
  readonly message: string;
  readonly details: Readonly<Record<string, string | number | boolean | null>>;
}

export interface WorktreeLogger {
  warn(event: WorktreeLogEvent): void;
  info(event: WorktreeLogEvent): void;
}

export interface RejectedConfigPath {
  readonly path: string;
  readonly reason: "env_file" | "pem" | "key" | "vault_name" | "path_traversal" | "absolute";
}
