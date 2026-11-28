export { ConformanceVersionCache, probeDigest, verdictPayload } from "./cache.js";
export { AutomaticTrustDowngrader, needsStrippedRetry } from "./downgrade.js";
export { ConformanceError, ConformanceAbortedError } from "./errors.js";
export { LocalWindowsJobSupervisor } from "./job.js";
export type { JobRun, WindowsJobSupervisorPort } from "./job.js";
export { LiveCliTransport } from "./live.js";
export { runConformanceCli, runConformanceMatrix, runRogueGauntlet } from "./matrix.js";
export type { ConformanceCliResult, MatrixResult, RogueGauntletResult } from "./matrix.js";
export { ConformancePermissionEngine, OsSandboxBroker } from "./permission.js";
export {
  DISABLED_ROGUES,
  FOREIGN_ADAPTERS,
  STRIPPED_ROGUES,
  compliantBehavior,
  rogueBehavior,
} from "./profiles.js";
export type { ForeignAdapterProfile, RogueProfile } from "./profiles.js";
export {
  InMemoryAdapterConformanceDb,
  InMemoryAdapterRegistry,
  LocalCliMinVersionGate,
  LocalForeignRuntimeResumeCoordinator,
  LocalLoopbackAllowlistProxy,
  LocalVerdictSigner,
  RequestedSandboxTierSelector,
} from "./ports.js";
export type {
  AdapterConformanceRecord,
  AdapterRegistryPort,
  CliMinVersionGatePort,
  CodingDispatch,
  ForeignRuntimeResumeCoordinatorPort,
  GlobalDbConformancePort,
  LoopbackAllowlistProxyPort,
  ResumeOutcome,
  SandboxTierSelectorPort,
  TrapEndpoint,
  VerdictSignerPort,
} from "./ports.js";
export { redactText } from "./redaction.js";
export { AdapterConformanceRunner, createConformanceStack } from "./runner.js";
export type { ConformanceDependencies, ConformanceStack } from "./runner.js";
export { exportScorecard } from "./scorecard.js";
export type { ConformanceScorecard } from "./scorecard.js";
export {
  ALLOWED_EDITED,
  CANARY_MARKER,
  CREDENTIAL_MARKER,
  EXTERNAL_EXFIL_URL,
  HARNESS_CONFORMANCE_SUITE_VERSION,
  HOOK_PROBE_IDS,
  PROBE_IDS,
  PROBE_NAMES,
  SAFE_PROBE_COMMAND,
  SECURITY_PROBE_IDS,
  WRITE_SCOPE,
  cacheKeyId,
  isHookProbe,
  isSecurityProbe,
  probeEscapes,
  usageIsNonEmpty,
} from "./types.js";
export type {
  AdapterBehavior,
  AdapterMode,
  CleanupProof,
  ConformanceCacheKey,
  ConformanceDriverKind,
  ConformanceReport,
  ConformanceRunRequest,
  ConformanceTrigger,
  ForensicReceipt,
  NormalizedUsageReceipt,
  ProbeId,
  ProbeResult,
  ProbeStatus,
  SandboxTierId,
  ScratchReadyPaths,
  SecurityViolation,
  TrustLevel,
} from "./types.js";
