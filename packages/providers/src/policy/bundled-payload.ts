import { GEMINI_INVOCATION, GEMINI_POLICY_NOTICE, siwcPreviewConstraints } from "./compliance-policy-locks.js";
import type { CliFloor, PolicyModel, PolicyRoute, UnsignedProviderPolicy } from "./types.js";

const PUBLISHED_AT = "2026-11-17T00:00:00.000Z";
const REFRESH_URL = "https://updates.ef-harness.invalid/provider-policy.json";

const PRIORS = {
  trivial: 0.97,
  standard: 0.9,
  complex: 0.72,
  critical: 0.58,
};

export function bundledPolicyUnsigned(): UnsignedProviderPolicy {
  return {
    policyVersion: 2026111701,
    publishedAt: PUBLISHED_AT,
    refreshUrl: REFRESH_URL,
    compliance: {
      immutable: true,
      anthropicConsoleOnly: true,
      subscriptionOauthWithdrawn: true,
      geminiCliDefaultEnabled: false,
      geminiRequiresExplicitOptIn: true,
      geminiInvocation: GEMINI_INVOCATION,
      geminiNotice: GEMINI_POLICY_NOTICE,
      geminiReadsCredentialDirectory: false,
      forbiddenVendorDenied: true,
      siwc: siwcPreviewConstraints(),
    },
    routes: [
      route({
        id: "openai_api",
        provider: "openai",
        authFlow: "api_key",
        status: "allowed",
        billing: "api_key",
      }),
      route({
        id: "siwc_preview",
        provider: "openai",
        authFlow: "siwc",
        status: "allowed",
        billing: "plan",
        alternatives: ["Switch Connection", "Keep Parked"],
        constraints: siwcPreviewConstraints(),
      }),
      route({
        id: "anthropic_console",
        provider: "anthropic",
        authFlow: "console_api_key",
        status: "allowed",
        billing: "api_key",
        consoleKeyOnly: true,
      }),
      route({
        id: "claude_code",
        provider: "anthropic",
        authFlow: "console_api_key",
        status: "allowed",
        billing: "api_key",
        consoleKeyOnly: true,
      }),
      route({
        id: "gemini_cli_acp",
        provider: "google",
        authFlow: "unmodified_cli",
        status: "opt_in_with_notice",
        billing: "plan",
        defaultEnabled: false,
        invocation: GEMINI_INVOCATION,
        notice: GEMINI_POLICY_NOTICE,
      }),
      route({
        id: "copilot_sdk",
        provider: "github",
        authFlow: "device_oauth",
        status: "allowed",
        billing: "plan",
      }),
      route({
        id: "cursor_sdk",
        provider: "cursor",
        authFlow: "browser",
        status: "allowed",
        billing: "plan",
      }),
      route({
        id: "openrouter",
        provider: "openrouter",
        authFlow: "pkce",
        status: "allowed",
        billing: "api_key",
      }),
      route({
        id: "local_ollama",
        provider: "ollama",
        authFlow: "loopback",
        status: "allowed",
        billing: "local",
      }),
      route({
        id: "local_lmstudio",
        provider: "lmstudio",
        authFlow: "loopback",
        status: "allowed",
        billing: "local",
      }),
      route({
        id: "codex_cli",
        provider: "openai",
        authFlow: "cli",
        status: "allowed",
        billing: "plan",
      }),
    ],
    cliFloors: [
      floor("codex", "0.42.0", [
        {
          from: "0.40.0",
          to: "0.41.9",
          effect: "disabled",
          reason: "leaks processes or breaks permission hooks",
        },
      ]),
      floor("claude", "2.1.0", []),
      floor("copilot", "1.0.0", [
        {
          from: "1.2.0",
          to: "1.2.3",
          effect: "observe-only",
          reason: "breaks permission hooks",
        },
      ]),
      floor("cursor-agent", "1.0.0", []),
      floor("opencode", "0.5.0", []),
      floor("gemini", "0.20.0", []),
    ],
    models: [
      model({
        modelId: "openai-general-mid",
        family: "openai",
        provider: "openai",
        tier: "mid",
        supportsVision: true,
        inputMicroUsdPer1M: 2_500_000,
        outputMicroUsdPer1M: 10_000_000,
        cachedInputMicroUsdPer1M: 250_000,
      }),
      model({
        modelId: "anthropic-console-senior",
        family: "anthropic",
        provider: "anthropic",
        tier: "senior",
        inputMicroUsdPer1M: 3_000_000,
        outputMicroUsdPer1M: 15_000_000,
        cachedInputMicroUsdPer1M: 300_000,
      }),
      model({
        modelId: "model-old-v1",
        family: "legacy",
        provider: "openai",
        tier: "junior",
        contextWindow: 16_384,
        supportsVision: false,
        inputMicroUsdPer1M: 1_000_000,
        outputMicroUsdPer1M: 2_000_000,
        cachedInputMicroUsdPer1M: 100_000,
      }),
      model({
        modelId: "gemini-api-flash",
        family: "google",
        provider: "google",
        tier: "junior",
        inputMicroUsdPer1M: 150_000,
        outputMicroUsdPer1M: 600_000,
        cachedInputMicroUsdPer1M: 15_000,
      }),
    ],
  };
}

function route(overrides: Partial<PolicyRoute> & Pick<PolicyRoute, "id" | "provider" | "authFlow" | "status" | "billing">): PolicyRoute {
  return {
    revocationNotice: null,
    alternatives: [],
    defaultEnabled: overrides.status === "allowed",
    invocation: null,
    notice: null,
    readsCredentialDirectory: false,
    consoleKeyOnly: false,
    constraints: null,
    ...overrides,
  };
}

function floor(runtime: CliFloor["runtime"], minVersion: string, denylist: CliFloor["denylist"]): CliFloor {
  return { runtime, minVersion, denylist };
}

function model(
  overrides: Pick<PolicyModel, "modelId" | "family" | "provider" | "tier"> & Partial<PolicyModel>,
): PolicyModel {
  return {
    contextWindow: 128_000,
    supportsTools: true,
    supportsStructuredJson: true,
    supportsVision: false,
    inputMicroUsdPer1M: 0,
    outputMicroUsdPer1M: 0,
    cachedInputMicroUsdPer1M: 0,
    defaultPassPriors: { ...PRIORS },
    deprecatedAfter: null,
    replacementModelId: null,
    revoked: false,
    ...overrides,
  };
}
