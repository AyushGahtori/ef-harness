import type { NormalizedModelError } from "./model-error.js";
import type { LocalTracerPort, SecretRedactorPort } from "./telemetry-port.js";
import type { TokenUsage } from "./usage.js";

export const EDIT_FORMATS = ["apply_patch", "str_replace", "search_replace"] as const;
export type EditFormat = (typeof EDIT_FORMATS)[number];

export const TOOL_CALL_RELIABILITY_TIERS = ["high", "medium", "low", "unmeasured"] as const;
export type ToolCallReliabilityTier = (typeof TOOL_CALL_RELIABILITY_TIERS)[number];

export const PROTOCOL_FAMILIES = [
  "openai_responses",
  "anthropic_messages",
  "openai_compatible_chat",
  "gemini_api",
] as const;
export type ProtocolFamily = (typeof PROTOCOL_FAMILIES)[number];

export const MODEL_ROUTES = [
  "api_key",
  "siwc",
  "openrouter",
  "ollama",
  "lm_studio",
  "ai_studio",
  "vertex",
] as const;
export type ModelRoute = (typeof MODEL_ROUTES)[number];

export const STOP_REASONS = [
  "end_turn",
  "tool_use",
  "max_tokens",
  "output_budget_cutoff",
  "stop",
] as const;
export type StopReason = (typeof STOP_REASONS)[number];

export const TOOL_KINDS = ["function", "custom", "hosted"] as const;
export type ToolKind = (typeof TOOL_KINDS)[number];

export interface RouteConstraints {
  readonly protocol: ProtocolFamily;
  readonly allowedRoutes: readonly ModelRoute[];
  readonly requiresStoreFalse: boolean;
  readonly requiresStreamTrue: boolean;
  readonly omitPreviousResponseId: boolean;
  readonly omitMaxOutputTokens: boolean;
  readonly omitTemperature: boolean;
  readonly functionToolsOnly: boolean;
  readonly hostedToolsForbidden: boolean;
}

export interface ModelProfile {
  readonly id: string;
  readonly provider: string;
  readonly family: string;
  readonly contextWindow: number;
  readonly maxOutputTokens: number;
  readonly editFormat: EditFormat;
  readonly supportsParallelToolCalls: boolean;
  readonly supportsReasoningReplay: boolean;
  readonly supportsStreamingToolArgs: boolean;
  readonly toolCallReliabilityTier: ToolCallReliabilityTier;
  readonly supportsPromptCaching: boolean;
  readonly supportsToolCalling: boolean;
  readonly smallContext: boolean;
  readonly routeConstraints: RouteConstraints;
}

export interface OpaqueReplayItem {
  readonly canonicalJson: string;
}

export interface ThinkingBlock {
  readonly thinking: string;
  readonly signature: string;
}

export interface MalformedToolArgsItem {
  readonly type: "malformed_tool_args";
  readonly callId: string;
  readonly name: string;
  readonly rawArguments: string;
  readonly parseError: string;
}

export interface ToolCallItem {
  readonly callId: string;
  readonly name: string;
  readonly arguments: Readonly<Record<string, unknown>>;
  readonly rawArguments: string;
}

export type StreamEvent =
  | { readonly type: "text_delta"; readonly text: string }
  | { readonly type: "reasoning_item"; readonly item: OpaqueReplayItem }
  | { readonly type: "thinking_block"; readonly thinking: string; readonly signature: string }
  | {
      readonly type: "thought_signature";
      readonly signature: string;
      readonly canonicalJson: string;
    }
  | {
      readonly type: "tool_call_delta";
      readonly callId: string;
      readonly name: string;
      readonly argumentsDelta: string;
    }
  | { readonly type: "tool_call"; readonly call: ToolCallItem }
  | { readonly type: "malformed_tool_args"; readonly item: MalformedToolArgsItem }
  | { readonly type: "structured_output"; readonly jsonText: string; readonly parsed: unknown }
  | { readonly type: "usage"; readonly usage: TokenUsage }
  | { readonly type: "stop"; readonly stopReason: StopReason }
  | {
      readonly type: "provider_meta";
      readonly providerName: string | null;
      readonly costMicroUsd: number | null;
    }
  | { readonly type: "error"; readonly error: NormalizedModelError };

export interface ToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly parameters: Readonly<Record<string, unknown>>;
  readonly kind: ToolKind;
  readonly hostedType?: string;
}

export interface AssistantToolCall {
  readonly callId: string;
  readonly name: string;
  readonly rawArguments: string;
}

export interface ConversationMessage {
  readonly role: "system" | "user" | "assistant" | "tool";
  readonly text: string;
  readonly toolCallId?: string;
  readonly name?: string;
  readonly toolCalls?: readonly AssistantToolCall[];
  readonly thinkingBlocks?: readonly ThinkingBlock[];
  readonly thoughtParts?: readonly OpaqueReplayItem[];
}

