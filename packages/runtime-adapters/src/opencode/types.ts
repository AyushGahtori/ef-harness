export const OPENCODE_ADAPTER_ID = "opencode" as const;

export const OPENCODE_COMPACTION_THRESHOLD = 0.75;

export const DEFAULT_OPENCODE_MIN_VERSION = "1.0.0";

export const LABELED_WIP_HEADER = "[PRIOR UNVERIFIED WIP DIFF — REVIEW & FINISH]";

export const MAX_MOUNTED_SKILLS = 2;

export const ACP_FRAME_LIMIT_BYTES = 8 * 1024 * 1024;

export type ExecutionMode = "wrapped" | "stripped";

export type ProviderId = "openai" | "anthropic" | "openrouter" | "gemini" | "ollama";

export type TrustLevel = "conformance_verified" | "disabled";

export type PermissionEffect = "allow" | "deny" | "ask";

export interface ProviderConnection {
  readonly connectionId: string;
  readonly provider: ProviderId;
  readonly model: string;
  readonly baseUrl: string;
  readonly apiKey?: string;
  readonly paid: boolean;
}

export interface LeasedMcpAttachment {
  readonly url: string;
  readonly bearerToken: string;
}

export interface SkillSpec {
  readonly id: string;
  readonly vettingStatus: "vetted" | "rejected" | "unvetted";
  readonly sha256: string;
  readonly content: string;
}

export interface StartSessionSpec {
  readonly attemptId: string;
  readonly taskId: string;
  readonly worktreePath: string;
  readonly configDir: string;
  readonly brief: string;
  readonly writeScope: readonly string[];
  readonly mustChecklist: readonly string[];
  readonly pinnedBaseCommitSha: string;
  readonly contextCeilingTokens: number;
  readonly connection: ProviderConnection;
  readonly mcp: LeasedMcpAttachment;
  readonly mode?: ExecutionMode;
  readonly skills?: readonly SkillSpec[];
  readonly userConfig?: unknown;
  readonly repoConfig?: unknown;
  readonly preservePaths?: readonly string[];
}

export interface UsageTotals {
  readonly input: number;
  readonly output: number;
  readonly cacheRead: number;
  readonly cacheWrite: number;
  readonly reasoning: number;
}

export interface NormalizedUsageReceipt {
  readonly attemptId: string;
  readonly adapterId: typeof OPENCODE_ADAPTER_ID;
  readonly connectionId: string;
  readonly provider: ProviderId;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
  readonly reasoningTokens: number;
  readonly costMicroUsd: number;
  readonly currency: "micro-usd" | "usd-zero";
}

export type NormalizedRuntimeEvent =
  | { readonly type: "turn_started"; readonly sessionId: string }
  | { readonly type: "assistant_delta"; readonly sessionId: string; readonly text: string }
  | {
      readonly type: "tool_call_requested";
      readonly sessionId: string;
      readonly requestId: string;
      readonly tool: string;
    }
  | { readonly type: "tool_call_started"; readonly sessionId: string; readonly requestId: string; readonly tool: string }
  | { readonly type: "tool_call_finished"; readonly sessionId: string; readonly requestId: string; readonly tool: string }
  | { readonly type: "file_edited"; readonly sessionId: string; readonly paths: readonly string[] }
  | {
      readonly type: "permission_requested";
      readonly sessionId: string;
      readonly requestId: string;
      readonly tool: string;
    }
  | {
      readonly type: "permission_decided";
      readonly sessionId: string;
      readonly requestId: string;
      readonly decision: "allow" | "deny";
      readonly reason: string;
    }
  | { readonly type: "usage_reported"; readonly sessionId: string; readonly usage: NormalizedUsageReceipt }
  | { readonly type: "rate_limited"; readonly sessionId: string; readonly status: string }
  | { readonly type: "turn_completed"; readonly sessionId: string; readonly stopReason: string }
  | { readonly type: "session_error"; readonly sessionId: string; readonly message: string }
  | { readonly type: "session_exited"; readonly sessionId: string; readonly exitCode: number | null };

export interface StoredDecision {
  readonly requestId: string;
  readonly tool: string;
  readonly decision: "allow" | "deny";
  readonly acpOutcome: "allow_once" | "reject_once";
  readonly reason: string;
  readonly elapsedMs: number;
}

export interface VersionProbe {
  readonly installed: boolean;
  readonly version: string | null;
  readonly supportsAcp: boolean;
  readonly trust: TrustLevel;
  readonly message: string;
}

export interface CliVersionPolicy {
  readonly minVersion: string;
  readonly denylist: readonly string[];
}

export interface CommandResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

export interface CommandRunner {
  run(binaryPath: string, args: readonly string[]): CommandResult;
}

export interface AuthStatus {
  readonly runtime: typeof OPENCODE_ADAPTER_ID;
  readonly signedIn: boolean;
  readonly provider: ProviderId | null;
  readonly scrapedHomeDirectory: false;
  readonly destructive: false;
}

export interface ResumeResult {
  readonly supported: boolean;
  readonly sessionId: string | null;
  readonly fallback: "none" | "fresh_session_labeled_wip";
  readonly reason: string;
  readonly labeledWip: string;
}

export interface SteerResult {
  readonly accepted: boolean;
  readonly queued: boolean;
  readonly reason: string;
  readonly fallback: "none" | "fresh_session_labeled_wip";
  readonly labeledWip: string;
}
