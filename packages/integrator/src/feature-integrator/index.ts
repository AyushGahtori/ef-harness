export {
  CONTEXT_RADIUS,
  DONE_CONDITION_IDS,
  EF_TRAILER_KEYS,
  FEATURE_STATES,
  INTEGRATION_REF,
  MAX_FIX_ROUNDS,
  MERGE_TREE_COMMAND,
  SEAM_CATALOG,
  UI_SHARED_FILES,
  featureRef,
  seamName,
} from "./constants.js";
export type { DoneConditionId, EfTrailerKey, FeatureState, SeamId } from "./constants.js";
export {
  CasDriftError,
  ConflictVerificationError,
  DroppedSideError,
  FeatureDoneRefusedError,
  FeatureNotReadyError,
  GitCommandError,
  IllegalFeatureTransitionError,
  IntegrationBlockedError,
  InvalidIntegratorOutputError,
  LeafScopeOverlapError,
  LeafSharedFileViolationError,
  StaleEpochError,
  TestWeakeningError,
  UnrelatedEditError,
  VacuousSealedCheckError,
} from "./errors.js";
export { MergeTreePreflightScanner, parseMergeTreeOutput } from "./merge-tree-preflight.js";
export { resolvePreflight } from "./conflict-resolver.js";
export { buildScopedConflictPrompt, featureSymbols, resolveConflictText } from "./conflict-text.js";
export { assertNoTestWeakening } from "./test-weakening.js";
export { AggregatedWiringTaskBuilder } from "./wiring-task.js";
export {
  FeatureJourneyGate,
  RedBeforeGreenBlindBinder,
  auditTexts,
  bindBlindBinderOrchestrator,
  bindCompletenessGateRunner,
  bindUiInteractionContractVerifier,
  passthroughBinder,
  runBoundedFixLoop,
} from "./journey-gate.js";
export { executeSeamJourney, isNearMiss, mountFromPlan } from "./seam-runner.js";
export { toDbFeatureDoneEvidence, verifyFeatureDoneConditions } from "./done-gate.js";
export { InMemoryFeatureLifecycle, bindLifecycleRepo, bindProjectLifecycle } from "./lifecycle-port.js";
export type { LifecycleBindingOptions } from "./lifecycle-port.js";
export { bindRefLeaseManager, createGitRefCas } from "./ref-cas.js";
export { parseFeatureIntegratorV1 } from "./schema.js";
export { buildTrailers, parseEfTrailers, receiptSha, renderCommitMessage, trailerLines } from "./trailers.js";
export { verifyRouteResolution } from "./route-verify.js";
export { FeatureIntegratorEngine, adaptFeatureIntegratorModel } from "./engine.js";
export type { FeatureIntegratorEngineDeps } from "./engine.js";
export { bindCleanVerifierRunner, bindSlotSnapshots, gitSnapshots } from "./snapshots.js";
export type {
  AggregatedWiringTask,
  BlindBinderPort,
  CasAdvanceResult,
  CleanSnapshotPort,
  CleanVerifierHarnessPort,
  CodeSnapshot,
  ConflictHunk,
  EfTrailers,
  FeatureDoneCheckResult,
  FeatureDoneEvidenceInput,
  FeatureIntegrationRequest,
  FeatureIntegrationResult,
  FeatureIntegratorModelPort,
  FeatureIntegratorV1,
  FeatureLifecyclePort,
  IntegratorWiringNeed,
  JourneyReport,
  LeafCommitInput,
  PreflightReport,
  RefCasPort,
  SealedCheck,
  SeamJourney,
  StaticAuditPort,
  ViewportCheck,
  WiringKind,
} from "./types.js";
