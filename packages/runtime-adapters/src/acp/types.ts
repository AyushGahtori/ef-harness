export const ACP_PROTOCOL_VERSION = 1 as const;

export const EXECUTION_MODES = ["wrapped", "stripped"] as const;

export type ExecutionMode = (typeof EXECUTION_MODES)[number];

export const ACP_RUNTIME_IDS = [
  "generic",
  "codex-acp",
  "copilot-acp",
  "cursor-acp",
  "gemini-acp",
  "opencode-acp",
] as const;

export type AcpRuntimeId = (typeof ACP_RUNTIME_IDS)[number];

/**
 * Task 142 event names, plus the ACP extensions this adapter has to emit:
 * session lifecycle, plan checklist, and Pool 2 queueing.
 */
export const NORMALIZED_EVENT_TYPES = [
  "session_started",
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
  "plan_updated",
  "waiting_run_slot",
  "turn_completed",
  "session_error",
  "session_exited",
] as const;

export type NormalizedEventType = (typeof NORMALIZED_EVENT_TYPES)[number];

export interface NormalizedUsage {
  readonly inputTokens: number;
  readonly cachedInputTokens: number;
  readonly outputTokens: number;
  readonly reasoningTokens: number;
  readonly costMicroUsd?: number;
  readonly quotaUnits?: number;
}

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
  | { readonly effect: "deny"; readonly reason: string; readonly elapsedMs: number }
  | {
      readonly effect: "redirect";
      readonly via: "harness.run";
      readonly reason: string;
      readonly elapsedMs: number;
    };

export interface PromptBlock {
  readonly type: "text";
  readonly text: string;
}

export interface SkillFileInput {
  readonly relativePath: string;
  readonly text: string;
}

export interface SkillMountInput {
  readonly skillId: string;
  readonly vetted: boolean;
  readonly files: readonly SkillFileInput[];
}

export interface AcpSessionSpec {
  readonly attemptId: string;
  readonly taskId: string;
  readonly worktreeRoot: string;
  readonly writeScope: readonly string[];
  readonly sessionId?: string;
  readonly cwd?: string;
  readonly brief?: string;
  readonly mode?: ExecutionMode;
  readonly skills?: readonly SkillMountInput[];
  readonly mcpTools?: readonly string[];
  readonly env?: Readonly<Record<string, string>>;
  readonly secrets?: readonly RegisteredSecret[];
  readonly homeDir?: string;
  readonly appData?: string;
}

export interface RegisteredSecret {
  readonly label: string;
  readonly value: string;
}

export interface SessionRef {
  readonly sessionId: string;
  readonly agentSessionId: string;
  readonly cwd: string;
}

export interface TurnResult {
  readonly stopReason: string;
  readonly cancelled: boolean;
}

export interface ResumeResult {
  readonly supported: boolean;
  readonly reason?: "unsupported_resume" | "resumed";
  readonly sessionId?: string;
}

export interface ProbeResult {
  readonly installed: boolean;
  readonly version: string;
  readonly status: "ok" | "missing";
  readonly modes: readonly ["wrapped", "stripped"];
  readonly runtime: AcpRuntimeId;
  readonly capabilities: {
    readonly initialize: true;
    readonly sessionNew: true;
    readonly sessionPrompt: true;
    readonly sessionUpdate: true;
    readonly requestPermission: true;
    readonly hostFs: true;
    readonly hostTerminal: true;
    readonly mcp: true;
  };
}

export interface AuthStatus {
  readonly status: "not_required";
  readonly signedIn: true;
  readonly scrapedHome: false;
}

export interface PermissionDecisionInput {
  readonly effect: "allow" | "deny";
  readonly reason?: string;
}

export interface AcpClientCapabilities {
  readonly fs: { readonly readTextFile: true; readonly writeTextFile: true };
  readonly terminal: true;
  readonly mcp: true;
}

export interface AcpInitializeParams {
  readonly protocolVersion: number;
  readonly clientCapabilities: AcpClientCapabilities;
  readonly clientInfo: { readonly name: string; readonly version: string };
}

export interface AcpMcpHeader {
  readonly name: string;
  readonly value: string;
}

export interface AcpMcpServerRegistration {
  readonly name: string;
  readonly type: "http" | "sse";
  readonly url: string;
  readonly headers: readonly AcpMcpHeader[];
  readonly tools: readonly string[];
}

export type AcpPermissionKind = "allow_once" | "reject_once";

export interface AcpPermissionOutcome {
  readonly outcome: "selected" | "cancelled";
  readonly optionId?: string;
  readonly kind: AcpPermissionKind;
}

export interface JsonRpcRequest {
  readonly jsonrpc?: string;
  readonly id: number | string;
  readonly method: string;
  readonly params?: unknown;
}

export interface JsonRpcNotification {
  readonly jsonrpc?: string;
  readonly method: string;
  readonly params?: unknown;
}

export interface JsonRpcSuccess {
  readonly id: number | string;
  readonly result: unknown;
}

export interface JsonRpcFailure {
  readonly id: number | string | null;
  readonly error: { readonly code: number; readonly message: string; readonly data?: unknown };
}

export type JsonRpcMessage = JsonRpcRequest | JsonRpcNotification | JsonRpcSuccess | JsonRpcFailure;

export function emptyUsage(): NormalizedUsage {
  return {
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
  };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
