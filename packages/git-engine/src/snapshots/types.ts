/**
 * Public contracts for the temporary-index dirty-work snapshotter.
 *
 * `SnapshotGitRunner.execGit` matches Task 035 `execGit(options)`.
 * `GitSafetyScannerPort` matches Task 036 `SafetyScanReport` fields used to block
 * a snapshot. Inject the real scanner through `adaptWorkingTreeScanner`.
 */

export const SNAPSHOT_COMMIT_SUBJECT = "harness: snapshot of uncommitted work";
export const CHECKPOINT_COMMIT_SUBJECT = "harness: checkpoint of attempt work";
export const HARNESS_KERNEL_NAME = "Harness Kernel";
export const HARNESS_KERNEL_EMAIL = "kernel@harness.local";
export const LARGE_FILE_BYTES = 50 * 1024 * 1024;
export const SNAPSHOT_REF_PREFIX = "refs/harness/snapshots";
export const CHECKPOINT_REF_PREFIX = "refs/harness/checkpoints";
export const ZERO_OID = "0000000000000000000000000000000000000000";
export const EMPTY_TREE_OID = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

export interface SnapshotGitRequest {
  readonly args: readonly string[];
  readonly cwd: string;
  readonly timeoutMs?: number;
  readonly env?: NodeJS.ProcessEnv;
  readonly gitBinary?: string;
  readonly developerCheckout?: boolean;
  readonly userExplicitConsentToken?: string;
}

export interface SnapshotGitResult {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly durationMs: number;
}

/**
 * Task 035 `GitRunner` port. A function `(options) => result` is assignable when
 * it accepts `{ args, cwd, env, developerCheckout, userExplicitConsentToken }`.
 */
export interface SnapshotGitRunner {
  execGit(options: SnapshotGitRequest): Promise<SnapshotGitResult>;
}

export interface BlockedSecretFinding {
  readonly file: string;
  readonly path: string;
  readonly line: number;
  readonly rule: string;
  readonly ruleId: string;
  readonly preview: string;
}

export interface LargeFileFinding {
  readonly file: string;
  readonly sizeBytes: number;
}

export interface SafetyScanReport {
  readonly blockedSecrets: readonly BlockedSecretFinding[];
  readonly largeFiles: readonly LargeFileFinding[];
  readonly safeToCommit: boolean;
  readonly recommendedIgnores?: readonly string[];
  readonly proposedGitignoreDiff?: string;
}

export interface DeltaScanInput {
  readonly repoPath: string;
  readonly paths: readonly string[];
}

/**
 * Task 036 scanner port.
 * Prefer `scanUncommittedDelta` so only the dirty delta can block a snapshot.
 * A root-bound `scanWorkingTreeForBaseline` is filtered to that delta.
 */
export interface GitSafetyScannerPort {
  scanUncommittedDelta?(input: DeltaScanInput): Promise<SafetyScanReport>;
  scanWorkingTreeForBaseline?(): Promise<SafetyScanReport>;
}

export interface SnapshotIdentity {
  readonly taskId?: string;
  readonly attemptId?: string;
  readonly step?: string;
}

export interface CreateDirtyWorkSnapshotInput extends SnapshotIdentity {
  readonly repoPath: string;
  readonly projectId: string;
  readonly snapshotNumber?: number;
  /** Developer chose "Snapshot excluding flagged secrets". */
  readonly excludeFlaggedSecrets?: boolean;
  readonly harnessTmp?: string;
  readonly developerCheckout?: boolean;
  readonly userExplicitConsentToken?: string;
}

export interface SnapshotResult {
  readonly noChanges: boolean;
  readonly commitSha: string | null;
  readonly treeSha: string | null;
  readonly ref: string | null;
  readonly headSha: string | null;
  readonly unborn: boolean;
  readonly parentSha: string | null;
  readonly excludedPaths: readonly string[];
}

export interface CreateCheckpointWipCommitInput {
  readonly repoPath: string;
  readonly attemptId: string;
  readonly step: string;
  readonly taskId: string;
  readonly previousWipRef?: string;
  readonly excludeFlaggedSecrets?: boolean;
  readonly harnessTmp?: string;
  readonly developerCheckout?: boolean;
  readonly userExplicitConsentToken?: string;
}

export interface CheckpointCommitResult {
  readonly reused: boolean;
  readonly noChanges: boolean;
  readonly commitSha: string;
  readonly treeSha: string;
  readonly ref: string | null;
  readonly parentSha: string | null;
  readonly wipRef: string;
  readonly excludedPaths: readonly string[];
}

export interface SnapshotListEntry {
  readonly ref: string;
  readonly kind: "snapshot" | "checkpoint";
  readonly commitSha: string;
  readonly parentShas: readonly string[];
  readonly committedAt: string;
  readonly subject: string;
}

export interface ListSnapshotsInput {
  readonly repoPath: string;
  readonly projectId?: string;
  readonly attemptId?: string;
}

export interface CheckpointDisposition {
  readonly attemptId: string;
  readonly parked: boolean;
  readonly landed: boolean;
}

export interface PruneSnapshotsInput {
  readonly repoPath: string;
  readonly refs: readonly string[];
  readonly checkpointStates?: readonly CheckpointDisposition[];
  readonly developerCheckout?: boolean;
  readonly userExplicitConsentToken?: string;
}

export type PruneRefusalReason =
  | "not_harness_snapshot_namespace"
  | "checkpoint_parked"
  | "checkpoint_unlanded"
  | "checkpoint_disposition_required"
  | "missing"
  | "cas_mismatch";

export interface PruneRefusal {
  readonly ref: string;
  readonly reason: PruneRefusalReason;
}

export interface PruneSnapshotsResult {
  readonly deleted: readonly string[];
  readonly refused: readonly PruneRefusal[];
}

export interface SnapshotManagerOptions {
  readonly git?: SnapshotGitRunner;
  readonly gitBinary?: string;
  readonly safetyScanner?: GitSafetyScannerPort;
  readonly safetyScannerForRepo?: (repoPath: string) => GitSafetyScannerPort;
  readonly harnessTmp?: string;
  readonly vaultSecrets?: readonly { readonly label: string; readonly value: string }[];
}

export interface WorktreeFingerprint {
  readonly indexSha256: string;
  readonly head: string;
  readonly status: string;
  readonly diff: string;
  readonly diffCached: string;
  readonly untracked: string;
}
