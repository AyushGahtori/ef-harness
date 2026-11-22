export { ParallelFeatureBranchManager } from "./branch-manager.js";
export { DependencyIntentAggregator, PnpmLockfileOnlyInstaller, reconcileIntents } from "./dependency-aggregator.js";
export type { DependencyAggregateResult, LockfileInstaller } from "./dependency-aggregator.js";
export { SharedFileDriftMonitor } from "./drift.js";
export {
  ActiveTurnSyncError,
  CasMismatchError,
  DirtyWorktreeSyncError,
  FeatureBranchError,
  GitCommandError,
  HistoryRewriteRefusedError,
  IntegrationUnverifiedError,
  LockfileInstallError,
  LockfileIntegrityError,
  PruneRefusedError,
  RefLeaseHeldError,
  StaleRefLeaseError,
} from "./errors.js";
export { SmartBranchFreshnessSync } from "./freshness.js";
export type { FreshnessApply } from "./freshness.js";
export { LocalMergeTreeScanner } from "./merge-tree.js";
export type { MergeTreeScan } from "./merge-tree.js";
export {
  LocalSkeletonLock,
  MigrationConflictLinter,
  MigrationIntentAndConflictLinter,
  addUtcSeconds,
  formatUtcTimestamp,
  migrationHash,
  sanitizeSlug,
} from "./migration-linter.js";
export { LocalRefLeaseManager } from "./ref-lease.js";
export { MigrationRehearsalChecker, assertLockfileHasNoRemoteTarball, createTemplateDatabase } from "./rehearsal.js";
export type { RehearsalReport } from "./rehearsal.js";
export { intersectRanges } from "./semver.js";
export { FeatureBranchStore, openFeatureBranchStateDb } from "./state-db.js";
export type { FeatureBranchStateDb } from "./state-db.js";
export { LocalSupplyChainGate, typosquatOf } from "./supply-chain.js";
export {
  INTEGRATION_REF,
  LOCKFILE_PATHS,
  PNPM_LOCKFILE_ONLY_ARGS,
  SHARED_CONTRACT_PREFIXES,
  ZERO_OID,
  assertFeatureSlug,
  featureRef,
  isAggregatorLockfile,
} from "./types.js";
export type {
  DependencyConflict,
  DependencyDenial,
  DependencyIntent,
  DriftWarning,
  FeatureBranchRecord,
  FeatureBranchStatus,
  FreshnessPlan,
  FreshnessReason,
  MigrationFile,
  MigrationFinding,
  MigrationFindingCode,
  MigrationTool,
  RecoveryCard,
  RecoveryResult,
  ResolvedDependency,
  SequenceAssignment,
  SkeletonLockPort,
  SupplyChainGate,
  SyncOutcome,
  VetReport,
} from "./types.js";
export { LocalWorktreeSlotPool } from "./worktree-pool.js";
