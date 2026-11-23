import type { WorktreeIo } from "./isolation.js";
import type {
  BeforeShellInput,
  CursorAuthState,
  CursorCheckpointRecord,
  CursorLaunchRecord,
  CursorLocalSandboxOptions,
  CursorMcpServer,
  CursorNotice,
  CursorRunResult,
  CursorTransportKind,
  ExecutionMode,
  HookDecision,
  NormalizedUsage,
  PreToolUseInput,
  SandboxTierId,
} from "./types.js";

export interface CliGateDecision {
  readonly launchCodingTasks: boolean;
  readonly status: "allowed" | "disabled";
  readonly reason: "ok" | "missing" | "below_minimum";
  readonly minVersion: string | null;
}

/** Task 135 `CliMinVersionGate.evaluate`. */
export interface CliMinVersionGatePort {
  evaluate(runtime: string, installedVersion: string): CliGateDecision;
}

/** Task 135 signed policy transport override for Cursor. */
export interface SignedCursorTransportPolicyPort {
  transportOverride(): Promise<CursorTransportKind | "auto">;
}

export interface JobAssignment {
  readonly jobId: string;
}

/** Task 041 `WindowsJobSupervisor` (sibling process-tree primitive is Task 040). */
export interface WindowsJobSupervisorPort {
  create(sessionId: string): JobAssignment;
  attach(jobId: string, pid: number): void;
  list(jobId: string): readonly number[];
  kill(jobId: string, reason: string): readonly number[];
}

export interface SandboxTierChoice {
  readonly tier: SandboxTierId;
  readonly hold: boolean;
  readonly reason: string;
}

/** Task 045 `SandboxTierSelector`. Published sibling method is `selectTier`. */
export interface SandboxTierSelectorPort {
  selectTier(input: {
    readonly runtime: "cursor";
    readonly worktreeRoot: string;
    readonly requestedMode: ExecutionMode;
  }): Promise<SandboxTierChoice>;
}

/** Task 046 loopback allowlist proxy. */
export interface LoopbackAllowlistProxyPort {
  bind(input: { readonly sessionId: string; readonly tier: SandboxTierId }): Promise<{
    readonly endpoint: string;
  }>;
}

export interface McpLease {
  readonly leaseId: string;
  readonly endpoint: string;
  readonly tools: readonly string[];
}

/** Task 049 `LeasedMcpServer`. */
export interface LeasedMcpServerPort {
  lease(input: { readonly sessionId: string; readonly tools: readonly string[] }): Promise<McpLease>;
}

/** Task 151 conformance cache. Newer CLIs stay observe-only until the suite passes. */
export interface CursorConformanceGatePort {
  verified(version: string): boolean;
}

export interface CursorKeySnapshot {
  readonly connectionId: string;
  readonly expiresAt: number | null;
  readonly status: CursorAuthState;
  readonly expired: boolean;
}

/**
 * Task 139 `CursorBrowserAuthFlow` plus the DPAPI vault.
 * Plaintext crosses this boundary only and must never be copied into argv or logs.
 */
export interface CursorKeyMaterialPort {
  inspect(connectionId: string, now: number): Promise<CursorKeySnapshot>;
  readUserApiKey(connectionId: string): Promise<string | null>;
  markAuthExpired(connectionId: string, status: "expired" | "unauthorized"): Promise<void>;
}

/** Task 139 `CursorKeyExpiryReminderScheduler` metadata read. */
export interface CursorKeyExpiryPort {
  inspect(connectionId: string, now: number): Promise<CursorKeySnapshot>;
  mark(connectionId: string, status: "expired" | "unauthorized"): Promise<void>;
}

/** Official `Agent.getUsage()` client. */
export interface CursorAgentUsageClient {
  getUsage(apiKey: string): Promise<unknown>;
}

export interface CursorSdkAvailability {
  readonly installed: boolean;
  readonly version: string;
}

export interface CursorSdkCreateRequest {
  readonly apiKey: string;
  readonly modelId?: string;
  readonly local: {
    readonly cwd: string;
    readonly configDir: string;
    readonly sandboxOptions: CursorLocalSandboxOptions;
    readonly hooks: {
      readonly preToolUse: (input: PreToolUseInput) => HookDecision;
      readonly beforeShellExecution: (input: BeforeShellInput) => HookDecision;
    };
    readonly mcpServers: readonly CursorMcpServer[];
  };
}

export interface CursorSdkAgentHandle {
  readonly agentId: string;
  readonly pid: number;
  readonly childPids: readonly number[];
  send(prompt: string, signal: AbortSignal): Promise<CursorRunResult>;
  steer(note: string): Promise<void>;
  abort(): Promise<void>;
  resume(handle: string): Promise<{ readonly supported: boolean }>;
  dispose(): Promise<void>;
}

