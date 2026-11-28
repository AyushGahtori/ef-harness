import type { CURSOR_KEY_EXPIRED_ACCOUNT_CARD, CURSOR_LOGIN_ACTION } from "./constants.js";

export type ExecutionMode = "wrapped" | "stripped";

export type CursorTransportKind = "sdk" | "acp";

export type AdapterTrust = "conformance_verified" | "observe_only" | "disabled";

export type SandboxTierId = "A" | "B" | "C" | "D";

export type FileToolKind = "read" | "write" | "edit" | "delete" | "search" | "mcp" | "web";

export type HookEffect = "allow" | "deny" | "redirect";

export type CursorAuthState = "active" | "expired" | "unauthorized" | "signed_out";

export type SessionPurpose = "live_build" | "conformance";

export interface NormalizedUsage {
  readonly inputTokens: number;
  readonly cachedInputTokens: number;
  readonly outputTokens: number;
  readonly reasoningTokens: number;
  readonly costMicroUsd: number;
  readonly quotaUnits: number;
  readonly partialInterrupted: boolean;
  readonly source: "run.usage";
}

export interface CursorQuotaSnapshot {
  readonly plan: string;
  readonly includedUsedPercent: number;
  readonly fastUsedPercent: number;
  readonly remainingPercent: number;
  readonly onDemandEnabled: boolean;
  readonly chargedCents: number;
  readonly source: "Agent.getUsage";
}

export type NormalizedRuntimeEvent =
  | { readonly type: "turn_started"; readonly sessionId: string; readonly turn: number }
  | { readonly type: "assistant_delta"; readonly sessionId: string; readonly text: string }
  | {
      readonly type: "tool_call_requested";
      readonly sessionId: string;
      readonly requestId: string;
      readonly kind: FileToolKind | "shell";
    }
  | { readonly type: "tool_call_started"; readonly sessionId: string; readonly requestId: string }
  | {
      readonly type: "tool_call_finished";
      readonly sessionId: string;
      readonly requestId: string;
      readonly exitCode: number;
    }
  | { readonly type: "file_edited"; readonly sessionId: string; readonly paths: readonly string[] }
  | {
      readonly type: "permission_requested";
      readonly sessionId: string;
      readonly requestId: string;
      readonly kind: FileToolKind | "shell";
    }
  | {
      readonly type: "permission_decided";
      readonly sessionId: string;
      readonly requestId: string;
      readonly effect: HookEffect;
      readonly reason: string;
      readonly elapsedMs: number;
    }
  | { readonly type: "usage_reported"; readonly sessionId: string; readonly usage: NormalizedUsage }
  | {
      readonly type: "rate_limited";
      readonly sessionId: string;
      readonly usedPercent: number;
      readonly onDemandEnabled: boolean;
    }
  | {
      readonly type: "turn_completed";
      readonly sessionId: string;
      readonly turn: number;
      readonly stopReason: string;
    }
  | {
      readonly type: "session_error";
      readonly sessionId: string;
      readonly kind: "auth" | "billing" | "other";
      readonly message: string;
    }
  | { readonly type: "session_exited"; readonly sessionId: string; readonly reason: string };

export interface PreToolUseInput {
  readonly requestId?: string;
  readonly toolName: string;
  readonly kind: FileToolKind;
  readonly path?: string;
  readonly url?: string;
  readonly mcpTool?: string;
}

export interface BeforeShellInput {
  readonly requestId?: string;
  readonly command: string;
}

export interface HookDecision {
  readonly permission: "allow" | "deny";
  readonly effect: HookEffect;
  readonly reason: string;
  readonly elapsedMs: number;
  readonly via?: "harness.run";
}

export interface HookScope {
  readonly worktree: string;
  readonly writeScope: readonly string[];
  readonly mode: ExecutionMode;
  readonly leasedTools: readonly string[];
  readonly homeDir: string;
  readonly realpath?: (target: string) => string;
}

export interface CursorMcpServer {
  readonly name: string;
  readonly url: string;
  readonly tools: readonly string[];
  readonly bearerRef: string;
}

export interface CursorLocalSandboxOptions {
  readonly enabled: true;
  readonly workingDirectory: string;
  readonly writableRoots: readonly string[];
  readonly network: {
    readonly unrestricted: false;
    readonly route: "loopback-allowlist-proxy";
    readonly proxyUrl: string;
    readonly blockNonProviderEgress: true;
  };
  readonly mcpServers: readonly CursorMcpServer[];
}

export interface CursorVendorEvent {
  readonly type: "assistant" | "tool" | "shell" | "file_edited";
  readonly text?: string;
  readonly requestId?: string;
  readonly kind?: FileToolKind;
  readonly toolName?: string;
  readonly path?: string;
  readonly url?: string;
  readonly mcpTool?: string;
  readonly command?: string;
  readonly paths?: readonly string[];
}

export interface CursorRunResult {
  readonly httpStatus: number;
  readonly events: readonly CursorVendorEvent[];
  readonly usage: unknown;
  readonly agentUsage: unknown;
}

export interface VettedSkill {
  readonly name: string;
  readonly markdown: string;
}

