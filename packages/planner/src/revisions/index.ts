export { classifyChange, ChangeClassifier, additiveUnits, batchClass } from "./change-classifier.js";
export { DebouncedRevisionPropagator, ManualScheduler, systemScheduler } from "./debounced-propagator.js";
export type { Scheduler } from "./debounced-propagator.js";
export { EarlyCutoffReverifier } from "./early-cutoff.js";
export { HybridRevisionEngine } from "./engine.js";
export type { HybridRevisionEngineOptions } from "./engine.js";
export { ProjectStateHoldWriter } from "./project-holds.js";
export { canonicalFingerprint } from "./fingerprint.js";
export { openRevisionDatabase, RevisionGraph } from "./graph.js";
export { estimateDelta, formatUsd, RevisionImpactPreviewer } from "./impact-previewer.js";
export {
  AcceptingContradictionEngine,
  LocalPremiseSupersessionReopener,
  ScriptedContradictionEngine,
} from "./ports.js";
export type {
  FiveLayerContradictionPort,
  KnowledgeGraphImpactPort,
  PremiseSupersessionPort,
  TaskHoldsPort,
} from "./ports.js";
export { ReverifyBeforeReworkGate } from "./reverify-before-rework.js";
export { ReverseImpactWalker } from "./reverse-impact-walker.js";
export { RevisionHistoryStore } from "./revision-history.js";
export { CANONICAL_IMPACT_WALK_SQL, CYCLE_SAFE_IMPACT_WALK_SQL } from "./schema.js";
export {
  ACTIVE_WORKING_STATES,
  CHANGE_CLASSES,
  DEFAULT_DEBOUNCE_MS,
  DEFAULT_IMPACT_MAX_DEPTH,
  MERGED_DONE_STATES,
  MICRO_USD_PER_DELTA_TASK,
  REQUIREMENT_KINDS,
  changeClassRank,
  isActiveWorkingState,
  isMergedDoneState,
  isRequirementKind,
  maxChangeClass,
} from "./types.js";
export type {
  ChangeClass,
  CheckFailure,
  ClassifiedChange,
  ConflictCard,
  ContradictionFinding,
  CutoffHop,
  EarlyCutoffResult,
  FlushReason,
  GraphNode,
  ImpactedSubgraph,
  ImpactNode,
  ImpactPreviewInput,
  LinkedCheck,
  RevisionBatchRecord,
  RevisionCommitInput,
  RevisionCommitter,
  RevisionEdit,
  ReverifyDecision,
  TaskRuntimeRow,
} from "./types.js";
