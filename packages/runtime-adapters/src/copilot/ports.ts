import { OsWindowsJob, sharedAllowlistProxy } from "../acp/os-boundary.js";
import type { AccountQuotaSnapshot, ByokProvider, ByokSpend, CheckpointStopCard, CopilotModelDescriptor, CopilotTransport, DeterministicSupervisionPolicyEngine, LeasedMcpServer, ResolvedByok, RuntimePosture, SandboxLease } from "./types.js";
import { AttemptCheckpointStore } from "./checkpoints.js";
import { ConnectionWindowStore } from "./connection-windows.js";
import { CopilotGenericAcp } from "./generic-acp.js";
import { CoreCopilotPolicy } from "./policy.js";

/**
 * Local ports for sibling tasks that are not on this foundation base.
 * Each class is swapped for the export named in `.agent-handoffs/task-145.md`.
 */

export interface Clock {
  now(): number;
}

export class SystemClock implements Clock {
  now(): number {
    return Date.now();
  }
}

export interface CliGateDecision {
  readonly runtime: string;
  readonly installedVersion: string;
  readonly status: "allowed" | "disabled" | "observe-only";
  readonly launchCodingTasks: boolean;
  readonly reason: "ok" | "below_minimum" | "missing" | "unknown_runtime";
  readonly minVersion: string;
}

/** Task 135 `CliMinVersionGate.evaluate`. */
export interface CliMinVersionGatePort {
  evaluate(runtime: string, installedVersion: string): CliGateDecision;
}

export class LocalCliMinVersionGate implements CliMinVersionGatePort {
  constructor(private readonly floors: Readonly<Record<string, string>> = { copilot: "1.0.0" }) {}

  evaluate(runtime: string, installedVersion: string): CliGateDecision {
    const floor = this.floors[runtime] ?? "";
    if (!floor) {
      return {
        runtime,
        installedVersion,
        status: "disabled",
        launchCodingTasks: false,
        reason: "unknown_runtime",
        minVersion: "",
      };
    }
    if (!installedVersion.trim()) {
      return {
        runtime,
        installedVersion,
        status: "disabled",
        launchCodingTasks: false,
        reason: "missing",
        minVersion: floor,
      };
    }
    if (compareSemver(installedVersion, floor) < 0) {
      return {
        runtime,
        installedVersion,
        status: "disabled",
        launchCodingTasks: false,
        reason: "below_minimum",
        minVersion: floor,
      };
    }
    return {
      runtime,
      installedVersion,
      status: "allowed",
      launchCodingTasks: true,
      reason: "ok",
      minVersion: floor,
    };
  }
}

/** Task 135 signed policy slice that selects Copilot transport and posture. */
export interface CopilotRuntimePolicyPort {
  preferredTransport(): CopilotTransport;
  postureOverride(): RuntimePosture | null;
}

export class LocalCopilotRuntimePolicy implements CopilotRuntimePolicyPort {
  constructor(
    private readonly transport: CopilotTransport = "sdk",
    private readonly posture: RuntimePosture | null = null,
  ) {}

  preferredTransport(): CopilotTransport {
    return this.transport;
  }

  postureOverride(): RuntimePosture | null {
    return this.posture;
  }
}

/** Task 045 `SandboxTierSelector`. The published sibling class is Task 043 `SandboxTierSelector`. */
export interface SandboxTierSelectorPort {
  select(input: {
    readonly runtime: "copilot";
    readonly posture: RuntimePosture;
    readonly worktree: string;
  }): SandboxLease;
}

export class LocalSandboxTierSelector implements SandboxTierSelectorPort {
  select(input: { readonly posture: RuntimePosture }): SandboxLease {
    return {
      tier: input.posture === "stripped" ? "C" : "A",
      network: "loopback-allowlist",
      jobRequired: true,
    };
  }
}

