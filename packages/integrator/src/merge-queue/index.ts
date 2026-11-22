export { MergeBatchBisector, type BisectPorts, type BisectProbe } from "./bisector.js";
export {
  FEATURE_COMPLETED_KIND,
  FEATURE_REF_PREFIX,
  INTEGRATION_REF,
  MAX_BATCH,
  MAX_INTEGRATOR_ATTEMPTS,
  PREVIEW_RELOAD_KIND,
  QUEUE_HOLDER,
} from "./constants.js";
export { verifyFeatureDoneConditions } from "./done-gate.js";
export { ProjectIntegratorEngine, defaultModel } from "./engine.js";
export {
  CasDriftError,
  DroppedSideError,
  FeatureDoneRefusedError,
  GitCommandError,
  InvalidIntegratorOutputError,
  MergeQueueError,
  RefLeaseHeldError,
  SimulatedCrash,
  TestWeakeningError,
} from "./errors.js";
export { CombinedRegressionGate, listWorktreeFiles } from "./gate.js";
export { ProjectMergeQueue, type MergeQueueHooks, type ProjectMergeQueueOptions } from "./queue.js";
export { RefLeasePort } from "./ref-lease.js";
export { isBlockedOutput, parseProjectIntegratorV1 } from "./schema.js";
export { openMergeQueueStateDb } from "./state-db.js";
export { assertNoTestWeakening } from "./test-weakening.js";
export { parseEfTrailers, buildTrailers } from "./trailers.js";
export type {
  DrainReport,
  Escalation,
  EvictedFeature,
  FeatureCanonicalSpec,
  FeatureDoneCheckResult,
  FeatureDoneEvidenceInput,
  GateResult,
  LandedFeature,
  MergeFeatureRequest,
  PreviewReloadEvent,
  ProjectIntegratorModel,
  QueuedFeature,
  RecoveryReport,
} from "./types.js";
export { MergeWorktreePort } from "./worktree.js";
