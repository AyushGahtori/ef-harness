export { PausableBatchedBackfillRunner, backfillUpdateSql, keysetPageSql } from "./backfill-runner.js";
export type { BackfillRunResult } from "./backfill-runner.js";
export { ContractPhaseExportGuard } from "./contract-guard.js";
export { DdlSafetyClassifier } from "./ddl-safety-classifier.js";
export {
  ActiveDeprecatedReferenceError,
  ApprovalRequiredError,
  BackfillIncompleteError,
  BackupRequiredBeforeLiveMigrationError,
  ContractBlockedError,
  DestructiveDdlInExpandError,
  ExportRequiredBeforeContractError,
  LockHazardBlockedError,
  MigrationConflictError,
  RehearsalCompatibilityError,
} from "./errors.js";
export { executeLiveDdl, isLockTimeoutError, jitterDelayMs, MAX_LOCK_RETRIES } from "./lock-timeout.js";
export {
  ExpandContractMigrationOrchestrator,
} from "./orchestrator.js";
export type { ExpandContractPlan, MigrationHooks, MigrationRunState, OrchestratorDeps } from "./orchestrator.js";
export { LocalTemplateDbSeeder, MapDatabaseVault, PayloadBoundApprovalPolicy, PermissiveMigrationLinter, hashPayload, pgDumpArgs, sqliteOnlineBackup } from "./ports.js";
export type {
  BackupProvider,
  DeployAdapter,
  DeprecatedObjectUseProbe,
  EnvApprovalPolicyEngine,
  ExternalEffectLedger,
  MigrationIntentAndConflictLinter,
  PostDeployHealthCheck,
  SeedSpec,
  TemplateDbSeeder,
  WindowsDpapiSecretsVault,
} from "./ports.js";
export { adaptiveSleepMs, formatBackfillProgress } from "./progress.js";
export { MigrationStateStore, bindMigrationState, PayloadHashMismatchError } from "./state-store.js";
export type { PersistedRun } from "./state-store.js";
export { SqliteSession } from "./sqlite-session.js";
export {
  EXPAND_SPLIT_GUIDANCE,
  LIVE_LOCK_TIMEOUT_MS,
  LIVE_LOCK_TIMEOUT_SQL,
  LOCK_HAZARD_GUIDANCE,
  PHASE_ORDER,
} from "./types.js";
export type {
  ApprovalCard,
  BackfillCheckpoint,
  BackfillSpec,
  DdlClassification,
  DdlSafetyClass,
  PhaseName,
  SqlDialect,
  SqlSession,
  TargetEnv,
} from "./types.js";
