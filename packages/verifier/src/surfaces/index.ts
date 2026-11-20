export {
  ApiContractCheckSchema,
  AuthCallbackCheckSchema,
  BackgroundJobCheckSchema,
  CliSurfaceCheckSchema,
  ColumnSpecSchema,
  ConcurrencyPerfCheckSchema,
  InboundWebhookCheckSchema,
  MigrationPreservationCheckSchema,
  RateLimitBurstCheckSchema,
  TimeBoundaryCheckSchema,
} from "./schemas.js";
export type {
  ApiContractCheck,
  AuthCallbackCheck,
  BackgroundJobCheck,
  CliSurfaceCheck,
  ColumnSpec,
  ConcurrencyPerfCheck,
  InboundWebhookCheck,
  MigrationPreservationCheck,
  RateLimitBurstCheck,
  TimeBoundaryCheck,
} from "./schemas.js";

export { ApiContractVerifier } from "./api-contract-verifier.js";
export { AuthCallbackVerifier } from "./auth-callback-verifier.js";
export { TimeBoundaryVerifier } from "./time-boundary-verifier.js";
export { BackgroundJobVerifier } from "./background-job-verifier.js";
export { CliSurfaceVerifier } from "./cli-surface-verifier.js";
export { ConcurrencyPerfVerifier } from "./concurrency-perf-verifier.js";
export { MigrationPreservationVerifier } from "./migration-preservation-verifier.js";
export { InboundWebhookVerifier } from "./inbound-webhook-verifier.js";
export { RateLimitBurstVerifier } from "./rate-limit-burst-verifier.js";

export {
  CORE_SURFACE_VERIFIER_IDS,
  createDefaultSurfaceRegistry,
  createSurfaceVerifierRegistry,
  registerCoreSurfaceVerifiers,
  registerCrossCuttingSurfaceVerifiers,
} from "./registry.js";

export { analyzeMigrationSql } from "./destructive-sql.js";
export { checksumsEqual, computeTableChecksums } from "./checksum.js";
export { resolveCivilInstants, formatZoneParts } from "./zone-clock.js";
export { createAsyncBarrier } from "./ports/barrier.js";
export { InProcessOAuthMockProvider } from "./ports/oauth-mock.js";
export { GenericWebhookDeliverer, signWebhook } from "./ports/webhook-deliverer.js";
export { LocalHarnessRunEngine } from "./ports/harness-run.js";
export type { HarnessRunEngine, SandboxedCommandResult } from "./ports/harness-run.js";
export {
  FIXTURE_BOUNDARY_DATES,
  FIXTURE_ORPHAN_ID,
  FIXTURE_UNICODE,
  generateMigrationPredecessorFixture,
} from "./ports/synthetic-data.js";
export { createDefaultDatabaseEngine, openTier3Database } from "./ports/database.js";
export type { DatabaseEnginePort, MigrationSession } from "./ports/database.js";
export { createOsCpuSampler } from "./ports/cpu.js";
export type { HostCpuSampler } from "./ports/cpu.js";
export { toCheckResultRow } from "./result.js";
export type {
  AttemptEnvironment,
  CheckResultRow,
  SurfaceCheckResult,
  SurfaceVerifierAdapter,
  SurfaceVerifierContext,
  SurfaceVerifierRegistry,
} from "./types.js";
