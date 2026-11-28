import type { ExplicitNumCtx, LocalServerKind } from "./constants.js";

/**
 * Task 120 `WindowsDpapiSecretsVault`.
 * `BrokerOpenRouterVault` is the production adapter. Plaintext stays in the vault.
 */
export interface DpapiPutInput {
  readonly projectId: string;
  readonly envScope: "test" | "dev" | "staging" | "prod";
  readonly name: string;
  readonly value: string;
  readonly providerHint?: string;
}

export interface DpapiSecretHandle {
  readonly secretId: string;
  readonly lastFourMasked: string;
  readonly name: string;
}

export interface DpapiSecretMaterial {
  readonly secretId: string;
  readonly name: string;
  readonly value: string;
}

export interface DpapiSecretsVaultPort {
  put(input: DpapiPutInput): Promise<DpapiSecretHandle>;
  readSecret(secretId: string): Promise<DpapiSecretMaterial | null>;
  delete(secretId: string): Promise<unknown>;
}

/**
 * Task 014 `GlobalBrokerDb.connections`.
 * Column names match `schema/global.sql`. Profile metadata lives in `connection_profiles`.
 */
export type ConnectionRoute =
  | "api_key"
  | "siwc"
  | "codex_app_server"
  | "copilot_sdk"
  | "cursor_sdk"
  | "claude_cli"
  | "gemini_cli"
  | "local";

export interface GlobalConnectionRecord {
  readonly id: string;
  readonly provider: string;
  readonly route: ConnectionRoute;
  readonly plan: string | null;
  readonly vaultRef: string | null;
  readonly currency: string;
  readonly scale: number;
  readonly enabled: boolean;
  readonly createdAt: number;
}

export interface GlobalConnectionsPort {
  insert(row: GlobalConnectionRecord): Promise<void>;
  get(id: string): Promise<GlobalConnectionRecord | null>;
  list(): Promise<readonly GlobalConnectionRecord[]>;
  delete(id: string): Promise<void>;
}

/**
 * Task 128 wind-down binding.
 * Integration sets `AtomicBudgetReservationLedger` `microUsdLimit` to `limitMicroUsd`,
 * posts `usedMicroUsd` as historical spend, and lets the 90% ladder stop before the cap.
 */
export interface OpenRouterCreditBinding {
  readonly connectionId: string;
  readonly limitMicroUsd: number | null;
  readonly usedMicroUsd: number;
  readonly remainingMicroUsd: number | null;
  readonly windDownStartsAtMicroUsd: number | null;
  readonly pastWindDown: boolean;
  readonly exhausted: boolean;
  readonly display: string;
  readonly reason: "oauth" | "build_start" | "turn_interval" | "payment_required";
}

export interface CreditWindDownPort {
  bindOpenRouterCredit(binding: OpenRouterCreditBinding): void;
}

/**
 * Task 117 DXGI sample. Field names match `GpuSample` on `HardwareSnapshot`.
 */
export interface GpuHeadroomSample {
  readonly gpuAvailable: boolean;
  readonly budgetBytes: number | null;
  readonly currentUsageBytes: number | null;
  readonly availableForReservationBytes: number | null;
  readonly sharedVramBudgetBytes: number | null;
  readonly metricUnavailable: boolean;
}

export interface VramTelemetryPort {
  sampleGpu(): GpuHeadroomSample | Promise<GpuHeadroomSample>;
}

/**
 * Task 118 `GpuWhisperPriorityArbiter`.
 * `activateDictation` is the dictation hotkey. New local dispatches stay queued.
 */
export interface WhisperDispatch {
  readonly id: string;
  readonly modelId: string;
  readonly vramMb: number;
  readonly role: "background" | "foreground";
  readonly start: "now" | "queued";
}

export interface WhisperTicket {
  readonly state: "queued" | "granted";
  readonly reason: string;
}

export interface WhisperPriorityPort {
  readonly dictationActive: boolean;
  activateDictation(modelClass?: "base" | "small"): void;
  deactivateDictation(): void;
  enqueueLocalModel(request: WhisperDispatch): WhisperTicket;
}

/** Electron `shell.openExternal`. This package never opens a password WebView. */
export interface ExternalBrowserPort {
  openExternal(url: string): Promise<void>;
}

export interface FetchPort {
  (input: string, init?: RequestInit): Promise<Response>;
}

export interface OpenRouterBalance {
  readonly limitUsd: number | null;
  readonly usageUsd: number;
  readonly limitRemainingUsd: number | null;
}

export interface OpenRouterCostReceipt {
  readonly reported: true;
  readonly currency: "usd";
  readonly costMicroUsd: number;
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly totalTokens: number;
}

export interface LocalTurnReceipt {
  readonly currency: "local_slots";
  readonly costMicroUsd: 0;
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly totalTokens: number;
  readonly wallClockSeconds: number;
  readonly tokensPerSecond: number;
}

export interface DiscoveredLocalModel {
  readonly server: LocalServerKind;
  readonly modelId: string;
  readonly family: string;
  readonly parameterSize: string | null;
  readonly quantization: string | null;
  readonly configuredNumCtx: number | null;
  readonly architectureContext: number | null;
  readonly digest: string;
  readonly modelBytes: number | null;
  readonly vramBytes: number | null;
  readonly loadedInVram: boolean;
  readonly baseUrl: string;
}

export type LocalModelRole = "coding_worker" | "chat_or_summary_only";

export interface LocalProbeResult {
  readonly modelId: string;
  readonly digest: string;
  readonly server: LocalServerKind;
  readonly contextTokens: number | null;
  readonly contextWarning: string | null;
  readonly seniorWarning: string | null;
  readonly supportsTools: boolean;
  readonly supportsStructuredJson: boolean;
  readonly role: LocalModelRole;
  readonly tokensPerSecond: number;
  readonly cached: boolean;
  readonly numCtxPassed: ExplicitNumCtx | null;
}

export interface LocalServerDiagnosis {
  readonly server: LocalServerKind;
  readonly paused: true;
  readonly retryable: true;
  readonly message: string;
}
