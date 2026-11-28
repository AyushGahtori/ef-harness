import {
  ApiKeyOnboardingError,
  type ApiKeyProviderId,
  type ValidationFailure,
  type ValidationLogger,
  type ValidationResult,
} from "./api-key-types.js";
import {
  LocalCompliancePolicyLocks,
  type CompliancePolicyLocksPort,
} from "./compliance-locks-port.js";
import {
  checkCustomBaseUrl,
  customModelListUrl,
  isModelListPath,
  MODEL_LIST_ENDPOINTS,
  MODEL_LIST_TIMEOUT_MS,
} from "./endpoint-url.js";
import { assertHeaderOnlyKeyTransport, sanitizeLogText } from "./http-error-sanitizer.js";
import { normalizePastedApiKey } from "./api-key-prefix-detector.js";
import {
  anthropicOauthPrefix,
  CLAUDE_SUBSCRIPTION_REJECTION,
} from "./prefix-fragments.js";

export interface ModelListRequest {
  readonly method: "GET";
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
}

export interface ModelListResponse {
  readonly status: number;
  readonly bodyText: string;
}

export interface ModelListTransport {
  request(input: ModelListRequest): Promise<ModelListResponse>;
}

export const VALIDATION_MESSAGES = {
  invalid_key:
    "This API key was rejected (401 invalid key). Check that you pasted the full key.",
  billing_not_active:
    "This account has no credits (402 billing not active). Add credits in the provider console, then test again.",
  insufficient_quota:
    "This key is valid but billing or credit setup is still needed (insufficient quota). Add a payment method or credits before the first build.",
  org_restriction:
    "This key is blocked by an organization restriction (403). Ask an admin to allow this key or project.",
  rate_limited:
    "The provider rate-limited this check (429). Wait a moment and test again. No completion tokens were used.",
  network_or_proxy_blocked:
    "The model-list check could not reach the provider (network or proxy blocked). You can save unverified and verify before the first build.",
  unreadable_model_list:
    "The key was accepted but the model list could not be read. No completion tokens were used.",
  provider_error:
    "The provider could not complete the model-list check. No completion tokens were used.",
} as const;

export interface ZeroTokenValidatorOptions {
  readonly transport: ModelListTransport;
  readonly locks?: CompliancePolicyLocksPort;
  readonly logger?: ValidationLogger;
  readonly endpoints?: Partial<typeof MODEL_LIST_ENDPOINTS>;
  readonly fetchTimeoutMs?: number;
}

export function createFetchModelListTransport(
  fetchImpl: typeof fetch = globalThis.fetch,
  timeoutMs: number = MODEL_LIST_TIMEOUT_MS,
): ModelListTransport {
  return {
    async request(input) {
      if (input.method !== "GET") {
        throw new ApiKeyOnboardingError("API key validation is limited to GET model-list requests");
      }
      if (!isModelListPath(input.url)) {
        throw new ApiKeyOnboardingError("API key validation can only call a model-list endpoint");
      }
      const response = await fetchImpl(input.url, {
        method: "GET",
        headers: { ...input.headers },
        signal: AbortSignal.timeout(timeoutMs),
      });
      return { status: response.status, bodyText: await response.text() };
    },
  };
}

export function createLiveZeroTokenApiKeyValidator(
  options: Omit<ZeroTokenValidatorOptions, "transport"> & { readonly fetchImpl?: typeof fetch } = {},
): ZeroTokenApiKeyValidator {
  const { fetchImpl, ...rest } = options;
  return new ZeroTokenApiKeyValidator({
    ...rest,
    transport: createFetchModelListTransport(fetchImpl, rest.fetchTimeoutMs),
  });
}

export class ZeroTokenApiKeyValidator {
  private readonly transport: ModelListTransport;
  private readonly locks: CompliancePolicyLocksPort;
  private readonly logger: ValidationLogger | undefined;
  private readonly endpoints: typeof MODEL_LIST_ENDPOINTS;

  constructor(options: ZeroTokenValidatorOptions) {
    this.transport = options.transport;
    this.locks = options.locks ?? new LocalCompliancePolicyLocks();
    this.logger = options.logger;
    this.endpoints = { ...MODEL_LIST_ENDPOINTS, ...options.endpoints };
  }

  async validate(input: {
    readonly apiKey: string;
    readonly provider: ApiKeyProviderId;
    readonly customBaseUrl?: string;
  }): Promise<ValidationResult> {
    const normalizedKey = normalizePastedApiKey(input.apiKey);
    if (normalizedKey.startsWith(anthropicOauthPrefix)) {
      return failure("subscription_oauth_rejected", CLAUDE_SUBSCRIPTION_REJECTION, null, null);
    }
    const lock = this.locks.inspectApiKey(normalizedKey);
    if (!lock.allowed) {
      return failure(
        lock.code === "subscription_oauth_rejected" ? "subscription_oauth_rejected" : "compliance_rejected",
        lock.message || CLAUDE_SUBSCRIPTION_REJECTION,
        null,
        null,
      );
    }

    const endpoint = this.resolveEndpoint(input.provider, input.customBaseUrl);
    if (!endpoint.ok) {
      return failure("insecure_base_url", endpoint.message, null, null);
    }
    try {
      assertHeaderOnlyKeyTransport(endpoint.url, normalizedKey);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Refused to send the API key in a URL";
      return failure("insecure_base_url", message, null, endpoint.url);
    }

    const headers = headersFor(input.provider, normalizedKey);
    try {
      const response = await this.transport.request({
        method: "GET",
        url: endpoint.url,
        headers,
      });
      this.log(
        `model-list status=${response.status} url=${endpoint.url} body=${response.bodyText.slice(0, 500)}`,
        normalizedKey,
      );
      return this.interpret(input.provider, endpoint.url, response.status, response.bodyText);
    } catch (error) {
      const detail = error instanceof Error ? error.message : "network error";
      this.log(`model-list transport failure: ${detail}`, normalizedKey);
      return failure("network_or_proxy_blocked", VALIDATION_MESSAGES.network_or_proxy_blocked, null, endpoint.url);
    }
  }

