export { canonicalJson, sha256 } from "./canonical.js";
export { deterministicFeaturePlan, deterministicOracle, deterministicOracleRepair } from "./deterministic-model.js";
export { FeaturePlanError, isFeaturePlanError } from "./errors.js";
export { FakeModelAdapter } from "./fake-model-adapter.js";
export { FeaturePlanningSession } from "./feature-plan-session.js";
export type { CompilePermit, ReplanInput, SessionInput } from "./feature-plan-session.js";
export { HiddenCheckPoolStore, sealedPathIsOutsideWorktree } from "./hidden-check-pool-store.js";
export type { ExportIntent } from "./hidden-check-pool-store.js";
export { IndependentOracleAuthorSealer, assertDiversePools } from "./independent-oracle-author-sealer.js";
export type { AuthoredOracles, SealAuthorInput } from "./independent-oracle-author-sealer.js";
export { JitFeaturePlanner } from "./jit-feature-planner.js";
export type { PlannerRun, ReplanRun } from "./jit-feature-planner.js";
export { materialize } from "./materialize.js";
export { selectOracleAuthor, selectPlannerModel } from "./model-family.js";
export type { OracleSelection } from "./model-family.js";
export { assertOracleInputClean, buildOracleAuthorInput, buildPlannerModelInput } from "./model-input.js";
export { lintHeldBack, lintOracleCase, isLoopback } from "./oracle-lint.js";
export type { LintIssue } from "./oracle-lint.js";
export { MemoryDiagnosticLog } from "./ports.js";
export type {
  DiagnosticLog,
  FeatureArchitectureConsistency,
  KnowledgeGraphRepoPort,
  NameRegistryRepoPort,
  PlanContext,
} from "./ports.js";
export { RelationsToEdgesNormalizer, collectEdges, stripRelationFields } from "./relations-to-edges-normalizer.js";
export { FeaturePlannerV1Schema, OracleAuthorV1Schema } from "./schema.js";
export { assertDisjointWriteScopes, assertTaskBounds, scopesOverlap } from "./scope.js";
export { FeaturePlanDatabase, RELATIONS_IN_FIELDS_SQL } from "./state-db.js";
export type { StoredHiddenCheck, StoredNode } from "./state-db.js";
export { TOUCH_TAGS, isTouchTag } from "./touches.js";
export type { TouchTag } from "./touches.js";
export {
  FEATURE_INTEGRATION_SLOT,
  FEATURE_PLANNER_SCHEMA,
  MAX_LEAF_FILES,
  MIN_LEAF_FILES,
  MIN_ORACLE_CASES,
  ORACLE_AUTHOR_SCHEMA,
  RELATION_KEYS,
} from "./types.js";
export type {
  CheckKind,
  ContractInput,
  Diversity,
  EdgeType,
  EntityInput,
  FeaturePlanDocument,
  HeldBackCase,
  ModelAssignment,
  ModelFamily,
  ModelRoster,
  OracleAuthorDocument,
  OracleIndependence,
  PlannedTask,
  PlannerOracleModel,
  RequirementInput,
  SealReceipt,
  TaskType,
  VisibleExample,
  WorkerBrief,
} from "./types.js";
export { validateFeaturePlan } from "./validate-plan.js";
export { compileWorkerBrief } from "./worker-brief.js";