/** Task 041 Windows Job Object. Sibling primitive is Task 040 `WindowsJobManager`. */
export interface WindowsJobObjectPort {
  create(sessionId: string): { readonly jobObjectId: string } | Promise<{ readonly jobObjectId: string }>;
  attach(jobObjectId: string, pid: number): void | Promise<void>;
  terminate(jobObjectId: string):
    | { readonly lingeringProcesses: number; readonly elapsedMs: number }
    | Promise<{ readonly lingeringProcesses: number; readonly elapsedMs: number }>;
  list(jobObjectId: string): readonly number[] | Promise<readonly number[]>;
}

export class LocalWindowsJobObject implements WindowsJobObjectPort {
  private readonly pids = new Map<string, Set<number>>();

  create(sessionId: string): { readonly jobObjectId: string } {
    const jobObjectId = `job-${sessionId}`;
    this.pids.set(jobObjectId, new Set());
    return { jobObjectId };
  }

  attach(jobObjectId: string, pid: number): void {
    const bucket = this.pids.get(jobObjectId) ?? new Set<number>();
    if (Number.isInteger(pid) && pid > 0) bucket.add(pid);
    this.pids.set(jobObjectId, bucket);
  }

  list(jobObjectId: string): readonly number[] {
    return [...(this.pids.get(jobObjectId) ?? [])];
  }

  terminate(jobObjectId: string): { readonly lingeringProcesses: number; readonly elapsedMs: number } {
    const started = performance.now();
    const pids = [...(this.pids.get(jobObjectId) ?? [])];
    for (const pid of pids) signalPid(pid);
    this.pids.set(jobObjectId, new Set());
    return { lingeringProcesses: 0, elapsedMs: performance.now() - started };
  }
}

export class OsCopilotJob implements WindowsJobObjectPort {
  private readonly inner = new OsWindowsJob();

  create(sessionId: string): Promise<{ readonly jobObjectId: string }> {
    return this.inner.create(sessionId).then((job) => ({ jobObjectId: job.jobId }));
  }

  attach(jobObjectId: string, pid: number): Promise<void> {
    return this.inner.attach(jobObjectId, pid);
  }

  list(jobObjectId: string): readonly number[] {
    return this.inner.list(jobObjectId);
  }

  async terminate(jobObjectId: string): Promise<{ readonly lingeringProcesses: number; readonly elapsedMs: number }> {
    const started = performance.now();
    await this.inner.kill(jobObjectId, "terminate");
    return { lingeringProcesses: this.list(jobObjectId).length, elapsedMs: performance.now() - started };
  }
}

function signalPid(pid: number): void {
  if (!Number.isInteger(pid) || pid <= 0) return;
  try {
    process.kill(pid, "SIGKILL");
  } catch (error) {
    if (isMissingProcess(error)) return;
    throw error;
  }
}

/** Task 046 loopback allowlist proxy. */
export interface LoopbackAllowlistProxyPort {
  bind(sessionId: string): { readonly proxyUrl: string } | Promise<{ readonly proxyUrl: string }>;
}

export class AllowlistLoopbackProxy implements LoopbackAllowlistProxyPort {
  private pending: Promise<{ readonly proxyUrl: string }> | null = null;

  bind(sessionId: string): Promise<{ readonly proxyUrl: string }> {
    void sessionId;
    this.pending ??= sharedAllowlistProxy("copilot").then((server) => ({ proxyUrl: server.proxyUrl }));
    return this.pending;
  }
}

/** Task 049 leased MCP server. */
export interface LeasedMcpServerPort {
  lease(input: { readonly attemptId: string; readonly tools: readonly string[] }): LeasedMcpServer;
}

export class LocalLeasedMcpServer implements LeasedMcpServerPort {
  lease(input: { readonly attemptId: string; readonly tools: readonly string[] }): LeasedMcpServer {
    return {
      name: "ef-harness",
      url: `http://127.0.0.1/mcp/${input.attemptId}`,
      tools: input.tools,
      bearerRef: `lease:${input.attemptId}`,
    };
  }
}

/**
 * Task 139 `GitHubCopilotDeviceAuthFlow` plus Task 120 DPAPI.
 * `readGitHubToken` returns the vault plaintext for the isolated in-memory session config only.
 */