export interface CursorSessionSpec {
  readonly attemptId: string;
  readonly connectionId: string;
  readonly worktree: string;
  readonly brief: string;
  readonly briefVersion: string;
  readonly writeScope: readonly string[];
  readonly mode?: ExecutionMode;
  readonly transport?: CursorTransportKind;
  readonly modelId?: string;
  readonly skills?: readonly VettedSkill[];
  readonly purpose?: SessionPurpose;
  readonly wipDiff?: string;
}

export interface CursorProbeResult {
  readonly runtime: "cursor";
  readonly installed: boolean;
  readonly version: string;
  readonly versionStatus: "ok" | "version_too_old" | "missing";
  readonly requiredVersion: string | null;
  readonly modes: readonly ExecutionMode[];
  readonly transport: CursorTransportKind;
  readonly trust: AdapterTrust;
  readonly liveBuildsEnabled: boolean;
  readonly conformanceChecks: readonly ["preToolUse", "beforeShellExecution", "local.sandboxOptions"];
}

export interface CursorAuthStatus {
  readonly signedIn: boolean;
  readonly status: CursorAuthState;
  readonly connectionId: string;
  readonly expiresAt: number | null;
  readonly readsPersonalCursorHome: false;
}

export interface CursorSessionRef {
  readonly sessionId: string;
  readonly attemptId: string;
  readonly agentId: string;
  readonly transport: CursorTransportKind;
  readonly mode: ExecutionMode;
}

export interface CursorTurnReceipt {
  readonly sessionId: string;
  readonly turn: number;
  readonly dispatched: boolean;
  readonly stopReason: string;
  readonly usage: NormalizedUsage;
  readonly silentPaidFallback: false;
}

export interface CursorSteerReceipt {
  readonly sessionId: string;
  readonly accepted: true;
  readonly mode: "additive";
  readonly note: string;
}

export interface CursorInterruptReceipt {
  readonly sessionId: string;
  readonly elapsedMs: number;
  readonly lingeringPids: readonly number[];
  readonly killedPids: readonly number[];
  readonly sdkAbortInvoked: true;
}

export interface CursorCheckpointRef {
  readonly contradictory?: boolean;
  readonly briefVersion?: string;
}

export interface CursorResumeResult {
  readonly supported: boolean;
  readonly fallback: "native" | "fresh_session";
  readonly reason: string;
  readonly sessionId: string;
  readonly agentId: string | null;
  readonly labeledWip: string;
  readonly rebuiltBrief: string | null;
}

export interface PermissionDecision {
  readonly effect: "allow" | "deny";
  readonly reason?: string;
}

export interface PermissionApplyResult {
  readonly requestId: string;
  readonly effect: HookEffect;
  readonly reason: string;
  readonly elapsedMs: number;
}

export interface CursorCheckpointRecord {
  readonly sessionId: string;
  readonly attemptId: string;
  readonly connectionId: string;
  readonly agentId: string;
  readonly conversationHandle: string;
  readonly brief: string;
  readonly briefVersion: string;
  readonly wipDiff: string;
  readonly mode: ExecutionMode;
  readonly transport: CursorTransportKind;
  readonly steeringNotes: readonly string[];
}

export interface CursorLaunchRecord {
  readonly transport: CursorTransportKind;
  readonly mode: ExecutionMode;
  readonly argv: readonly string[];
  readonly credentialInArgv: false;
  readonly credentialInjected: boolean;
  readonly sandboxOptions: CursorLocalSandboxOptions;
  readonly hooksRegistered: { readonly preToolUse: true; readonly beforeShellExecution: true };
  readonly sandboxTier: SandboxTierId;
  readonly jobId: string;
  readonly proxyUrl: string;
  readonly configDir: string;
  readonly personalCursorHome: string;
  readonly personalCursorUntouched: true;
  readonly osSandbox: true;
}

export type CursorNotice =
  | {
      readonly kind: "AccountCard";
      readonly message: typeof CURSOR_KEY_EXPIRED_ACCOUNT_CARD;
      readonly connectionId: string;
      readonly action: typeof CURSOR_LOGIN_ACTION;
      readonly silentPaidFallback: false;
    }
  | {
      readonly kind: "CheckpointStopCard";
      readonly reason: "cursor_on_demand_approval_required";
      readonly connectionId: string;
      readonly silentPaidFallback: false;
    };

export interface AgentRuntimeAdapter {
  probe(): Promise<CursorProbeResult>;
  authStatus(connectionId?: string): Promise<CursorAuthStatus>;
  startSession(spec: CursorSessionSpec): Promise<CursorSessionRef>;
  sendTurn(sessionId: string, briefOrPrompt: string): Promise<CursorTurnReceipt>;
  steer(sessionId: string, deltaNote: string): Promise<CursorSteerReceipt>;
  interrupt(sessionId: string): Promise<CursorInterruptReceipt>;
  resume(sessionId: string, checkpointRef: CursorCheckpointRef): Promise<CursorResumeResult>;
  events(sessionId: string): AsyncIterable<NormalizedRuntimeEvent>;
  respondPermission(
    sessionId: string,
    requestId: string,
    decision: PermissionDecision,
  ): Promise<PermissionApplyResult>;
  usage(sessionId: string): Promise<NormalizedUsage>;
}
