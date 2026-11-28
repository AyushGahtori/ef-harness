export const CODEX_TRANSPORTS = ["app-server", "codex-acp"] as const;

export type CodexTransport = (typeof CODEX_TRANSPORTS)[number];

export const CODEX_CURRENCIES = ["ppm", "micro-USD"] as const;

export type CodexCurrency = (typeof CODEX_CURRENCIES)[number];

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

/** Local stand-in for Task 142 `NormalizedUsage`. */
export interface NormalizedUsage {
  readonly inputTokens: number;
  readonly cachedInputTokens: number;
  readonly outputTokens: number;
  readonly reasoningTokens: number;
  readonly costMicroUsd?: number;
  readonly quotaUnits?: number;
}

export interface CodexUsageReport extends NormalizedUsage {
  readonly currency: CodexCurrency;
  readonly quotaPpm?: number;
}

export type SupervisionRequest =
  | { readonly kind: "edit"; readonly path: string }
  | { readonly kind: "shell"; readonly command: string };

export interface SupervisionDecision {
  readonly effect: "allow" | "deny";
  readonly reason: string;
  readonly elapsedMs: number;
}

export type CodexConnection =
  | {
      readonly kind: "sign_in_with_chatgpt";
      readonly connectionId: string;
      readonly accessToken: string;
      readonly expiresAtMs: number;
    }
  | {
      readonly kind: "openai_api_key";
      readonly connectionId: string;
      readonly apiKey: string;
    };

export interface CodexSkillMount {
  readonly name: string;
  readonly markdown: string;
}

export interface CodexSessionSpec {
  readonly attemptId: string;
  readonly worktreeRoot: string;
  readonly writeScope: readonly string[];
  readonly brief: string;
  readonly modelId: string;
  readonly connection: CodexConnection;
  readonly mcpEndpoint: string;
  readonly skills?: readonly CodexSkillMount[];
  readonly loopbackProxy?: string;
  readonly transport?: "auto" | CodexTransport;
}

export interface CodexSessionHandle {
  readonly sessionId: string;
  readonly threadId: string;
  readonly transport: CodexTransport;
  readonly codexHome: string;
  readonly currency: CodexCurrency;
}

export interface TurnReceipt {
  readonly turnId: string;
  readonly threadId: string;
  readonly stopReason: "completed" | "interrupted" | "failed";
  readonly refreshed: boolean;
  readonly resumedThreadId: string | null;
  readonly exitCode: number | null;
}

export interface CodexProbe {
  readonly runtime: "codex";
  readonly status: "ready" | "version_too_old" | "missing";
  readonly installedVersion: string | null;
  readonly requiredVersion: string;
  readonly modes: readonly ["wrapped"];
  readonly transports: readonly ["app-server", "codex-acp"];
}

export interface CodexAuthStatus {
  readonly signedIn: boolean;
  readonly kind: CodexConnection["kind"] | "unsigned";
  readonly currency: CodexCurrency | null;
  readonly expiresAtMs: number | null;
  readonly refreshWithin180s: boolean;
  readonly readsPersonalCodexHome: false;
}

export interface NormalizedRuntimeEvent {
  readonly type: NormalizedEventType;
  readonly sessionId: string;
  readonly atMs: number;
  readonly text?: string;
  readonly path?: string;
  readonly command?: string;
  readonly requestId?: string;
  readonly decision?: "allow" | "deny";
  readonly reason?: string;
  readonly elapsedMs?: number;
  readonly usage?: NormalizedUsage;
  readonly currency?: CodexCurrency;
  readonly usedPercent?: number;
  readonly usedPpm?: number;
  readonly resetsAt?: string;
  readonly windDown?: boolean;
  readonly stopReason?: string;
  readonly exitCode?: number;
  readonly abnormal?: boolean;
  readonly threadId?: string;
}

export interface CodexWindowLimit {
  readonly usedPercent: number;
  readonly usedPpm: number;
  readonly resetAt: string;
  readonly window: "5h" | "7d";
}

export interface CodexRateLimitSnapshot {
  readonly primary: CodexWindowLimit;
  readonly secondary: CodexWindowLimit;
}

export interface AttemptCheckpointRow {
  readonly attempt: string;
  readonly step: number;
  readonly wip_ref: string | null;
  readonly session_ref: string | null;
  readonly contract_versions: string;
  readonly pending_effects: string;
  readonly handoff_artifact: string | null;
  readonly updated_at: number;
}

export const LABELED_WIP_HEADER = "[PRIOR UNVERIFIED WIP DIFF — REVIEW & FINISH]";

export const TOKEN_REFRESH_LEAD_MS = 180_000;

export const WIND_DOWN_PPM = 900_000;

export const PPM_PER_PERCENT = 10_000;

export function currencyOf(connection: CodexConnection): CodexCurrency {
  return connection.kind === "sign_in_with_chatgpt" ? "ppm" : "micro-USD";
}

export function emptyUsage(): NormalizedUsage {
  return {
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
  };
}

export function percentToPpm(percent: number): number {
  if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
    throw new Error(`Codex used-percent ${String(percent)} is outside 0..100`);
  }
  return Math.round(percent * PPM_PER_PERCENT);
}