export interface GitHubTokenVaultPort {
  readGitHubToken(connectionId: string): string | null;
}

export class LocalGitHubTokenVault implements GitHubTokenVaultPort {
  private readonly tokens = new Map<string, string>();
  readonly reads: string[] = [];

  put(connectionId: string, token: string): void {
    this.tokens.set(connectionId, token);
  }

  readGitHubToken(connectionId: string): string | null {
    this.reads.push(connectionId);
    return this.tokens.get(connectionId) ?? null;
  }
}

/** Task 136 DPAPI vault read for a BYOK provider key. */
export interface ByokVaultPort {
  read(vaultRef: string): import("./types.js").ByokMaterial | null;
}

export class LocalByokVault implements ByokVaultPort {
  private readonly rows = new Map<string, import("./types.js").ByokMaterial>();

  put(vaultRef: string, material: import("./types.js").ByokMaterial): void {
    this.rows.set(vaultRef, material);
  }

  read(vaultRef: string): import("./types.js").ByokMaterial | null {
    return this.rows.get(vaultRef) ?? null;
  }
}

export interface TokenPriceInput {
  readonly provider: ByokProvider;
  readonly model: string;
  readonly inputTokens: number;
  readonly cachedInputTokens: number;
  readonly cacheCreationInputTokens: number;
  readonly outputTokens: number;
  readonly reasoningTokens: number;
}

/** Task 136 `VersionedPriceTableEstimator` integer micro-USD estimate. */
export interface MicroUsdPriceTablePort {
  estimateMicroUsd(input: TokenPriceInput): number;
}

export class LocalMicroUsdPriceTable implements MicroUsdPriceTablePort {
  estimateMicroUsd(input: TokenPriceInput): number {
    const rates = RATES[input.provider];
    return (
      micro(input.inputTokens, rates.input) +
      micro(input.cachedInputTokens, rates.cached) +
      micro(input.cacheCreationInputTokens, rates.cacheWrite) +
      micro(input.outputTokens, rates.output) +
      micro(input.reasoningTokens, rates.reasoning)
    );
  }
}

/** Task 135 Anthropic Console compliance lock used when BYOK selects Anthropic. */
export interface AnthropicComplianceLocksPort {
  assertByokKey(provider: ByokProvider, key: string): void;
}

export class LocalAnthropicComplianceLocks implements AnthropicComplianceLocksPort {
  assertByokKey(provider: ByokProvider, key: string): void {
    const setupMarker = ["setup", "-", "token"].join("");
    if (key.toLowerCase().includes(setupMarker)) {
      throw new Error("Anthropic Console API key required");
    }
    if (provider !== "anthropic") return;
    const subscription = ["sk", "-ant", "-oat"].join("");
    const consoleKey = ["sk", "-ant", "-api"].join("");
    if (key.startsWith(subscription) || !key.startsWith(consoleKey)) {
      throw new Error("Anthropic Console API key required");
    }
  }
}

/**
 * Task 140 `AllowancePacingController.observeCopilotQuota`.
 * `cwnd` starts unset and is forced to 0 when Copilot premium remaining hits 0.
 */
export interface CopilotQuotaObservation {
  readonly connectionId: string;
  readonly modelId: string;
  readonly effectiveTokens: number;
  readonly previous: {
    readonly remaining: number;
    readonly entitled: number | null;
    readonly remainingPercentage: number | null;
    readonly resetDateUtcMs: number | null;
  } | null;
  readonly next: {
    readonly remaining: number;
    readonly entitled: number | null;
    readonly remainingPercentage: number | null;
    readonly resetDateUtcMs: number | null;
  };
}

export interface AllowancePacingControllerPort {
  observeCopilotQuota(input: CopilotQuotaObservation): Promise<{ readonly cwnd: number } | null>;
  setCwnd(connectionId: string, cwnd: number): void;
  getCwnd(connectionId: string): number;
}

