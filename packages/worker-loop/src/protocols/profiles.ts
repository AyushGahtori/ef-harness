import { ModelRequestError } from "./types.js";
import type {
  EditFormat,
  ModelProfile,
  ModelRoute,
  ProtocolFamily,
  RouteConstraints,
  ToolCallReliabilityTier,
} from "./types.js";

const SMALL_CONTEXT_TOKENS = 32_768;
const MIN_CODING_CONTEXT_TOKENS = 16_384;

export class ModelProfileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModelProfileError";
  }
}

export function normalizeModelProfile(input: ModelProfile): ModelProfile {
  assertProfile(input);
  const smallContext = input.smallContext || input.contextWindow <= SMALL_CONTEXT_TOKENS;
  return Object.freeze({
    ...input,
    smallContext,
    routeConstraints: Object.freeze({ ...input.routeConstraints }),
  });
}

export class ModelProfileRegistry {
  private readonly byId = new Map<string, ModelProfile>();

  register(profile: ModelProfile): void {
    const normalized = normalizeModelProfile(profile);
    if (this.byId.has(normalized.id)) {
      throw new ModelProfileError(`duplicate model profile ${normalized.id}`);
    }
    this.byId.set(normalized.id, normalized);
  }

  get(id: string): ModelProfile {
    const profile = this.byId.get(id);
    if (!profile) throw new ModelProfileError(`unknown model profile ${id}`);
    return profile;
  }

  tryGet(id: string): ModelProfile | null {
    return this.byId.get(id) ?? null;
  }

  list(): readonly ModelProfile[] {
    return [...this.byId.values()];
  }

  canAssignCodingTask(id: string): boolean {
    const profile = this.get(id);
    return profile.supportsToolCalling && profile.contextWindow >= MIN_CODING_CONTEXT_TOKENS;
  }
}

export function createDefaultModelProfileRegistry(): ModelProfileRegistry {
  const registry = new ModelProfileRegistry();
  for (const profile of defaultModelProfiles()) registry.register(profile);
  return registry;
}

export function defaultModelProfiles(): readonly ModelProfile[] {
  return [
    profile({
      id: "gpt-5",
      provider: "openai",
      family: "openai-gpt",
      contextWindow: 400_000,
      maxOutputTokens: 128_000,
      editFormat: "apply_patch",
      supportsParallelToolCalls: true,
      supportsReasoningReplay: true,
      supportsStreamingToolArgs: true,
      toolCallReliabilityTier: "high",
      supportsPromptCaching: true,
      supportsToolCalling: true,
      smallContext: false,
      routeConstraints: constraints("openai_responses", ["api_key"]),
    }),
    profile({
      id: "gpt-5-siwc",
      provider: "openai",
      family: "openai-gpt",
      contextWindow: 400_000,
      maxOutputTokens: 128_000,
      editFormat: "apply_patch",
      supportsParallelToolCalls: false,
      supportsReasoningReplay: true,
      supportsStreamingToolArgs: true,
      toolCallReliabilityTier: "high",
      supportsPromptCaching: true,
      supportsToolCalling: true,
      smallContext: false,
      routeConstraints: {
        protocol: "openai_responses",
        allowedRoutes: ["siwc"],
        requiresStoreFalse: true,
        requiresStreamTrue: true,
        omitPreviousResponseId: true,
        omitMaxOutputTokens: true,
        omitTemperature: true,
        functionToolsOnly: true,
        hostedToolsForbidden: true,
      },
    }),
    profile({
      id: "claude-sonnet",
      provider: "anthropic",
      family: "anthropic-claude",
      contextWindow: 200_000,
      maxOutputTokens: 64_000,
      editFormat: "str_replace",
      supportsParallelToolCalls: true,
      supportsReasoningReplay: true,
      supportsStreamingToolArgs: true,
      toolCallReliabilityTier: "high",
      supportsPromptCaching: true,
      supportsToolCalling: true,
      smallContext: false,
      routeConstraints: constraints("anthropic_messages", ["api_key"]),
    }),
    profile({
      id: "openrouter-chat",
      provider: "openrouter",
      family: "openai-compatible",
      contextWindow: 128_000,
      maxOutputTokens: 16_000,
      editFormat: "search_replace",
      supportsParallelToolCalls: true,
      supportsReasoningReplay: false,
      supportsStreamingToolArgs: true,
      toolCallReliabilityTier: "medium",
      supportsPromptCaching: false,
      supportsToolCalling: true,
      smallContext: false,
      routeConstraints: constraints("openai_compatible_chat", ["openrouter", "api_key"]),
    }),
    profile({
      id: "ollama-local-8k",
      provider: "ollama",
      family: "ollama",
      contextWindow: 8_192,
      maxOutputTokens: 2_048,
      editFormat: "search_replace",
      supportsParallelToolCalls: false,
      supportsReasoningReplay: false,
      supportsStreamingToolArgs: false,
      toolCallReliabilityTier: "low",
      supportsPromptCaching: false,
      supportsToolCalling: false,
      smallContext: true,
      routeConstraints: constraints("openai_compatible_chat", ["ollama"]),
    }),
    profile({
      id: "lm-studio-local",
      provider: "lm_studio",
      family: "lm-studio",
      contextWindow: 32_768,
      maxOutputTokens: 4_096,
      editFormat: "search_replace",
      supportsParallelToolCalls: false,
      supportsReasoningReplay: false,
      supportsStreamingToolArgs: true,
      toolCallReliabilityTier: "unmeasured",
      supportsPromptCaching: false,
      supportsToolCalling: true,
      smallContext: true,
      routeConstraints: constraints("openai_compatible_chat", ["lm_studio"]),
    }),
    profile({
      id: "gemini-flash",
      provider: "google",
      family: "gemini",
      contextWindow: 1_048_576,
      maxOutputTokens: 65_536,
      editFormat: "search_replace",
      supportsParallelToolCalls: false,
      supportsReasoningReplay: true,
      supportsStreamingToolArgs: false,
      toolCallReliabilityTier: "medium",
      supportsPromptCaching: true,
      supportsToolCalling: true,
      smallContext: false,
      routeConstraints: constraints("gemini_api", ["ai_studio", "vertex"]),
    }),
  ];
}

