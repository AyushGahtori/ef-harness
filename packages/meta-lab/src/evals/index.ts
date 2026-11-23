export { ArtifactLifecycleManager } from "./lifecycle.js";
export { InvalidLifecycleTransitionError, UnknownArtifactError, FutilityAbortError } from "./errors.js";
export {
  McNemarAndBootstrapCalculator,
  exactMcNemarPValue,
  countDiscordantPairs,
  passesEfficiencyTieRule,
  BOOTSTRAP_RESAMPLES,
  EFFICIENCY_SAVINGS_THRESHOLD,
  MC_NEMAR_ALPHA,
  PAPERWORK_BUDGET_MAX,
} from "./mcnemar-bootstrap.js";
export { PairedStatisticalPromotionEngine } from "./promotion-engine.js";
export { ThreeLevelEvalRunner } from "./runner.js";
export { buildPromotionScorecard } from "./scorecard.js";
export { runMetaLabEvalCli, parseMetaLabEvalArgv } from "./cli.js";
export type { MetaLabEvalCliOptions, MetaLabEvalCliResult } from "./cli.js";
export {
  createMockEvalDependencies,
  type MetaLabBenchmarkRegistryPort,
  type PromptContaminationScannerPort,
  type ExactInputModelResponseCachePort,
  type SimDevDriverPort,
  type GradeResult,
  type MockEvalDependencies,
} from "./ports.js";
export { seedFromSha256 } from "./prng.js";
export type {
  ArtifactLifecycleState,
  ArtifactRecord,
  BootstrapResult,
  ConfidenceInterval,
  EvalLevel,
  EvalReport,
  EvalRunnerOptions,
  EvalRunnerResult,
  LifecycleRegistrySnapshot,
  McNemarResult,
  PromotionDecision,
  PromotionDecisionInput,
  PromotionExitCode,
  PromotionVerdict,
  PromotionVetoes,
  PairedContinuousCase,
  PairedPassFailCase,
} from "./types.js";