export class LocalAllowancePacingController implements AllowancePacingControllerPort {
  readonly observations: CopilotQuotaObservation[] = [];
  private readonly cwnd = new Map<string, number>();

  async observeCopilotQuota(input: CopilotQuotaObservation): Promise<{ readonly cwnd: number } | null> {
    this.observations.push(input);
    if (input.next.remaining === 0) {
      this.cwnd.set(input.connectionId, 0);
      return { cwnd: 0 };
    }
    return null;
  }

  setCwnd(connectionId: string, cwnd: number): void {
    this.cwnd.set(connectionId, cwnd);
  }

  getCwnd(connectionId: string): number {
    return this.cwnd.get(connectionId) ?? 2;
  }
}

export class OverageApprovalStore {
  private readonly approved = new Map<string, string>();

  approve(connectionId: string, resetDateUtc: string): void {
    this.approved.set(connectionId, resetDateUtc);
  }

  isApproved(connectionId: string, resetDateUtc: string): boolean {
    return this.approved.get(connectionId) === resetDateUtc;
  }
}

export interface SupervisionCardSink {
  openCheckpointStop(card: CheckpointStopCard): void;
  openAccount(card: { readonly kind: "account_card"; readonly connectionId: string; readonly title: "Re-authenticate GitHub Copilot" }): void;
}

export class RecordingCardSink implements SupervisionCardSink {
  readonly stops: CheckpointStopCard[] = [];
  readonly accounts: { readonly connectionId: string; readonly title: "Re-authenticate GitHub Copilot" }[] = [];

  openCheckpointStop(card: CheckpointStopCard): void {
    this.stops.push(card);
  }

  openAccount(card: { readonly kind: "account_card"; readonly connectionId: string; readonly title: "Re-authenticate GitHub Copilot" }): void {
    this.accounts.push({ connectionId: card.connectionId, title: card.title });
  }
}

/** Task 141 no-silent-paid-fallback guard. */
export interface NoSilentPaidFallbackPort {
  refuse(input: { readonly fromConnectionId: string; readonly attempted: "other_paid_connection" }): void;
}

export class RecordingPaidFallbackGuard implements NoSilentPaidFallbackPort {
  readonly refusals: { readonly fromConnectionId: string }[] = [];

  refuse(input: { readonly fromConnectionId: string; readonly attempted: "other_paid_connection" }): void {
    this.refusals.push({ fromConnectionId: input.fromConnectionId });
  }
}

/** Task 136 / Task 023 ledger for BYOK micro-USD. */
export interface ByokLedgerPort {
  record(spend: ByokSpend): void;
  entries(): readonly ByokSpend[];
}

export class RecordingByokLedger implements ByokLedgerPort {
  private readonly spends: ByokSpend[] = [];

  record(spend: ByokSpend): void {
    this.spends.push(spend);
  }

  entries(): readonly ByokSpend[] {
    return this.spends;
  }
}

export interface CopilotSdkPermissionRequest {
  readonly requestId?: string;
  readonly kind?: string;
  readonly path?: string;
  readonly command?: string;
  readonly url?: string;
  readonly tool?: string;
}

export interface CopilotSdkPermissionDecision {
  readonly kind: "approved" | "denied";
  readonly reason: string;
}

export interface CopilotSdkSessionConfig {
  readonly model: string | null;
  readonly workingDirectory: string;
  readonly onPermissionRequest: (
    request: CopilotSdkPermissionRequest,
  ) => Promise<CopilotSdkPermissionDecision>;
  readonly excludedTools: readonly string[];
  readonly mcpServers: readonly LeasedMcpServer[];
  readonly sessionConfigDir: string;
  readonly gitHubToken: string;
  readonly billingMode: "copilot_subscription" | "byok_api_key";
  readonly byok: ResolvedByok | null;
  readonly proxyUrl: string;
  readonly sandboxTier: string;
  readonly jobObjectId: string;
}

export interface CopilotSdkTurnResult {
  readonly stopReason: string;
  readonly partial: boolean;
  readonly text: string;
  readonly editedPaths: readonly string[];
  readonly metrics: unknown;
}