export interface StablePrefix {
  readonly zone1: string;
  readonly zone2: string;
}

export interface ModelTurnRequest {
  readonly model: string;
  readonly profile: ModelProfile;
  readonly route: ModelRoute;
  readonly prefix: StablePrefix;
  readonly messages: readonly ConversationMessage[];
  readonly tools: readonly ToolDefinition[];
  readonly replayItems: readonly OpaqueReplayItem[];
  readonly reservedOutputTokens: number;
  readonly clientRequestId: string;
  readonly idempotencyKey: string;
  readonly maxOutputTokens?: number;
  readonly temperature?: number;
  readonly previousResponseId?: string;
  readonly store?: boolean;
  readonly responseSchema?: Readonly<Record<string, unknown>>;
  readonly includeEncryptedReasoning?: boolean;
}

export interface AdapterCallOptions {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly fetchImpl?: typeof fetch;
  readonly redactor?: SecretRedactorPort;
  readonly tracer?: LocalTracerPort;
  readonly idleTimeoutMs?: number;
  readonly scheduleTimeout?: (callback: () => void, ms: number) => number;
  readonly clearScheduledTimeout?: (handle: number) => void;
  readonly signal?: AbortSignal;
  readonly countOutputTokens?: (text: string) => number;
  readonly traceParentSpanId?: string;
  readonly nowMs?: () => number;
}

export interface EncryptedReasoningProbeResult {
  readonly supported: boolean;
  readonly items: readonly OpaqueReplayItem[];
}

export interface ModelProtocolAdapter {
  readonly protocol: ProtocolFamily;
  readonly adapterName: string;
  stream(request: ModelTurnRequest, options: AdapterCallOptions): AsyncIterable<StreamEvent>;
  probeEncryptedReasoning?(
    request: ModelTurnRequest,
    options: AdapterCallOptions,
  ): Promise<EncryptedReasoningProbeResult>;
}

export function opaqueReplayItem(value: unknown): OpaqueReplayItem {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("opaque replay item must be a JSON object");
  }
  return { canonicalJson: JSON.stringify(value) };
}

export function readOpaqueReplayItem(item: OpaqueReplayItem): Record<string, unknown> {
  const parsed = JSON.parse(item.canonicalJson) as unknown;
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("opaque replay item must be a JSON object");
  }
  return parsed as Record<string, unknown>;
}

export function reasoningItemHasEncryptedContent(item: OpaqueReplayItem): boolean {
  const value = readOpaqueReplayItem(item);
  return typeof value.encrypted_content === "string" && value.encrypted_content.length > 0;
}

export function exemptReplayItems(items: readonly OpaqueReplayItem[]): {
  readonly values: Record<string, unknown>[];
  readonly opaque: Set<unknown>;
} {
  const values = items.map((item) => readOpaqueReplayItem(item));
  return { values, opaque: new Set<unknown>(values) };
}

export function parseToolArguments(
  raw: string,
): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  try {
    const value = JSON.parse(raw) as unknown;
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return { ok: false, error: "tool arguments must be a JSON object" };
    }
    return { ok: true, value: value as Record<string, unknown> };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "invalid JSON" };
  }
}

export function malformedToolArgs(
  callId: string,
  name: string,
  rawArguments: string,
  parseError: string,
): MalformedToolArgsItem {
  return { type: "malformed_tool_args", callId, name, rawArguments, parseError };
}

export class ModelRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModelRequestError";
  }
}

export function assertModelTurnRequest(request: ModelTurnRequest): void {
  if (request.model.trim().length === 0) throw new ModelRequestError("model is required");
  if (request.clientRequestId.trim().length === 0) {
    throw new ModelRequestError("clientRequestId is required");
  }
  if (request.idempotencyKey.trim().length === 0) {
    throw new ModelRequestError("idempotencyKey is required");
  }
  if (!Number.isSafeInteger(request.reservedOutputTokens) || request.reservedOutputTokens < 0) {
    throw new ModelRequestError("reservedOutputTokens must be a non-negative safe integer");
  }
  if (
    request.maxOutputTokens !== undefined &&
    (!Number.isSafeInteger(request.maxOutputTokens) || request.maxOutputTokens < 0)
  ) {
    throw new ModelRequestError("maxOutputTokens must be a non-negative safe integer");
  }
  if (!request.profile.routeConstraints.allowedRoutes.includes(request.route)) {
    throw new ModelRequestError(
      `route ${request.route} is not allowed for profile ${request.profile.id}`,
    );
  }
}

export function localOutputBudget(request: ModelTurnRequest): number | null {
  const cappedByRoute =
    request.route === "siwc" || request.profile.routeConstraints.omitMaxOutputTokens;
  return cappedByRoute ? request.reservedOutputTokens : null;
}
