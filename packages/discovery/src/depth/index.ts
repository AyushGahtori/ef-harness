export { computeAskScore, isBelowAskThreshold } from "./ask-value.js";
export { AskValueInterrogationGuard, applyQuestionCap, planCriterion } from "./ask-value-guard.js";
export type { SettlementPlan } from "./ask-value-guard.js";
export { AutopilotDelegationEngine } from "./autopilot.js";
export { canonicalJson, localContentHash } from "./canonical-json.js";
export { CatalogIndex } from "./catalog.js";
export { ChosenForYouLedger } from "./chosen-for-you-ledger.js";
export { DepthSession } from "./depth-session.js";
export type { DepthSessionOptions } from "./depth-session.js";
export { AcceptAllRecommendedAction } from "./delegation.js";
export {
  BasisHonestyError,
  CatalogError,
  DepthError,
  RecommendationError,
  StageSwitchError,
  StaleDecisionError,
  UnknownCriterionError,
  assertAutomaticBasis,
} from "./errors.js";
export { LocalGreedyQuestionSelector } from "./greedy-selector.js";
export type { GreedyQuestionSelector } from "./greedy-selector.js";
export { LocalSqliteKnowledgeGraph, openDepthKnowledgeGraph } from "./knowledge-graph.js";
export type { ChangeOrigin, KnowledgeGraphRepo, NodeVersionRow, StoredNode } from "./knowledge-graph.js";
export { MustAskPolicyFloor, isVagueProductPrompt, readPromptSignals } from "./must-ask-floor.js";
export type { PromptSignals } from "./must-ask-floor.js";
export { LocalPremiseSupersessionReopener } from "./premise-reopener.js";
export type { PremiseSupersessionReopener } from "./premise-reopener.js";
export { optionLabel, resolveStageRecommendation } from "./recommendations.js";
export { StageDepthController } from "./stage-depth-controller.js";
export {
  AUTOMATIC_BASES,
  CRITERION_DOMAINS,
  CRITERION_STATUSES,
  HALT_REASONS,
  MUST_ASK_CLASSES,
  PROJECT_STAGES,
  RISK_TIERS,
  SETTLED_BASES,
  STAGE_LABEL,
  isAutomaticBasis,
  isProjectStage,
  systemClock,
} from "./types.js";
export type {
  AcceptAllResult,
  AskScore,
  AutomaticBasis,
  AutopilotResult,
  CriterionDomain,
  CriterionStatus,
  DepthCatalogEntry,
  DepthClock,
  DepthDecision,
  DepthOption,
  GreedyQuestionCandidate,
  HaltReason,
  LedgerEntry,
  LedgerGroup,
  LedgerView,
  MustAskAssessment,
  MustAskClass,
  OverrideResult,
  ProjectStage,
  RecommendationResolution,
  ReconcileResult,
  ReworkCost,
  RiskTier,
  SettledBasis,
  StageChipModel,
  StageProfile,
  StageRecommendation,
  StageSwitchResult,
  SupersessionRecord,
  VerificationPolicy,
} from "./types.js";
export {
  ASK_THRESHOLD,
  IMPORTANCE_THRESHOLD,
  MATERIAL_UNCERTAINTY,
  RISK_WEIGHT,
  STAGE_IMPACT_MULTIPLIER,
  VISIBLE_QUESTION_CAP,
  stageProfile,
} from "./weights.js";