/** Local port of `@cursor/sdk` `Agent.create` local runtime. */
export interface CursorSdkPort extends CursorAgentUsageClient {
  available(): Promise<CursorSdkAvailability>;
  createLocalAgent(request: CursorSdkCreateRequest): Promise<CursorSdkAgentHandle>;
  authLogin(connectionId: string): Promise<void>;
}

export interface CursorAcpSpawnRequest {
  readonly command: "cursor-agent";
  readonly args: readonly ["acp"];
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
  readonly sandboxOptions: CursorLocalSandboxOptions;
  readonly hooks: CursorSdkCreateRequest["local"]["hooks"];
}

export interface CursorAcpSessionHandle {
  readonly sessionId: string;
  readonly pid: number;
  readonly childPids: readonly number[];
  readonly argv: readonly string[];
  prompt(prompt: string, signal: AbortSignal): Promise<CursorRunResult>;
  steer(note: string): Promise<void>;
  cancel(): Promise<void>;
  load(handle: string): Promise<{ readonly supported: boolean }>;
  dispose(): Promise<void>;
}

/** Task 143 `GenericAcpAdapter`, configured here for `cursor-agent acp`. */
export interface GenericAcpAdapterPort {
  probe(command: "cursor-agent"): Promise<{
    readonly installed: boolean;
    readonly version: string;
    readonly loadSession: boolean;
  }>;
  start(request: CursorAcpSpawnRequest): Promise<CursorAcpSessionHandle>;
}

/** Task 140 `AllowancePacingController.observeAuthoritativeUsage`. */
export interface AllowancePacingPort {
  observeAuthoritativeUsage(input: {
    readonly connectionId: string;
    readonly windowKind: "cursor_included";
    readonly usedPpm: number;
    readonly source: "Agent.getUsage";
    readonly onDemandEnabled: boolean;
    readonly chargedCents: number;
  }): Promise<{ readonly action: "continue" | "pause_before_on_demand"; readonly cwnd: number }>;
  reportRunUsage(input: {
    readonly connectionId: string;
    readonly source: "run.usage";
    readonly usage: NormalizedUsage;
  }): Promise<void>;
}

/** Task 141 no-silent-paid-fallback guard. */
export interface NoSilentPaidFallbackPort {
  refuseSilentPaidFallback(input: {
    readonly connectionId: string;
    readonly from: "cursor_subscription";
    readonly to: "paid_api_key";
  }): Promise<void>;
}

export interface CursorNoticeSink {
  emit(notice: CursorNotice): void;
  readonly notices: readonly CursorNotice[];
}

export interface CursorDispatchParkerPort {
  park(input: {
    readonly connectionId: string;
    readonly reason: "expired" | "unauthorized" | "on_demand";
    readonly preserveWip: true;
  }): Promise<void>;
}

export interface AttemptCheckpointStorePort {
  save(record: CursorCheckpointRecord): Promise<void>;
  load(sessionId: string): Promise<CursorCheckpointRecord | null>;
}

export interface OpenCursorAgent {
  readonly vendorId: string;
  readonly pid: number;
  readonly childPids: readonly number[];
  readonly argv: readonly string[];
  send(prompt: string, signal: AbortSignal): Promise<CursorRunResult>;
  steer(note: string): Promise<void>;
  abort(): Promise<void>;
  resume(handle: string): Promise<{ readonly supported: boolean }>;
  dispose(): Promise<void>;
}

export interface CursorRuntimeDeps {
  readonly sdk: CursorSdkPort;
  readonly acp: GenericAcpAdapterPort;
  readonly usage: CursorAgentUsageClient;
  readonly jobs: WindowsJobSupervisorPort;
  readonly sandbox: SandboxTierSelectorPort;
  readonly proxy: LoopbackAllowlistProxyPort;
  readonly mcp: LeasedMcpServerPort;
  readonly cliGate: CliMinVersionGatePort;
  readonly signedPolicy: SignedCursorTransportPolicyPort;
  readonly conformance: CursorConformanceGatePort;
  readonly keys: CursorKeyMaterialPort;
  readonly expiry: CursorKeyExpiryPort;
  readonly pacing: AllowancePacingPort;
  readonly fallbackGuard: NoSilentPaidFallbackPort;
  readonly notices: CursorNoticeSink;
  readonly parker: CursorDispatchParkerPort;
  readonly checkpoints: AttemptCheckpointStorePort;
  readonly log: { record(event: string, fields: Readonly<Record<string, string>>): void; lines(): readonly string[] };
  readonly redactor: { register(value: string): void; redact(text: string): string };
  readonly personalCursorHome: string;
  readonly homeDir: string;
  readonly clock: () => number;
  readonly io?: WorktreeIo;
  readonly launches?: CursorLaunchRecord[];
}

export interface StoredPermission {
  readonly requestId: string;
  readonly decision: HookDecision;
}
