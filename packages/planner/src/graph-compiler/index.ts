export {
  assertTaskReadyForDispatch,
  taskMayEnterReady,
  UncompiledDispatchError,
} from "./dispatch.js";
export { DeterministicGraphCompiler } from "./compiler.js";
export { persistCompiledGraph } from "./persist.js";
export {
  compilationInputFromKnowledgeGraph,
  KnowledgeGraphProjectionError,
} from "./knowledge-adapter.js";
export type { KnowledgeGraphCompileContext, KnowledgeGraphEdge, KnowledgeGraphNode, KnowledgeGraphRepo } from "./knowledge-adapter.js";
export { createKitchenAppWavePlan } from "./kitchen-plan.js";
export { detectNameCollisions, LocalNameRegistryRepo } from "./name-collisions.js";
export {
  LocalBudgetLedger,
  LocalFiveLayerContradictionEngine,
  LocalIndependentOracleAuthorSealer,
  LocalKnowledgePacketSlicer,
  LocalOversizedMustAutoSplitGuard,
  OversizedMustTaskError,
} from "./ports.js";
export type {
  BudgetLedgerPort,
  FiveLayerContradictionEngine,
  GraphCompilerPorts,
  IndependentOracleAuthorSealer,
  JitFeaturePlanner,
  KnowledgePacketSlicer,
  MustBandMeasurement,
  NameCollision,
  NameRegistryRepo,
  OversizedMustAutoSplitGuard,
} from "./ports.js";
export { buildOrderingIndex, findCyclePaths } from "./reachability.js";
export { buildSnapshot, canonicalJson, compiledSliceSha256, sha256Hex } from "./snapshot.js";
export { canonicalTraceabilityQuery, loadQueryCatalog, TraceabilitySqlGate } from "./traceability-sql-gate.js";
export {
  diagnostic,
} from "./types.js";
export type {
  BrownfieldName,
  BudgetSnapshot,
  CompilationDiagnostic,
  CompilationFailure,
  CompilationInput,
  CompilationResult,
  CompilationSuccess,
  CompilationWaiver,
  CompiledPlanSnapshot,
  CompiledTaskStamp,
  ContradictionEdge,
  DiagnosticDetail,
  MustAskCriterion,
  NameKind,
  PlanCheck,
  PlanFeature,
  PlannedName,
  PlanRequirement,
  PlanTask,
  RequirementKind,
  RequirementRisk,
  RequirementSensitivity,
  TargetPlatform,
  TaskKind,
  TaskLevel,
  TokenAttribution,
} from "./types.js";
export { CompilationWaiverGuard, scaffoldFileWarnings } from "./waiver-guard.js";
export {
  CLOSED_TOUCHES_TAGS,
  CLOSED_TOUCHES_TAG_SET,
  CROSS_CUTTING_RULES,
  JUNIOR_MUST_TOKEN_CEILING,
  matchedRuleIds,
  NON_WAIVABLE_WAIVER_CODES,
  ruleMatches,
  SENIOR_MUST_TOKEN_CEILING,
  WAIVABLE_SOFT_WARNING_CODES,
} from "./vocabulary.js";
export type { CrossCuttingRule, TouchesTag } from "./vocabulary.js";
export { WriteScopeDisjointnessChecker } from "./write-scope-checker.js";
export {
  firstPatternIntersection,
  foldAsciiCase,
  isBroadLeafWildcard,
  normalizeWritePattern,
  patternsOverlap,
} from "./windows-glob.js";
export type { NormalizedPattern, PatternHit } from "./windows-glob.js";