function profile(value: ModelProfile): ModelProfile {
  return value;
}

function constraints(
  protocol: ProtocolFamily,
  allowedRoutes: readonly ModelRoute[],
): RouteConstraints {
  return {
    protocol,
    allowedRoutes,
    requiresStoreFalse: false,
    requiresStreamTrue: true,
    omitPreviousResponseId: false,
    omitMaxOutputTokens: false,
    omitTemperature: false,
    functionToolsOnly: false,
    hostedToolsForbidden: false,
  };
}

function assertProfile(input: ModelProfile): void {
  if (input.id.trim().length === 0) throw new ModelProfileError("profile id is required");
  if (input.provider.trim().length === 0) throw new ModelProfileError("provider is required");
  if (input.family.trim().length === 0) throw new ModelProfileError("family is required");
  requireInteger(input.contextWindow, "contextWindow");
  requireInteger(input.maxOutputTokens, "maxOutputTokens");
  if (input.contextWindow <= 0) throw new ModelProfileError("contextWindow must be positive");
  if (!isEditFormat(input.editFormat)) throw new ModelProfileError("invalid editFormat");
  if (!isTier(input.toolCallReliabilityTier)) {
    throw new ModelProfileError("invalid toolCallReliabilityTier");
  }
  const routes = input.routeConstraints;
  if (routes.allowedRoutes.length === 0) {
    throw new ModelProfileError("allowedRoutes must not be empty");
  }
  if (routes.protocol === "openai_responses" && routes.allowedRoutes.includes("siwc")) {
    if (!routes.omitMaxOutputTokens || !routes.omitTemperature || !routes.omitPreviousResponseId) {
      throw new ModelProfileError("SIWC profiles must omit capped sampling parameters");
    }
    if (!routes.requiresStoreFalse || !routes.hostedToolsForbidden || !routes.functionToolsOnly) {
      throw new ModelProfileError("SIWC profiles must forbid hosted tools and stored responses");
    }
  }
}

function requireInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new ModelProfileError(`${label} must be a non-negative safe integer`);
  }
}

function isEditFormat(value: string): value is EditFormat {
  return value === "apply_patch" || value === "str_replace" || value === "search_replace";
}

function isTier(value: string): value is ToolCallReliabilityTier {
  return value === "high" || value === "medium" || value === "low" || value === "unmeasured";
}

export function assertRoute(
  protocol: ProtocolFamily,
  route: ModelRoute,
  allowed: readonly ModelRoute[],
): void {
  if (!allowed.includes(route)) {
    throw new ModelRequestError(`${protocol} does not accept route ${route}`);
  }
}
