export { CatalogRuleChecker } from "./catalog-checker.js";
export { CrossMatrixInvariantChecker } from "./cross-matrix.js";
export type { CrossMatrixResult } from "./cross-matrix.js";
export { FiveLayerContradictionEngine } from "./engine.js";
export type { ContradictionReport, FiveLayerContradictionEngineOptions } from "./engine.js";
export { IntervalConflictDetector } from "./intervals.js";
export { InMemoryContradictionStore } from "./memory-store.js";
export {
  claimsFromFields,
  readRecord,
  readString,
  readStringList,
} from "./ports.js";
export type {
  CatalogRuleSource,
  ChangeSetProposal,
  CheckRequest,
  CommitChangeSetResult,
  ConflictInboxItem,
  ConflictInboxPayload,
  ConflictInboxPort,
  ContradictionCheckModel,
  ContradictionLogger,
  ContradictionObserver,
  ContradictionWarning,
  EdgeAsOf,
  KnowledgeGraphPort,
  MatrixCellPersistenceRepo,
  NodeRecord,
  OrderedCellFillerPipeline,
} from "./ports.js";
export { citesExactPair, isConcreteCounterexample, parseContradictionCheckV1 } from "./schema.js";
export type {
  ContradictionCheckVerdict,
  ContradictionVerdict,
  ParsedContradictionCheck,
} from "./schema.js";
export { SemanticPairConflictSweeper } from "./semantic-sweeper.js";
export type { SemanticSweepOptions, SemanticSweepResult } from "./semantic-sweeper.js";
export {
  CONTRADICTION_EDGE_TYPE,
  MATRIX_IDS,
  MAX_SEMANTIC_PAIRS_PER_CALL,
  SETTLED_BASES,
  Z3_SOLVE_TIMEOUT_MS,
  buildResolutionOptions,
  constraintNodeIds,
  isSettledBasis,
  makeConflictId,
} from "./types.js";
export type {
  ArchitecturalConstraint,
  CatalogRequire,
  CatalogRuleEntry,
  ConflictDraft,
  ContradictionLayer,
  IntervalClaimInput,
  IntervalSource,
  MaterializedRequirement,
  MatrixCellRecord,
  MatrixId,
  SemanticPair,
  SettledBasis,
  SettledDecisionRef,
  UnitFamily,
} from "./types.js";
export {
  Z3UnsatCoreSolver,
  assertionClause,
  conflictClause,
  exactlyOneClauses,
  implicationClause,
  nandClause,
} from "./z3-solver.js";
export type { Z3ClauseInput, Z3Problem, Z3SolveResult, Z3SolveStatus, Z3SolverOptions } from "./z3-solver.js";