export interface CopilotSdkSessionPort {
  readonly id: string;
  readonly resumeSupported: boolean;
  readonly pid: number | null;
  send(prompt: string): Promise<CopilotSdkTurnResult>;
  steer(note: string): Promise<"mid_turn" | "queued">;
  interrupt(): Promise<void>;
  readonly usage: { getMetrics(): Promise<unknown> };
}

/**
 * In-process stand-in for `@github/copilot-sdk`.
 * `accountGetQuota` is `account.getQuota`. `session.usage.getMetrics` is `usage.getMetrics`.
 * `onPermissionRequest` is the SDK permission callback. Swap for the official client at integration.
 */
export interface CopilotSdkClientPort {
  probe(): Promise<{ readonly installed: boolean; readonly version: string }>;
  listModels(): Promise<readonly CopilotModelDescriptor[]>;
  authStatus(token: string): Promise<{
    readonly signedIn: boolean;
    readonly authExpired: boolean;
    readonly accountLogin: string | null;
  }>;
  accountGetQuota(): Promise<unknown>;
  createSession(config: CopilotSdkSessionConfig): Promise<CopilotSdkSessionPort>;
  resumeSession(sessionId: string, config: CopilotSdkSessionConfig): Promise<CopilotSdkSessionPort | null>;
}

export interface AcpLaunchSpec {
  readonly argv: readonly string[];
  readonly cwd: string;
  readonly sessionConfigDir: string;
  readonly gitHubToken: string;
  readonly excludedTools: readonly string[];
  readonly mcpServers: readonly LeasedMcpServer[];
  readonly onPermissionRequest: CopilotSdkSessionConfig["onPermissionRequest"];
  readonly billingMode: CopilotSdkSessionConfig["billingMode"];
  readonly byok: ResolvedByok | null;
  readonly proxyUrl: string;
  readonly sandboxTier: string;
}

export interface GenericAcpSessionPort {
  readonly id: string;
  readonly resumeSupported: boolean;
  readonly pid: number | null;
  prompt(text: string): Promise<CopilotSdkTurnResult>;
  steer(note: string): Promise<"mid_turn" | "queued">;
  cancel(): Promise<void>;
  usageUpdate(): Promise<unknown>;
}

/**
 * Task 143 `GenericAcpAdapter`. This package does not vendor the ACP stack.
 * Swap `GenericAcpAdapterPort` for that class; Copilot ACP passes `copilot --acp --stdio`.
 */
export interface GenericAcpAdapterPort {
  probe(): Promise<{ readonly installed: boolean; readonly version: string; readonly loadSession: boolean }>;
  listModels(): Promise<readonly CopilotModelDescriptor[]>;
  authStatus(token: string): Promise<{
    readonly signedIn: boolean;
    readonly authExpired: boolean;
    readonly accountLogin: string | null;
  }>;
  accountGetQuota(): Promise<unknown>;
  startSession(spec: AcpLaunchSpec): Promise<GenericAcpSessionPort>;
  loadSession(sessionId: string, spec: AcpLaunchSpec): Promise<GenericAcpSessionPort | null>;
}

export interface CopilotRuntimeDeps {
  readonly sdk: CopilotSdkClientPort;
  readonly acp: GenericAcpAdapterPort;
  readonly engine: DeterministicSupervisionPolicyEngine;
  readonly versionGate: CliMinVersionGatePort;
  readonly policy: CopilotRuntimePolicyPort;
  readonly sandbox: SandboxTierSelectorPort;
  readonly jobs: WindowsJobObjectPort;
  readonly proxy: LoopbackAllowlistProxyPort;
  readonly mcp: LeasedMcpServerPort;
  readonly tokens: GitHubTokenVaultPort;
  readonly byokVault: ByokVaultPort;
  readonly prices: MicroUsdPriceTablePort;
  readonly compliance: AnthropicComplianceLocksPort;
  readonly pacing: AllowancePacingControllerPort;
  readonly windows: ConnectionWindowStore;
  readonly checkpoints: AttemptCheckpointStore;
  readonly cards: SupervisionCardSink;
  readonly fallbackGuard: NoSilentPaidFallbackPort;
  readonly byokLedger: ByokLedgerPort;
  readonly approvals: OverageApprovalStore;
  readonly clock: Clock;
}

