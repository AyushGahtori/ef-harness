export { runStaticAudit, collectRemovedSymbols } from "./audit.js";
export { DATA_DROP, DATA_KEEP_DORMANT, INTEGRATION_BRANCH, INTEGRATION_REF, LLM_TOKENS, MODE_FAST_PATH, MODE_SURGICAL, PHASE0_SHARED } from "./constants.js";
export { UndoDataRetentionDialog } from "./dialog.js";
export { FeatureUndoEngine, type FeatureUndoEngineOptions } from "./engine.js";
export {
  DestructiveDropError,
  GitCommandError,
  HistoryRewriteError,
  RefLeaseHeldError,
  RegressionFailedError,
  UndoError,
  UndoNotConfirmedError,
  UnknownFeatureError,
} from "./errors.js";
export { FeatureUndoExecutor } from "./executor.js";
export { CombinedRegressionGatePort } from "./gate.js";
export { GitRepo, assertAllowed, parseEfTrailers, renderTrailers } from "./git.js";
export { FeatureUndoInventoryAnalyzer } from "./inventory.js";
export { SharedOwnershipTransferPlanner } from "./ownership.js";
export { ActiveTaskHaltPort, InboxRetirementPort } from "./ports.js";
export { RefLeasePort } from "./ref-lease.js";
export { KnowledgeGraphPort } from "./state-db.js";
export type {
  ClassifiedArtifact,
  DataHandlingChoice,
  FeatureRecord,
  FeatureRegistration,
  InboxQuestion,
  OwnershipTransfer,
  RegressionReport,
  ReviveRequest,
  ReviveResult,
  StaticAuditReport,
  UndoChoice,
  UndoExecutionMode,
  UndoInventory,
  UndoPreview,
  UndoResult,
  UsageEdge,
  WorkerRecord,
} from "./types.js";
export { CrossFeatureUsageGraphChecker, ReverseImpactWalkerPort } from "./usage-graph.js";
