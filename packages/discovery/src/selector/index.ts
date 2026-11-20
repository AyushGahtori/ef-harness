export { AntiNagGuard, DeterministicClarifyRephraser } from "./anti-nag.js";
export type { ClarifyPort, ClarifyRequest, ClarifyResponse } from "./anti-nag.js";
export { DiscoveryBatchBuilder, serializeDiscoveryBatchQuestions } from "./batch-builder.js";
export {
  DeterministicQuestionDrafter,
  ProjectLocalQuestionDrafter,
  QuestionDrafterV1Schema,
  SPLIT_WAVES_TEXT,
} from "./drafter.js";
export type {
  DraftInput,
  DraftOutput,
  QuestionDrafterPort,
  QuestionDrafterRequest,
  QuestionDrafterV1,
} from "./drafter.js";
export { PrereqEligibilityFilter, breakNextPrerequisiteCycle } from "./eligibility.js";
export { selectNextBatch } from "./engine.js";
export type { SelectionRequest, SelectionResult, SelectorLogger } from "./engine.js";
export { CatalogPrereqCycleError, SelectorInvariantError } from "./errors.js";
export {
  GreedyQuestionSelector,
  WEIGHT_CONFLICT,
  WEIGHT_MUST_ASK,
  WEIGHT_STANDARD,
  WEIGHT_UNBLOCKER,
  applyScopePriority,
  coalesceBundles,
  stripSettledFromDrafts,
  unblockerIds,
} from "./greedy-selector.js";
export type { GreedySelectInput } from "./greedy-selector.js";
export { isUserFacingClean, plainLabel, safeWhyAsking } from "./plain-english.js";
export {
  INSERT_DISCOVERY_BATCH_SQL,
  InMemoryDiscoveryBatchStore,
  ScopeCriterionAskLedger,
  discoveryBatchInsertParams,
  discoveryBatchQuestionsJson,
} from "./store.js";
export type { DiscoveryBatchStore } from "./store.js";
export { TOUCHES_TAGS, isTouchesTag } from "./touches.js";
export type { TouchesTag } from "./touches.js";
export {
  CRITERION_STATUSES,
  DEFAULT_BATCH_TARGET,
  DEFAULT_LOCAL_QUESTION_BUDGET,
  FOUNDATIONAL_SCOPES,
  MAX_BATCH_SIZE,
  clampBatchTarget,
  isUncoveredStatus,
} from "./types.js";
export type {
  AskUpdate,
  BatchQuestionSnapshot,
  CatalogQuestion,
  CriterionState,
  CriterionStatus,
  DiscoveryBatchRecord,
  GreedyPick,
  QuestionOption,
  ScopeClass,
  SplitWavesCard,
} from "./types.js";
