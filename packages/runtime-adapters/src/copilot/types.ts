export type RuntimePosture = "wrapped" | "stripped";

export type CopilotTransport = "sdk" | "acp";

export type BillingMode = "copilot_subscription" | "byok_api_key";

export type ByokProvider = "anthropic" | "openai" | "custom";

export type ByokKeyClass = "console_api" | "consumer_plan" | "unknown";

export type PermissionKind = "read" | "write" | "shell" | "web" | "mcp";

export type ResumeFallback = "native" | "fresh_session";

export interface LeasedMcpServer {
  readonly name: string;
  readonly url: string;
  readonly tools: readonly string[];
  readonly bearerRef: string;
}

export interface VettedSkill {
  readonly name: string;
  readonly markdown: string;
}

export interface BillingSpec {
  readonly mode: BillingMode;
  readonly byokVaultRef?: string;
}

export interface CopilotSessionSpec {
  readonly attemptId: string;
  readonly connectionId: string;
  readonly worktree: string;
  readonly brief: string;
  readonly writeScope: readonly string[];
  readonly mcpServers: readonly LeasedMcpServer[];
  readonly skills: readonly VettedSkill[];
  readonly billing: BillingSpec;
  readonly posture?: RuntimePosture;
  readonly transport?: CopilotTransport;
  readonly model?: string;
  readonly contradiction?: boolean;
}

export interface CopilotPermissionRequest {
  readonly requestId: string;
  readonly kind: PermissionKind;
  readonly path?: string;
  readonly command?: string;
  readonly url?: string;
  readonly tool?: string;
}

export interface PolicyContext {
  readonly posture: RuntimePosture;
  readonly worktree: string;
  readonly writeScope: readonly string[];
  readonly leasedTools: readonly string[];
  readonly request: CopilotPermissionRequest;
}

export interface PolicyDecision {
  readonly effect: "allow" | "deny";
  readonly reason: string;
}

/**
 * Local stand-in for Task 142 `DeterministicSupervisionPolicyEngine`.
 * Integration replaces this with the core engine; the method shape stays.
 */
export interface DeterministicSupervisionPolicyEngine {
  decide(input: PolicyContext): PolicyDecision;
}

export interface PermissionResponse {
  readonly effect: "allow" | "deny";
  readonly request?: CopilotPermissionRequest;
  readonly reason?: string;
}

export interface PermissionApplyResult {
  readonly requestId: string;
  readonly effect: "allow" | "deny";
  readonly reason: string;
  readonly elapsedMs: number;
}

export interface AccountQuotaSnapshot {
  readonly entitlement: number;
  readonly remaining: number;
  readonly percentRemaining: number;
  readonly resetDateUtc: string;
  readonly overageEnabled: boolean;
}

export interface CopilotModelDescriptor {
  readonly id: string;
  readonly enabledForOrg: boolean;
}

export interface NormalizedUsage {
  readonly inputTokens: number;
  readonly cachedInputTokens: number;
  readonly cacheCreationInputTokens: number;
  readonly outputTokens: number;
  readonly reasoningTokens: number;
  readonly premiumRequests: number;
  readonly costMicroUsd: number | null;
  readonly billingMode: BillingMode;
  readonly partial_interrupted: boolean;
  readonly subscriptionQuotaApplies: boolean;
  readonly byokConnectionId: string | null;
  readonly explicitOverageApproval: boolean;
  readonly quota: AccountQuotaSnapshot | null;
}

export type NormalizedRuntimeEvent =
  | {
      readonly type: "session_started";
      readonly sessionId: string;
      readonly transport: CopilotTransport;
      readonly posture: RuntimePosture;
    }
  | { readonly type: "turn_started"; readonly sessionId: string; readonly turn: number }
  | {
      readonly type: "turn_completed";
      readonly sessionId: string;
      readonly turn: number;
      readonly stopReason: string;
    }
  | { readonly type: "assistant_delta"; readonly sessionId: string; readonly text: string }
  | {
      readonly type: "permission_requested";
      readonly sessionId: string;
      readonly requestId: string;
      readonly kind: PermissionKind;
    }
  | {
      readonly type: "permission_decided";
      readonly sessionId: string;
      readonly requestId: string;
      readonly effect: "allow" | "deny";
      readonly reason: string;
      readonly elapsedMs: number;
    }
  | { readonly type: "usage_reported"; readonly sessionId: string; readonly usage: NormalizedUsage }
  | {
      readonly type: "rate_limited";
      readonly sessionId: string;
      readonly remaining: number;
      readonly overageEnabled: boolean;
    }
  | {
      readonly type: "session_error";
      readonly sessionId: string;
      readonly kind: "auth" | "billing" | "other";
      readonly message: string;
    }
  | { readonly type: "session_exited"; readonly sessionId: string; readonly reason: string }
  | { readonly type: "file_edited"; readonly sessionId: string; readonly paths: readonly string[] };

export interface CopilotProbeResult {
  readonly installed: boolean;
  readonly version: string;
  readonly versionStatus: "ok" | "version_too_old" | "missing";
  readonly requiredVersion: string;
  readonly transport: CopilotTransport;
  readonly modes: readonly RuntimePosture[];
  readonly enabledModelIds: readonly string[];
  readonly excludedModelIds: readonly string[];
}

export interface CopilotAuthStatus {
  readonly signedIn: boolean;
  readonly authExpired: boolean;
  readonly connectionId: string;
  readonly accountLogin: string | null;
  readonly quota: AccountQuotaSnapshot | null;
  readonly enabledModelIds: readonly string[];
  readonly excludedModelIds: readonly string[];
  readonly cardTitle: "Re-authenticate GitHub Copilot" | null;
}

