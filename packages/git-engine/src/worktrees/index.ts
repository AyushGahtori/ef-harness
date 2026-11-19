export { DiskLane } from "./disk-lane.js";
export {
  BeforeSlotResetRequiredError,
  GitCommandFailedError,
  GitLfsFetchError,
  IntegrationLeaseRejectedError,
  IntegrationRefMismatchError,
  IntegrationRefMissingError,
  IntegrationWorktreeExclusivityError,
  SecretConfigCopyRejectedError,
  SlotBusyError,
  SlotOwnershipError,
  WorktreeSlotError,
} from "./errors.js";
export { createProcessGitRunner } from "./git-runner.js";
export type { GitExecResult, GitRunOptions, GitRunner } from "./git-runner.js";
export { IntegrationWorktreeController } from "./integration-controller.js";
export { readSlotOwnerMarker } from "./ownership.js";
export { WorktreeSlotManager, defaultWorktreeRoot } from "./slot-manager.js";
export { WorktreeSlotManager as WorktreeSlotPool } from "./slot-manager.js";
export { rejectedConfigPath } from "./config-copy.js";
export {
  DEFAULT_RECOMMENDED_PARALLELISM,
  DEFAULT_SLOW_WORKTREE_MS,
  FAILED_SLOT_RETENTION_MS,
  LOCKFILE_NAMES,
  SLOT_OWNER_MARKER_FILE,
  WARM_DEPENDENCY_EXCLUDES,
} from "./types.js";
export type {
  AcquireMergeWorktreeRequest,
  AcquireSlotRequest,
  AttemptBranchState,
  DependencySyncRequest,
  EnsureIntegrationWorktreeRequest,
  EnvironmentManifest,
  FastForwardIntegrationRequest,
  FastForwardResult,
  IntegrationAdvancedEvent,
  IntegrationLease,
  IntegrationLeaseProof,
  PruneResult,
  RecoveryRecord,
  ReleaseSlotRequest,
  RepairWorktreesResult,
  SlotExecutionPurpose,
  SlotHandle,
  SlotKind,
  SlotOwnerMarker,
  SparseCheckoutRequest,
  WorktreeLogEvent,
  WorktreeLogger,
} from "./types.js";
