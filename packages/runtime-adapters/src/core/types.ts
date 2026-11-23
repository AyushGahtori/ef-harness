export const FOREIGN_RUNTIME_IDS = [
  "acp",
  "codex",
  "copilot",
  "cursor",
  "claude-code",
  "gemini-cli",
  "opencode",
] as const;

export type ForeignRuntimeId = (typeof FOREIGN_RUNTIME_IDS)[number];

export const EXECUTION_MODES = ["wrapped", "stripped"] as const;

export type ExecutionMode = (typeof EXECUTION_MODES)[number];

export const ADAPTER_TRUST_STATES = ["conformance_verified", "observe_only", "disabled"] as const;

export type AdapterTrustState = (typeof ADAPTER_TRUST_STATES)[number];

export const SANDBOX_TIERS = ["A", "B", "C", "D"] as const;

export type SandboxTierId = (typeof SANDBOX_TIERS)[number];

export const NORMALIZED_EVENT_TYPES = [
  "turn_started",
  "assistant_delta",
  "tool_call_requested",
  "tool_call_started",
  "tool_call_finished",
  "file_edited",
  "permission_requested",
  "permission_decided",
  "usage_reported",
  "rate_limited",
  "turn_completed",
  "session_error",
  "session_exited",
] as const;

export type NormalizedEventType = (typeof NORMALIZED_EVENT_TYPES)[number];

export const WORKER_TOOL_KINDS = ["read", "search", "edit", "shell", "web", "mcp"] as const;

export type WorkerToolKind = (typeof WORKER_TOOL_KINDS)[number];

export const WORKER_ERROR_KINDS = [
  "auth",
  "rate_limit",
  "usage_limit",
  "billing",
  "overloaded",
  "context_overflow",
  "other",
] as const;

export type WorkerErrorKind = (typeof WORKER_ERROR_KINDS)[number];

/** Exact usage object every foreign runtime must normalize into. */
export interface NormalizedUsage {
  readonly inputTokens: number;
  readonly cachedInputTokens: number;
  readonly outputTokens: number;
  readonly reasoningTokens: number;
  readonly costMicroUsd?: number;
  readonly quotaUnits?: number;
  /** Claude cache read tokens, kept so Task 147 can split the summed cache field. */
  readonly cacheReadInputTokens?: number;
  /** Claude cache creation tokens, kept so Task 147 can split the summed cache field. */
  readonly cacheCreationInputTokens?: number;
}

export type SupervisionRequest =
  | { readonly kind: "write" | "edit" | "delete"; readonly path: string }
  | { readonly kind: "read"; readonly path: string }
  | { readonly kind: "shell"; readonly command: string }
  | { readonly kind: "web"; readonly tool?: string; readonly url?: string }
  | { readonly kind: "mcp"; readonly tool: string };

export interface PermissionReply {
  readonly effect: "allow" | "deny";
  readonly reason?: string;
}

export type PolicyDecision =
  | { readonly effect: "allow"; readonly elapsedMs: number }
  | { readonly effect: "deny"; readonly reason: string; readonly elapsedMs: number }
  | {
      readonly effect: "redirect";
      readonly via: "harness.run";
      readonly reason: string;
      readonly elapsedMs: number;
    };

export function isForeignRuntimeId(value: string): value is ForeignRuntimeId {
  return (FOREIGN_RUNTIME_IDS as readonly string[]).includes(value);
}

export function isNormalizedEventType(value: string): value is NormalizedEventType {
  return (NORMALIZED_EVENT_TYPES as readonly string[]).includes(value);
}

export function isWorkerToolKind(value: string): value is WorkerToolKind {
  return (WORKER_TOOL_KINDS as readonly string[]).includes(value);
}

export function isWorkerErrorKind(value: string): value is WorkerErrorKind {
  return (WORKER_ERROR_KINDS as readonly string[]).includes(value);
}

export function isExecutionMode(value: string): value is ExecutionMode {
  return (EXECUTION_MODES as readonly string[]).includes(value);
}

export function isAdapterTrustState(value: string): value is AdapterTrustState {
  return (ADAPTER_TRUST_STATES as readonly string[]).includes(value);
}
