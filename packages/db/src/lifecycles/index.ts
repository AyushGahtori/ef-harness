export type { SqlRunResult, SqlStatement, SqlValue, StateConnection } from "./connection.js";
export { evaluateFeatureDoneConditions } from "./done.js";
export {
  ApprovalRequiredError,
  ChangeSetNotFoundError,
  FeatureAlreadyInitializedError,
  FeatureCoupledError,
  FeatureDoneRefusedError,
  FeatureNotFoundError,
  IllegalFeatureTransitionError,
  IllegalProjectTransitionError,
  InvalidLifecycleInputError,
  ProjectCompletionBlockedError,
  ProjectRuntimeMissingError,
  SameIntegrationHolderError,
  StaleEpochError,
} from "./errors.js";
export type { CompletionBlocker, CoupledFeatureRef } from "./errors.js";
export type {
  AdvanceLeavesInput,
  AdvanceLeavesReason,
  AdvanceLeavesResult,
  FeatureDoneCheckResult,
  FeatureDoneEvidenceInput,
  FeatureTransitionResult,
  InitFeatureInput,
  InitFeatureResult,
  ProjectPauseResult,
  ProjectTransitionResult,
  SetProjectPausedInput,
  TransferHolderInput,
  TransferHolderResult,
  TransitionFeatureInput,
  TransitionProjectInput,
} from "./models.js";
export {
  CANONICAL_QUERY_NAMES,
  canonicalQueriesPath,
  canonicalStateSqlPath,
  loadCanonicalQueries,
  parseNamedQueries,
  repositoryRootFromModule,
} from "./queries.js";
export type { CanonicalQueryName } from "./queries.js";
export { LifecycleRepo, createLifecycleRepo } from "./repo.js";
export {
  DONE_GATE_CONDITIONS,
  FEATURE_STATES,
  FEATURE_STATE_TRANSITIONS,
  FOUNDATION_GATE_META_KEY,
  FOUNDATION_GATE_PASSED_VALUE,
  INTEGRATION_REF,
  LIFECYCLE_EVENT_CONSUMERS,
  LIFECYCLE_EVENT_TYPES,
  PROJECT_STATES,
  PROJECT_STATES_WITH_FOUNDATION_GATE,
  PROJECT_STATE_TRANSITIONS,
  featureTerminal,
  foundationGatePassedByState,
  isFeatureDoneConditionId,
  isFeatureState,
  isLegalFeatureTransition,
  isLegalProjectTransition,
  isProjectState,
} from "./states.js";
export type {
  FeatureDoneConditionId,
  FeatureState,
  LifecycleEventConsumer,
  LifecycleEventType,
  ProjectState,
} from "./states.js";