export interface CopilotSessionRef {
  readonly sessionId: string;
  readonly attemptId: string;
  readonly transport: CopilotTransport;
  readonly posture: RuntimePosture;
  readonly vendorSessionId: string;
}

export interface CopilotTurnReceipt {
  readonly sessionId: string;
  readonly turn: number;
  readonly dispatched: boolean;
  readonly stopReason: string;
  readonly usage: NormalizedUsage;
}

export interface CopilotSteerResult {
  readonly applied: "mid_turn" | "queued";
  readonly sessionId: string;
}

export interface CopilotInterruptResult {
  readonly sessionId: string;
  readonly interrupted: true;
  readonly lingeringProcesses: number;
  readonly elapsedMs: number;
}

export interface CopilotCheckpointRef {
  readonly attemptId: string;
  readonly contradiction?: boolean;
}

export interface CopilotResumeResult {
  readonly supported: boolean;
  readonly fallback: ResumeFallback;
  readonly sessionId: string | null;
  readonly reason: "native" | "contradiction" | "unsupported_resume" | "missing_checkpoint";
}

export interface AgentRuntimeAdapter {
  probe(): Promise<CopilotProbeResult>;
  authStatus(connectionId: string): Promise<CopilotAuthStatus>;
  startSession(spec: CopilotSessionSpec): Promise<CopilotSessionRef>;
  sendTurn(sessionId: string, briefOrPrompt: string): Promise<CopilotTurnReceipt>;
  steer(sessionId: string, deltaNote: string): Promise<CopilotSteerResult>;
  interrupt(sessionId: string): Promise<CopilotInterruptResult>;
  resume(sessionId: string, checkpointRef: CopilotCheckpointRef): Promise<CopilotResumeResult>;
  events(sessionId: string): AsyncIterable<NormalizedRuntimeEvent>;
  respondPermission(
    sessionId: string,
    requestId: string,
    decision: PermissionResponse,
  ): Promise<PermissionApplyResult>;
  usage(sessionId: string): Promise<NormalizedUsage>;
}

export interface AttemptCheckpointRow {
  readonly attempt: string;
  readonly step: number;
  readonly sessionRef: string | null;
  readonly wipRef: string | null;
  readonly updatedAt: number;
  readonly resumeSupported: boolean;
  readonly contradiction: boolean;
  readonly transport: CopilotTransport;
  readonly posture: RuntimePosture;
}

export interface ConnectionWindowSchemaRow {
  readonly connection: string;
  readonly window_kind: "monthly";
  readonly window_start: number;
  readonly window_end: number;
  readonly limit_units: number;
  readonly observed_units: number;
  readonly estimated_units: number;
  readonly source: "account.getQuota";
  readonly observed_at: number;
  readonly remaining: number;
  readonly resetDateUtc: string;
  readonly overageEnabled: boolean;
}

export interface CheckpointStopCard {
  readonly kind: "checkpoint_stop";
  readonly connectionId: string;
  readonly reason: "paid_overage";
  readonly remaining: 0;
  readonly overageEnabled: true;
  readonly resetDateUtc: string;
  readonly cwnd: 0;
  readonly requiresExplicitApproval: true;
  readonly message: string;
}

export interface AccountCard {
  readonly kind: "account_card";
  readonly connectionId: string;
  readonly title: "Re-authenticate GitHub Copilot";
}

export interface ByokSpend {
  readonly connectionId: string;
  readonly provider: ByokProvider;
  readonly model: string;
  readonly microUsd: number;
  readonly billingMode: "byok_api_key";
}

export interface ModelRosterPublication {
  readonly connectionId: string;
  readonly enabledModelIds: readonly string[];
  readonly excludedModelIds: readonly string[];
}

export interface SandboxLease {
  readonly tier: string;
  readonly network: "loopback-allowlist";
  readonly jobRequired: true;
}

export interface JobAttachment {
  readonly jobObjectId: string;
}

export interface MountedCopilotFiles {
  readonly configDir: string;
  readonly skillsDir: string;
  readonly files: readonly string[];
}

export interface PersistedCopilotConfig {
  readonly worktree: string;
  readonly posture: RuntimePosture;
  readonly excludedTools: readonly string[];
  readonly mcpServerNames: readonly string[];
  readonly skillNames: readonly string[];
  readonly sandboxTier: string;
  readonly proxyUrl: string;
  readonly jobObjectId: string;
  readonly billingMode: BillingMode;
  readonly byokProvider: ByokProvider | null;
  readonly model: string | null;
}

export interface ByokMaterial {
  readonly key: string;
  readonly keyClass: ByokKeyClass;
  readonly provider: ByokProvider;
  readonly connectionId: string;
  readonly model: string;
  readonly baseUrl: string | null;
}

export interface ResolvedByok {
  readonly provider: ByokProvider;
  readonly connectionId: string;
  readonly model: string;
  readonly baseUrl: string | null;
  readonly apiKey: string;
}

export const STRIPPED_EXCLUDED_TOOLS = ["shell", "web_fetch", "web_search"] as const;

export const HARNESS_MCP_TOOLS = ["harness.run", "harness.read_result"] as const;

export const ACCOUNT_CARD_TITLE = "Re-authenticate GitHub Copilot" as const;

export const OVERAGE_STOP_MESSAGE =
  "Copilot premium requests are exhausted and paid overage is enabled. Approve before another request is sent.";