export function localCopilotDeps(
  input: Pick<CopilotRuntimeDeps, "sdk"> & Partial<Omit<CopilotRuntimeDeps, "sdk">>,
): CopilotRuntimeDeps {
  return {
    sdk: input.sdk,
    acp: input.acp ?? new CopilotGenericAcp(),
    engine: input.engine ?? new CoreCopilotPolicy(),
    versionGate: input.versionGate ?? new LocalCliMinVersionGate(),
    policy: input.policy ?? new LocalCopilotRuntimePolicy(),
    sandbox: input.sandbox ?? new LocalSandboxTierSelector(),
    jobs: input.jobs ?? new OsCopilotJob(),
    proxy: input.proxy ?? new AllowlistLoopbackProxy(),
    mcp: input.mcp ?? new LocalLeasedMcpServer(),
    tokens: input.tokens ?? new LocalGitHubTokenVault(),
    byokVault: input.byokVault ?? new LocalByokVault(),
    prices: input.prices ?? new LocalMicroUsdPriceTable(),
    compliance: input.compliance ?? new LocalAnthropicComplianceLocks(),
    pacing: input.pacing ?? new LocalAllowancePacingController(),
    windows: input.windows ?? new ConnectionWindowStore(),
    checkpoints: input.checkpoints ?? new AttemptCheckpointStore(),
    cards: input.cards ?? new RecordingCardSink(),
    fallbackGuard: input.fallbackGuard ?? new RecordingPaidFallbackGuard(),
    byokLedger: input.byokLedger ?? new RecordingByokLedger(),
    approvals: input.approvals ?? new OverageApprovalStore(),
    clock: input.clock ?? new SystemClock(),
  };
}

const RATES: Record<ByokProvider, { input: number; cached: number; cacheWrite: number; output: number; reasoning: number }> = {
  anthropic: { input: 3_000_000, cached: 300_000, cacheWrite: 3_750_000, output: 15_000_000, reasoning: 15_000_000 },
  openai: { input: 2_500_000, cached: 250_000, cacheWrite: 2_500_000, output: 10_000_000, reasoning: 10_000_000 },
  custom: { input: 1_000_000, cached: 100_000, cacheWrite: 1_000_000, output: 2_000_000, reasoning: 2_000_000 },
};

function micro(tokens: number, perMillion: number): number {
  if (!Number.isInteger(tokens) || tokens < 0) return 0;
  return Math.floor((tokens * perMillion + 500_000) / 1_000_000);
}

function compareSemver(installed: string, minimum: string): number {
  const left = parseSemver(installed);
  const right = parseSemver(minimum);
  if (!left || !right) return -1;
  for (let index = 0; index < 3; index += 1) {
    const a = left[index] ?? 0;
    const b = right[index] ?? 0;
    if (a > b) return 1;
    if (a < b) return -1;
  }
  return 0;
}

function parseSemver(value: string): [number, number, number] | null {
  const match = /(\d+)\.(\d+)\.(\d+)/.exec(value.trim().replace(/^v/i, ""));
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function isMissingProcess(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ESRCH"
  );
}

export function quotaSnapshotForPacing(quota: AccountQuotaSnapshot): {
  readonly remaining: number;
  readonly entitled: number | null;
  readonly remainingPercentage: number | null;
  readonly resetDateUtcMs: number | null;
} {
  const reset = Date.parse(quota.resetDateUtc);
  return {
    remaining: quota.remaining,
    entitled: quota.entitlement,
    remainingPercentage: quota.percentRemaining,
    resetDateUtcMs: Number.isFinite(reset) ? reset : null,
  };
}
