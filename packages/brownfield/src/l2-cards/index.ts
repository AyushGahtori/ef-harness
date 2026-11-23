export type {
  BrownfieldModuleNode,
  CodeIndexSymbol,
  FocusSelectionResult,
  L2EgressMode,
  MaskedSourceExcerpt,
  ModuleCardCacheKey,
  ModuleCardWriterV1Output,
  PreSpendBreakdown,
  PreSpendSummaryText,
  SecurityMaskNotice,
  StaleDocFinding,
  StoredModuleCard,
} from "./types.js";

export {
  DEFAULT_MAX_FOCUS_FILES,
  LEGACY_SECRET_PLACEHOLDER,
  MAX_L2_CONCURRENCY,
  MODULE_CARD_PROMPT_VERSION,
  PRE_SPEND_TOKEN_THRESHOLD,
  PRE_SPEND_USD_THRESHOLD,
  STALE_DOC_AGE_DAYS,
  STALE_DOC_CHURN_THRESHOLD,
} from "./types.js";

export type {
  CodeMapQueryPort,
  L0GroundTruthPort,
  L2RuntimeContext,
  ModelAdapterPort,
  ModuleCardStorePort,
  ObservedModuleGraphPort,
  RepoCloudEgressLedgerPort,
} from "./ports.js";

export { RequestDrivenFocusSelector } from "./focus-selector.js";
export { L2PreSpendEstimator } from "./pre-spend-estimator.js";
export { CodeEgressSecretMasker } from "./code-egress-secret-masker.js";
export { PacketSecurityRedactor } from "./packet-security-redactor.js";
export { ModuleCardCacheEngine } from "./module-card-cache-engine.js";
export { StaleDocsDetector } from "./stale-docs-detector.js";
export { L2BrownfieldSummarizer } from "./l2-batch-runner.js";
export { repairHallucinatedExports } from "./symbol-parity.js";

export {
  FakeModelAdapter,
  InMemoryCodeMap,
  InMemoryModuleCardStore,
  InMemoryObservedModuleGraph,
  InMemoryRepoCloudEgressLedger,
} from "./in-memory.js";