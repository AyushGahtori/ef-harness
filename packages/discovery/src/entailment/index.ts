export { MapInferenceCatalog } from "./catalog.js";
export type { InferenceRuleCatalog } from "./catalog.js";
export { writeDecision, writeMany } from "./commit-decision.js";
export type { DecisionEdge, DecisionWrite } from "./commit-decision.js";
export { currentPremiseIds, DerivationChainValidator, hasAssistantParaphrase } from "./derivation-chain-validator.js";
export {
  CostlyDerivationError,
  CyclicDerivationError,
  RuleNotAllowlistedError,
  UngroundedDerivationError,
  UnsettledPremiseError,
} from "./errors.js";
export {
  contradicts,
  established,
  FakeModelAdapter,
  leavesOpen,
  timedOut,
  unavailable,
} from "./fake-model-adapter.js";
export type {
  EntailmentModelPayload,
  EntailmentModelPort,
  EntailmentModelRequest,
  EntailmentModelResponse,
} from "./fake-model-adapter.js";
export { InMemoryKnowledgeGraph, parseDecisionFields, readDecision } from "./graph-port.js";
export type {
  ChangeSetProposal,
  CommitChangeSetResult,
  EdgeAsOf,
  KnowledgeGraphPort,
  NodeHistoryRecord,
  NodeRecord,
} from "./graph-port.js";
export { LowConfidenceDictationHold } from "./low-confidence-hold.js";
export { MemoryEntailmentMetrics } from "./metrics.js";
export type { EntailmentCorrelationMetric, EntailmentMetricSink } from "./metrics.js";
export { PremiseSupersessionReopener } from "./premise-supersession-reopener.js";
export type { ReopenEffect, SupersessionReport } from "./premise-supersession-reopener.js";
export { LocalExactQuoteEvidenceVerifier, normalizeQuote } from "./quote-port.js";
export type { ExactQuoteEvidenceVerifier, QuoteCheck, QuoteValidationResult, TurnDirectory } from "./quote-port.js";
export { factsFromGraph, ReplacementSecondEventDisambiguator } from "./replacement-disambiguator.js";
export type { Disambiguation, ExistingFact } from "./replacement-disambiguator.js";
export { LongTurnRetractionReconciler } from "./retraction-reconciler.js";
export type {
  ExtractedClaim,
  LongTurn,
  Reconciliation,
  ReconciledSpan,
  TurnChunk,
} from "./retraction-reconciler.js";
export { selectEntailmentModel } from "./routing.js";
export type { ModelRoster, SelectedEntailmentModel } from "./routing.js";
export { isBlockedEntailment, parseEntailmentCheckerV1 } from "./schema.js";
export type { EntailmentCheckerBlocked, EntailmentCheckerSuccess, EntailmentCheckerV1 } from "./schema.js";
export { SemanticEntailmentGate } from "./semantic-entailment-gate.js";
export type { EntailmentBatchResult, SemanticEntailmentGateDeps } from "./semantic-entailment-gate.js";
export {
  DECISION_STATUSES,
  earnsReadinessCredit,
  GROUNDED_ROOT_BASES,
  isCostlyDerivation,
  needsEntailmentCheck,
  SETTLED_BASES,
} from "./types.js";
export type {
  CitedExcerpt,
  DecisionFields,
  DecisionStatus,
  DerivationProposal,
  EntailmentClaim,
  EntailmentClaimResult,
  EntailmentVerdict,
  JsonValue,
  MetricVerdict,
  ModelIdentity,
  Reversibility,
  SettledBasis,
  TurnSnapshot,
  ValueKind,
} from "./types.js";
