export {
  COEXISTENCE_WATCH_DEBOUNCE_MS,
  ACTIVE_COEXISTENCE_STATES,
  OVERLAP_CHOICES,
  LOCKFILE_INCLUDE_CHOICES,
  EDITOR_OVERLAP_HOLD_REASON,
  HARNESS_INTEGRATION_REF,
} from "./constants.js";
export type { ActiveCoexistenceState, OverlapChoice, LockfileIncludeChoice } from "./constants.js";

export { ActiveScopeOverlapDetector, editorOverlapSource } from "./active-scope-overlap-detector.js";
export type { OverlapDetection, ActiveScopeOverlapDetectorOptions } from "./active-scope-overlap-detector.js";

export { BaseSyncIntegrationMerger } from "./base-sync-integration-merger.js";
export type { BaseSyncIntegrationMergerOptions, BaseSyncOffer } from "./base-sync-integration-merger.js";

export { EditorCoexistenceWatcher } from "./editor-coexistence-watcher.js";
export type { EditorCoexistenceWatcherOptions } from "./editor-coexistence-watcher.js";

export { ManualLockfileIncludeHandler } from "./manual-lockfile-include-handler.js";
export type { ManualLockfileIncludeHandlerOptions } from "./manual-lockfile-include-handler.js";

export { OverlapSuppressionCache } from "./overlap-suppression.js";

export { pathMatchesWriteScope } from "./scope-match.js";
export {
  normalizeRepoRelative,
  shouldIgnoreWatchPath,
  isGitMetaPath,
  lockfileBasename,
} from "./path-utils.js";

export {
  createMinGitRepoInspector,
  createNodeGitRunner,
} from "./git-exec.js";
export type { MinGitRepoInspectorPort, MinGitCommandRunner, GitRunResult } from "./git-exec.js";

export {
  createParcelWatchBackend,
  loadParcelWatcher,
} from "./watch-backend.js";
export type { WatchBackend, WatchSubscription, WatchEvent } from "./watch-backend.js";

export type {
  ActiveTaskSnapshot,
  ActiveTasksPort,
  TaskHoldsManagerPort,
  HoldPlacement,
  CoexistenceUiPort,
  OverlapCardPayload,
  LockfileIncludeCardPayload,
  CoexistenceEventStorePort,
  CoexistenceEventRecord,
  ProjectMergeQueuePort,
  SmartBranchFreshnessSyncPort,
  RefLeaseAndCasManagerPort,
  HumanOwnedTransitionPort,
  LandingOverlapFlagPort,
  BaseSyncMergeRequest,
  LockfileDecision,
} from "./ports.js";

export {
  InMemoryActiveTasks,
  InMemoryTaskHoldsManager,
  RecordingCoexistenceUi,
  InMemoryCoexistenceEventStore,
  InMemoryProjectMergeQueue,
  NoopSmartBranchFreshnessSync,
  RecordingHumanOwnedTransition,
  RecordingLandingOverlapFlag,
} from "./ports.js";