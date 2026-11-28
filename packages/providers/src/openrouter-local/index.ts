export {
  CREDIT_POLL_EVERY_TURNS,
  DEFAULT_LM_STUDIO_ORIGIN,
  DEFAULT_OLLAMA_ORIGIN,
  DEFAULT_OPENROUTER_ORIGIN,
  DISCOVERY_TIMEOUT_MS,
  GIB,
  JUNIOR_CONTEXT_FLOOR,
  LM_STUDIO_STOPPED_MESSAGE,
  LOCAL_SLOT_CURRENCY,
  MICRO_USD_SCALE,
  NO_LOCAL_SERVERS_MESSAGE,
  OLLAMA_STOPPED_MESSAGE,
  PROBE_NONCE,
  PROBE_TIMEOUT_MS,
  PROBE_TOOL_NAME,
  SENIOR_CONTEXT_RECOMMENDED,
  SINGLE_SLOT_VRAM_CEILING_BYTES,
  USD_CURRENCY,
} from "./constants.js";
export type { ExplicitNumCtx, LocalServerKind, LoopbackHost } from "./constants.js";

export { OpenRouterLocalError, OpenRouterOAuthCancelledError } from "./errors.js";

export {
  formatUsd,
  formatUsdFromMicro,
  maskLastFour,
  openRouterRemainingDisplay,
  usdToMicroUsd,
  windDownStartsAtMicroUsd,
} from "./money.js";

export { codeChallengeS256, createPkcePair, isPkceVerifier } from "./pkce.js";
export type { PkcePair } from "./pkce.js";

export { assertDiscoveryUrl, isLoopbackHost, loopbackOrigin } from "./loopback-url.js";
export type { DiscoveryTarget } from "./loopback-url.js";

export { LoopbackCallbackServer } from "./loopback-server.js";
export type { LoopbackCallback } from "./loopback-server.js";

export { BrokerOpenRouterConnections, BrokerOpenRouterVault } from "./broker-ports.js";
export type { OpenRouterVaultOptions } from "./broker-ports.js";

export {
  InMemoryCreditWindDown,
  InMemoryDpapiSecretsVault,
  InMemoryGlobalConnections,
  InMemoryVramTelemetry,
  InMemoryWhisperPriority,
  connectionStorageRow,
} from "./memory-ports.js";

export type {
  ConnectionRoute,
  CreditWindDownPort,
  DiscoveredLocalModel,
  DpapiPutInput,
  DpapiSecretHandle,
  DpapiSecretMaterial,
  DpapiSecretsVaultPort,
  ExternalBrowserPort,
  FetchPort,
  GlobalConnectionRecord,
  GlobalConnectionsPort,
  GpuHeadroomSample,
  LocalModelRole,
  LocalProbeResult,
  LocalServerDiagnosis,
  LocalTurnReceipt,
  OpenRouterBalance,
  OpenRouterCostReceipt,
  OpenRouterCreditBinding,
  VramTelemetryPort,
  WhisperDispatch,
  WhisperPriorityPort,
  WhisperTicket,
} from "./ports.js";

export {
  OpenRouterPkceOAuthFlow,
  bindingFromBalance,
  buildOpenRouterAuthorizeUrl,
  ingestOpenRouterUsageCost,
  parseOpenRouterKeyBalance,
} from "./oauth-flow.js";
export type { OpenRouterOAuthResult, OpenRouterPkceOAuthFlowOptions } from "./oauth-flow.js";

export { OpenRouterCreditBalanceGuard } from "./credit-guard.js";
export type { OpenRouterCreditGuardOptions } from "./credit-guard.js";

export {
  LocalModelAutoDiscoverer,
  architectureContextFromInfo,
  configuredNumCtxFromParameters,
  diagnosisForStoppedServer,
  rememberDiscoveredServers,
} from "./discover.js";
export type { DiscoveryReport, DiscoverySettings, ServerProbe } from "./discover.js";

export {
  LocalModelCapabilityProber,
  buildProbeRequest,
  contextTooSmallMessage,
  effectiveContextTokens,
  formatContextTokens,
  parseGeneration,
  seniorContextWarning,
  tokensPerSecond,
} from "./probe.js";
export type { CapabilityProbeOptions, ProbeChatRequest } from "./probe.js";

export {
  LocalVramSlotManager,
  assertExplicitNumCtx,
  buildOllamaChatBody,
  chooseExplicitNumCtx,
  estimateKvCacheBytes,
  estimateRequiredVramBytes,
  localTurnReceipt,
} from "./vram.js";
export type { OllamaChatBody, VramAcquireRequest, VramAcquireResult, VramSlotManagerOptions } from "./vram.js";

export { LocalOnlyOfflineMode, planLocalOfflineRun } from "./offline.js";
export type { OfflinePhase, OfflineRunPlan } from "./offline.js";

export { toLocalModelCapabilities } from "./roster.js";
export type { LocalModelCapabilitiesUpdate, LocalRosterModelDraft, PassPriorsDraft } from "./roster.js";
