export { InMemoryBudgetLedger, bindBudgetLedgerRepo } from "./budget.js";
export type {
  BudgetLedgerPort,
  BudgetLedgerRepoBindingOptions,
  Reservation,
  ScopeBudgetSnapshot,
} from "./budget.js";
export { CompletionWaveController } from "./completion-wave-controller.js";
export type {
  CompletionWaveControllerDeps,
  CompletionWaveRequest,
  CompletionWaveResult,
} from "./completion-wave-controller.js";
export {
  AUDIT_BUDGET_PERCENT,
  CROSS_CUTTING_RULE_IDS,
  DEFAULT_SHARD_CONCURRENCY,
  FIX_BUDGET_PERCENT,
  GREEN_VERDICT,
  INTEGRATION_REF,
  MAX_FIX_ROUNDS,
  MAX_SHARD_TOKENS,
  OPTIONAL_FOLLOW_UPS,
  PAPERWORK_CAP_PERCENT,
  RESIDUAL_CHOICES,
  VIEWPORTS,
  auditScopeId,
  fixScopeId,
  isCrossCuttingRuleId,
  needsReviewVerdict,
  percentOf,
} from "./constants.js";
export type { CrossCuttingRuleId, ResidualChoice, ViewportWidth } from "./constants.js";
export {
  DeterministicRepoAuditor,
  bindCleanVerifierCombinedHarness,
  bindCompletenessGateStaticAudit,
  bindGitSafetySecretScanner,
  combineLayerA,
  regressionsAgainst,
} from "./deterministic-repo-auditor.js";
export { gateAuditorFindings, parseLocation } from "./evidence-gate.js";
export {
  CompletionWaveNotReadyError,
  FinalAuditError,
  InvalidAuditorOutputError,
  ShardContextError,
} from "./errors.js";
export { LandingSummaryGenerator } from "./landing-summary.js";
export type { LandingSummaryInput } from "./landing-summary.js";
export {
  LiveRouteCrawler,
  bindUiInteractionContractBrowser,
  canonicalProjectKind,
  createHttpPlaywrightSessionFactory,
  createHttpPlaywrightVerifier,
  probeDocument,
} from "./live-route-crawler.js";
export type { CrawlRequest } from "./live-route-crawler.js";
export {
  createLocalSecretScanner,
  createLocalStaticAuditGate,
  scanEnvExample,
  scanMarkersAndStubs,
  scanMigrations,
  scanRoutesAndExports,
} from "./repo-scan.js";
export { isBlockedAuditor, parseFinalProjectAuditorV1 } from "./schema.js";
export type {
  FinalProjectAuditorBlocked,
  FinalProjectAuditorSuccess,
  FinalProjectAuditorV1,
  LocatedFinding,
  WeakCheckFinding,
} from "./schema.js";
export {
  ShardedFinalProjectAuditor,
  adaptFinalProjectAuditorModel,
  boundShardPrompt,
  planShards,
} from "./sharded-final-project-auditor.js";
export type { ShardAuditRequest } from "./sharded-final-project-auditor.js";
export { FinalAuditStore } from "./state-db.js";
export { estimateTokens, findingFingerprint, makeFinding, markerPattern, secretRules } from "./text.js";
export type {
  AppBootPort,
  AuditCheck,
  AuditFixTask,
  BootedApp,
  CanonicalCatalog,
  CheckRunnerPort,
  CheckRunResult,
  CleanVerifierHarnessPort,
  CliCommandSpec,
  CommandExecutor,
  CommandObservation,
  ConfirmedFinding,
  ConnectionSpend,
  CountTrio,
  FeatureState,
  FinalProjectAuditorModel,
  FindingSeverity,
  FixExecutor,
  LandingSummary,
  LayerAReport,
  LayerBReport,
  LedgerNote,
  LedgerRecap,
  LegacyProjectKindAlias,
  OpenApiOperation,
  PageInspection,
  PageMetrics,
  PlannedFeature,
  PlannedShard,
  PlannedWave,
  PlaywrightSession,
  PlaywrightSessionFactory,
  ProjectKind,
  ProjectKindInput,
  Regression,
  RepoFile,
  RepoSnapshot,
  RequirementRef,
  SecretScannerPort,
  ShardInputs,
  ShardKind,
  ShardRun,
  ShardSlice,
  SpendSnapshot,
  StaticAuditGatePort,
  SuiteCase,
  SuiteCaseKind,
  UiPlaywrightContractVerifierPort,
  WebRoute,
} from "./types.js";
