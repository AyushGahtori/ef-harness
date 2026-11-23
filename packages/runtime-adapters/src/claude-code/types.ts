export const CLAUDE_RUNTIME_ID = "claude-code" as const;

export const EXECUTION_MODES = ["wrapped", "stripped"] as const;

export type ExecutionMode = (typeof EXECUTION_MODES)[number];

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

/** Normalized usage. Cache fields stay split for Claude receipts. */
export interface NormalizedUsage {
  readonly inputTokens: number;
  readonly cachedInputTokens: number;
  readonly cacheReadInputTokens: number;
  readonly cacheCreationInputTokens: number;
  readonly outputTokens: number;
  readonly reasoningTokens: number;
  readonly costMicroUsd?: number;
  readonly quotaUnits?: number;
}

export interface ClaudeTokenUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadInputTokens: number;
  readonly cacheCreationInputTokens: number;
}

export type CostCrossCheck = "match" | "mismatch" | "unpriced" | "estimate_only";

export interface NormalizedRuntimeEvent {
  readonly type: NormalizedEventType;
  readonly sessionId: string;
  readonly at: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

export type SupervisionRequest =
  | { readonly kind: "write" | "edit" | "delete"; readonly path: string }
  | { readonly kind: "read"; readonly path: string }
  | { readonly kind: "shell"; readonly command: string }
  | { readonly kind: "web"; readonly tool?: string; readonly url?: string }
  | { readonly kind: "mcp"; readonly tool: string };

export type PolicyDecision =
  | { readonly effect: "allow"; readonly elapsedMs: number }
  | { readonly effect: "deny"; readonly reason: string; readonly elapsedMs: number };

export type ClaudePermissionDecision =
  | { readonly behavior: "allow"; readonly updatedInput?: Record<string, unknown> }
  | { readonly behavior: "deny"; readonly message: string };

export interface PermissionOutcome {
  readonly decision: ClaudePermissionDecision;
  readonly elapsedMs: number;
  readonly request: SupervisionRequest;
}

export interface ClaudeSkillMount {
  readonly name: string;
  readonly body: string;
}

export interface ClaudeSessionSpec {
  readonly attemptId: string;
  readonly connectionId: string;
  readonly worktreeRoot: string;
  readonly writeScope: readonly string[];
  readonly mode?: ExecutionMode;
  readonly budgetMicroUsd: bigint;
  readonly modelId?: string;
  readonly resumeSessionId?: string;
  readonly skills?: readonly ClaudeSkillMount[];
  readonly credentialDelivery?: "env" | "proxy";
  readonly readOnlyRoots?: readonly string[];
}

export interface ClaudeProbeResult {
  readonly runtime: typeof CLAUDE_RUNTIME_ID;
  readonly installed: boolean;
  readonly version: string | null;
  readonly status: "ready" | "missing" | "version_too_old";
  readonly supportedModes: readonly ["wrapped", "stripped"];
  readonly minVersion: string | null;
  readonly reason: string;
}

export interface ClaudeAuthStatus {
  readonly runtime: typeof CLAUDE_RUNTIME_ID;
  readonly state: "console_key_present" | "missing_console_key" | "rejected_subscription_credential";
  readonly readsPersonalClaudeHome: false;
  readonly message: string;
}

export interface ClaudeSessionHandle {
  readonly sessionId: string;
  readonly attemptId: string;
  readonly claudeSessionId: string;
  readonly mode: ExecutionMode;
  readonly maxBudgetUsd: string;
  readonly configDir: string;
  readonly sandboxTier: string;
}

export interface ClaudeSessionDiagnostics {
  readonly sessionId: string;
  readonly attemptId: string;
  readonly argv: readonly string[];
  readonly configDir: string;
  readonly mode: ExecutionMode;
  readonly sandboxTier: string;
  readonly maxBudgetUsd: string;
  readonly childEnvHasConsoleKey: boolean;
  readonly claudeSessionId: string | null;
  readonly jobId: string;
  readonly mcpConfigPath: string;
  readonly systemPromptPath: string;
}

export interface ClaudeUsageReport extends NormalizedUsage {
  readonly providerCostMicroUsd: number | null;
  readonly estimatedCostMicroUsd: number | null;
  readonly crossCheck: CostCrossCheck;
  readonly partial: boolean;
}

export type ClaudeResumeResult =
  | { readonly supported: true; readonly sessionId: string; readonly claudeSessionId: string }
  | { readonly supported: false; readonly reason: "unsupported_resume" };

export interface CheckpointRef {
  readonly attemptId: string;
  readonly claudeSessionId?: string;
}

export interface SpendReceipt {
  readonly attemptId: string;
  readonly sessionId: string;
  readonly claudeSessionId: string;
  readonly modelId: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadInputTokens: number;
  readonly cacheCreationInputTokens: number;
  readonly providerCostMicroUsd: bigint | null;
  readonly estimatedCostMicroUsd: bigint | null;
  readonly crossCheck: CostCrossCheck;
  readonly reason: "result" | "error_max_budget_usd" | "interrupt" | "exit";
  readonly wipPreserved: true;
}

export interface AttemptCheckpoint {
  readonly attemptId: string;
  readonly sessionId: string;
  readonly claudeSessionId: string;
  readonly kind: "running" | "error_max_budget_usd" | "interrupt" | "exit";
  readonly wipPreserved: true;
  readonly handoff: readonly string[];
}

export const BUDGET_STOP_HANDOFF = ["Task-059", "Task-128"] as const;
