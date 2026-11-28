import type { ApiKeyFamily, DetectedProviderId } from "./api-key-types.js";
import {
  LocalCompliancePolicyLocks,
  type CompliancePolicyLocksPort,
} from "./compliance-locks-port.js";
import {
  anthropicConsolePrefix,
  anthropicOauthPrefix,
  anthropicPreviewStem,
  CLAUDE_SUBSCRIPTION_REJECTION,
  geminiPrefix,
  openAiProjectPrefix,
  openAiStandardPrefix,
  openRouterFamilyStem,
  openRouterPrefix,
} from "./prefix-fragments.js";

export type PrefixDetection =
  | {
      readonly kind: "detected";
      readonly provider: DetectedProviderId;
      readonly keyFamily: Exclude<ApiKeyFamily, "provider_selected" | "custom">;
      readonly normalizedKey: string;
      readonly previewStem: string;
    }
  | {
      readonly kind: "rejected";
      readonly code: "subscription_oauth_rejected";
      readonly message: string;
    }
  | {
      readonly kind: "unknown";
      readonly message: string;
      readonly requiresProviderSelection: true;
      readonly requiresHttpsBaseUrl: true;
    };

const UNKNOWN_PREFIX_MESSAGE =
  "This key prefix is not recognized. Select a provider, or enter a custom OpenAI-compatible base URL. Custom endpoints must use HTTPS (HTTP is allowed only for loopback 127.0.0.1 and ::1).";

export function normalizePastedApiKey(raw: string): string {
  let value = raw.replace(/^\uFEFF/, "").trim();
  for (let layer = 0; layer < 3; layer += 1) {
    if (value.length < 2) break;
    const first = value[0];
    const last = value[value.length - 1];
    const quoted =
      (first === '"' && last === '"') || (first === "'" && last === "'");
    if (!quoted) break;
    value = value.slice(1, -1).trim();
  }
  return value;
}

export class ApiKeyPrefixDetector {
  constructor(
    private readonly locks: CompliancePolicyLocksPort = new LocalCompliancePolicyLocks(),
  ) {}

  inspect(raw: string): PrefixDetection {
    const normalizedKey = normalizePastedApiKey(raw);
    if (normalizedKey.length === 0) {
      return unknownDetection();
    }
    if (normalizedKey.startsWith(anthropicOauthPrefix)) {
      return {
        kind: "rejected",
        code: "subscription_oauth_rejected",
        message: CLAUDE_SUBSCRIPTION_REJECTION,
      };
    }
    const lock = this.locks.inspectApiKey(normalizedKey);
    if (!lock.allowed) {
      return {
        kind: "rejected",
        code: "subscription_oauth_rejected",
        message: lock.message || CLAUDE_SUBSCRIPTION_REJECTION,
      };
    }
    if (normalizedKey.startsWith(anthropicConsolePrefix)) {
      return {
        kind: "detected",
        provider: "anthropic",
        keyFamily: "anthropic_console",
        normalizedKey,
        previewStem: anthropicPreviewStem,
      };
    }
    if (normalizedKey.startsWith(openRouterPrefix)) {
      return {
        kind: "detected",
        provider: "openrouter",
        keyFamily: "openrouter_v1",
        normalizedKey,
        previewStem: openRouterPrefix,
      };
    }
    if (normalizedKey.startsWith(openAiProjectPrefix)) {
      return {
        kind: "detected",
        provider: "openai",
        keyFamily: "openai_project",
        normalizedKey,
        previewStem: openAiProjectPrefix,
      };
    }
    if (
      normalizedKey.startsWith(anthropicPreviewStem) ||
      normalizedKey.startsWith(openRouterFamilyStem)
    ) {
      return unknownDetection();
    }
    if (normalizedKey.startsWith(openAiStandardPrefix)) {
      return {
        kind: "detected",
        provider: "openai",
        keyFamily: "openai_standard",
        normalizedKey,
        previewStem: openAiStandardPrefix,
      };
    }
    if (normalizedKey.startsWith(geminiPrefix)) {
      return {
        kind: "detected",
        provider: "gemini",
        keyFamily: "gemini_developer",
        normalizedKey,
        previewStem: geminiPrefix,
      };
    }
    return unknownDetection();
  }
}

function unknownDetection(): PrefixDetection {
  return {
    kind: "unknown",
    message: UNKNOWN_PREFIX_MESSAGE,
    requiresProviderSelection: true,
    requiresHttpsBaseUrl: true,
  };
}

export function maskKeyPreview(normalizedKey: string, previewStem: string): string {
  const tail = normalizedKey.slice(-4);
  if (normalizedKey.length < previewStem.length + 8) {
    return `••••${tail}`;
  }
  return `${previewStem}...${tail}`;
}

export function previewStemForProvider(
  provider: "anthropic" | "openai" | "openrouter" | "gemini" | "custom",
  normalizedKey: string,
): string {
  if (provider === "anthropic") return anthropicPreviewStem;
  if (provider === "openrouter") return openRouterPrefix;
  if (provider === "gemini") return geminiPrefix;
  if (provider === "openai") {
    return normalizedKey.startsWith(openAiProjectPrefix)
      ? openAiProjectPrefix
      : openAiStandardPrefix;
  }
  return "key";
}