  private resolveEndpoint(
    provider: ApiKeyProviderId,
    customBaseUrl: string | undefined,
  ): { readonly ok: true; readonly url: string } | { readonly ok: false; readonly message: string } {
    if (provider === "custom") {
      if (!customBaseUrl) {
        return { ok: false, message: "Enter a custom OpenAI-compatible base URL." };
      }
      const checked = checkCustomBaseUrl(customBaseUrl);
      if (!checked.ok) return checked;
      return { ok: true, url: customModelListUrl(checked.base) };
    }
    const url = this.endpoints[provider];
    return { ok: true, url };
  }

  private interpret(
    provider: ApiKeyProviderId,
    endpoint: string,
    status: number,
    bodyText: string,
  ): ValidationResult {
    if (status === 200) {
      try {
        return {
          ok: true,
          provider,
          discoveredModels: modelIdsFromBody(bodyText),
          completionTokensBilled: 0,
          endpoint,
          method: "GET",
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : VALIDATION_MESSAGES.unreadable_model_list;
        return failure("unreadable_model_list", message, status, endpoint);
      }
    }
    const classified = classifyStatus(status, bodyText);
    return failure(classified.failureClass, classified.message, status, endpoint);
  }

  private log(line: string, secret: string): void {
    this.logger?.write(sanitizeLogText(line, [secret]));
  }
}

function headersFor(provider: ApiKeyProviderId, apiKey: string): Record<string, string> {
  if (provider === "gemini") {
    return {
      "x-goog-api-key": apiKey,
      accept: "application/json",
    };
  }
  if (provider === "anthropic") {
    return {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      accept: "application/json",
    };
  }
  return {
    Authorization: `Bearer ${apiKey}`,
    accept: "application/json",
  };
}

function classifyStatus(
  status: number,
  bodyText: string,
): { readonly failureClass: ValidationFailure["failureClass"]; readonly message: string } {
  const lower = bodyText.toLowerCase();
  const quota = lower.includes("insufficient_quota") || lower.includes("insufficient quota");
  const billing = lower.includes("billing_not_active") || lower.includes("billing not active");
  if (status === 401) {
    return { failureClass: "invalid_key", message: VALIDATION_MESSAGES.invalid_key };
  }
  if (status === 403) {
    return { failureClass: "org_restriction", message: VALIDATION_MESSAGES.org_restriction };
  }
  if (status === 402 || billing) {
    return { failureClass: "billing_not_active", message: VALIDATION_MESSAGES.billing_not_active };
  }
  if (status === 429 && quota) {
    return { failureClass: "insufficient_quota", message: VALIDATION_MESSAGES.insufficient_quota };
  }
  if (status === 429) {
    return { failureClass: "rate_limited", message: VALIDATION_MESSAGES.rate_limited };
  }
  return { failureClass: "provider_error", message: VALIDATION_MESSAGES.provider_error };
}

function modelIdsFromBody(bodyText: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText) as unknown;
  } catch (error) {
    const reason = error instanceof Error ? error.name : "SyntaxError";
    throw new ApiKeyOnboardingError(
      `${VALIDATION_MESSAGES.unreadable_model_list} (${reason})`,
    );
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new ApiKeyOnboardingError(VALIDATION_MESSAGES.unreadable_model_list);
  }
  const record = parsed as Record<string, unknown>;
  const rows = Array.isArray(record.data) ? record.data : Array.isArray(record.models) ? record.models : null;
  if (!rows) {
    throw new ApiKeyOnboardingError(VALIDATION_MESSAGES.unreadable_model_list);
  }
  const ids: string[] = [];
  for (const row of rows) {
    if (typeof row !== "object" || row === null) continue;
    const item = row as Record<string, unknown>;
    const id = typeof item.id === "string" ? item.id : typeof item.name === "string" ? item.name : "";
    const trimmed = id.trim();
    if (trimmed.length > 0) ids.push(trimmed);
  }
  return [...new Set(ids)].sort((left, right) => left.localeCompare(right));
}

function failure(
  failureClass: ValidationFailure["failureClass"],
  message: string,
  httpStatus: number | null,
  endpoint: string | null,
): ValidationFailure {
  return {
    ok: false,
    failureClass,
    message,
    completionTokensBilled: 0,
    httpStatus,
    endpoint,
    method: "GET",
  };
}
