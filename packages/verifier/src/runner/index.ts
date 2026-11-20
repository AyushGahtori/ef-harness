export { attributeVerificationFailure } from "./attribution.js";
export { CROSS_CUTTING_RULE_IDS, isCrossCuttingRuleId, missingInScopeRules } from "./cross-cutting.js";
export { CleanVerifierRunner } from "./clean-verifier-runner.js";
export { CleanCheckoutSeparationError, MissingRequiredChecksError, VerifierIntegrityError } from "./errors.js";
export { canonicalJson, sha256Hex } from "./hash.js";
export {
  defaultExpectationUnsealer,
  sealExpectationDocument,
} from "./materialize.js";
export { parseCollectedCaseIds } from "./reporters.js";
export { CLEAN_VERIFIER_REPLAY_CLOCK } from "./types.js";

export type { ImmutableReceiptInput, MaterializeProtectedRequest } from "./clean-verifier-runner.js";
export type { CrossCuttingRuleId } from "./cross-cutting.js";
export type {
  ExpectationCheckBody,
  ExpectationDocument,
  MaterializedCheck,
  MaterializedExpectations,
} from "./materialize.js";
export type {
  CasBlobStorePort,
  CheckResultsPort,
  CleanVerifierDeps,
  CompletenessGateRunnerPort,
  ExpectationUnsealer,
  HarnessRunEnginePort,
  PinnedRunRequest,
  PinnedRunResult,
  SandboxCheckInput,
  SurfaceCheckResult,
  SurfaceCollectInput,
  SurfaceVerifierAdapter,
  TestEnvOrchestratorPort,
  WorktreeSlotManagerPort,
} from "./ports.js";
export type { CollectedCase, CollectedCaseReport } from "./reporters.js";
export type {
  AttemptLeaseView,
  AttributionRoute,
  CasRetention,
  CheckDbStatus,
  CheckOutcome,
  CheckResultInsert,
  CheckRunRecord,
  CheckStability,
  CheckSurface,
  CheckVisibility,
  DispatchFingerprint,
  EnvironmentFailureKind,
  AttributionInput,
  FailureAttribution,
  FailureAttributionDecision,
  HintFailureType,
  HintLadderPayload,
  LeafStaticAuditResult,
  ProvisionedEnv,
  ReplayClock,
  RequiredCheckRef,
  RequirementResolution,
  RunSignals,
  SandboxTier,
  VerificationOutcome,
  VerifierWorktreeSlot,
  VerifyCandidateRequest,
  WorkerFacingCheck,
  WorkerFacingReport,
} from "./types.js";
