export const API_KEY_AUTH_MODE = "api_key" as const;

export const MICRO_USD_SCALE = 1_000_000;

export type ApiKeyProviderId = "anthropic" | "openai" | "openrouter" | "gemini" | "custom";

export type DetectedProviderId = Exclude<ApiKeyProviderId, "custom">;

export type ApiKeyFamily =
  | "anthropic_console"
  | "openai_project"
  | "openai_standard"
  | "openrouter_v1"
  | "gemini_developer"
  | "provider_selected"
  | "custom";

export type ConnectionStatus =
  | "verified"
  | "unverified_offline"
  | "billing_not_active"
  | "insufficient_quota"
  | "org_restriction"
  | "rate_limited"
  | "provider_error"
  | "rejected_by_provider"
  | "disabled";

export type ValidationFailureClass =
  | "invalid_key"
  | "billing_not_active"
  | "insufficient_quota"
  | "org_restriction"
  | "rate_limited"
  | "network_or_proxy_blocked"
  | "insecure_base_url"
  | "subscription_oauth_rejected"
  | "compliance_rejected"
  | "unreadable_model_list"
  | "provider_error";

export type PricingStatus =
  | "estimated"
  | "provider_reported"
  | "unpriced_custom_endpoint"
  | "unpriced_unknown_model";

export type PricingSource = "estimated" | "provider_reported" | "unpriced";

export interface CustomRateTable {
  readonly inputMicroUsdPer1M: bigint;
  readonly outputMicroUsdPer1M: bigint;
  readonly cachedInputReadMicroUsdPer1M: bigint;
  readonly cacheWriteMicroUsdPer1M: bigint;
  readonly reasoningTokenMicroUsdPer1M: bigint;
}

export interface ModelMicroUsdRates extends CustomRateTable {
  readonly modelId: string;
  readonly provider: DetectedProviderId;
}

export interface ApiConnectionRecord {
  readonly connectionId: string;
  readonly provider: ApiKeyProviderId;
  readonly label: string;
  readonly authMode: typeof API_KEY_AUTH_MODE;
  readonly maskedKeyPreview: string;
  readonly discoveredModels: readonly string[];
  readonly userMonthlyCapMicroUsd: bigint | null;
  readonly verifiedAt: number | null;
  readonly status: ConnectionStatus;
  readonly resumeStatus: ConnectionStatus | null;
  readonly enabled: boolean;
  readonly keyFamily: ApiKeyFamily;
  readonly customBaseUrl: string | null;
  readonly customRates: CustomRateTable | null;
  readonly vaultRef: string;
  readonly createdAt: number;
  readonly currency: "usd";
  readonly scale: typeof MICRO_USD_SCALE;
}

export interface ValidationSuccess {
  readonly ok: true;
  readonly provider: ApiKeyProviderId;
  readonly discoveredModels: readonly string[];
  readonly completionTokensBilled: 0;
  readonly endpoint: string;
  readonly method: "GET";
}

export interface ValidationFailure {
  readonly ok: false;
  readonly failureClass: ValidationFailureClass;
  readonly message: string;
  readonly completionTokensBilled: 0;
  readonly httpStatus: number | null;
  readonly endpoint: string | null;
  readonly method: "GET";
}

export type ValidationResult = ValidationSuccess | ValidationFailure;

export interface TurnTokenUsage {
  readonly modelId: string;
  readonly inputTokens: bigint;
  readonly outputTokens: bigint;
  readonly cachedReadTokens?: bigint;
  readonly cacheWriteTokens?: bigint;
  readonly reasoningTokens?: bigint;
  readonly connectionId?: string;
  readonly endpointKind?: "catalog" | "custom";
  readonly customRates?: CustomRateTable;
}

export interface ApiCostLedgerEntry {
  readonly entryId: string;
  readonly connectionId: string | null;
  readonly modelId: string;
  readonly priceTableVersion: string;
  readonly pricingSource: PricingSource;
  readonly pricingStatus: PricingStatus;
  readonly estimated: boolean;
  readonly label: string;
  readonly costMicroUsd: bigint;
  readonly inputTokens: bigint;
  readonly outputTokens: bigint;
  readonly cachedReadTokens: bigint;
  readonly cacheWriteTokens: bigint;
  readonly reasoningTokens: bigint;
}

export interface PromptCacheEconomicsHint {
  readonly provider: ApiKeyProviderId;
  readonly mechanism:
    | "ephemeral_breakpoints"
    | "automatic_prefix"
    | "context_cache"
    | "upstream_passthrough"
    | "none";
  readonly prefixStability: "required" | "automatic" | "explicit_cache" | "unsupported";
  readonly stablePrefixRequired: boolean;
  readonly cacheTtlSeconds: number | null;
  readonly breakpointControl: "explicit" | "automatic" | "upstream" | "none";
  readonly guidance: string;
}

export interface ValidationLogger {
  write(line: string): void;
}

export class ApiKeyOnboardingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApiKeyOnboardingError";
  }
}
