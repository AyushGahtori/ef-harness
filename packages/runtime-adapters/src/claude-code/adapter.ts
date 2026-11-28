import { randomUUID } from "node:crypto";
import os from "node:os";
import { ClaudeConsoleKeyComplianceEnforcer } from "./compliance-enforcer.js";
import { ClaudeCodeAdapterError } from "./errors.js";
import { NormalizedRuntimeEventBus } from "./event-bus.js";
import {
  buildClaudeArgv,
  prepareIsolatedWorkspace,
  removeConfigDir,
  scrubChildEnvironment,
  type ClaudeLaunchPlan,
} from "./launch-plan.js";
import { CONSOLE_KEY_REQUIRED_MESSAGE } from "./markers.js";
import { decimalDollarsToMicroUsd, formatBudgetUsd } from "./money.js";
import { ClaudeStdioPermissionController } from "./permission-controller.js";
import { AllowlistClaudeProxy, AttemptMcpClaudeLease, OsClaudeJob } from "./os-ports.js";
import {
  DEFAULT_LEASED_MCP_TOOLS,
  LocalApiConnectionManager,
  LocalAttemptCheckpoints,
  LocalBudgetLedger,
  LocalCliMinVersionGate,
  LocalPacketSecurityRedactor,
  LocalPriceTable,
  LocalSandboxTierSelector,
  LocalWindowsDpapiSecretsVault,
  nodeProcessSpawner,
  type ApiConnectionManagerPort,
  type AttemptCheckpointPort,
  type BudgetLedgerPort,
  type CliMinVersionGatePort,
  type CompliancePolicyLocksPort,
  type LeasedMcpServerPort,
  type LoopbackAllowlistProxyPort,
  type PacketSecurityRedactorPort,
  type PriceTablePort,
  type ProcessSpawner,
  type SandboxTierSelectorPort,
  type WindowsDpapiSecretsVaultPort,
  type WindowsJobSupervisorPort,
} from "./ports.js";
import type { PolicyContext } from "./supervision-policy.js";
import { ClaudeStreamJsonTransport } from "./stream-transport.js";
import {
  BUDGET_STOP_HANDOFF,
  CLAUDE_RUNTIME_ID,
  type AttemptCheckpoint,
  type CheckpointRef,
  type ClaudeAuthStatus,
  type ClaudePermissionDecision,
  type ClaudeProbeResult,
  type ClaudeResumeResult,
  type ClaudeSessionDiagnostics,
  type ClaudeSessionHandle,
  type ClaudeSessionSpec,
  type ClaudeUsageReport,
  type CostCrossCheck,
  type ExecutionMode,
  type NormalizedRuntimeEvent,
  type SpendReceipt,
} from "./types.js";

export interface ClaudeCodeRuntimeAdapterOptions {
  readonly command?: string;
  readonly commandPrefix?: readonly string[];
  readonly spawner?: ProcessSpawner;
  readonly jobs?: WindowsJobSupervisorPort;
  readonly sandbox?: SandboxTierSelectorPort;
  readonly vault?: WindowsDpapiSecretsVaultPort;
  readonly connections?: ApiConnectionManagerPort;
  readonly cliGate?: CliMinVersionGatePort;
  readonly complianceLocks?: CompliancePolicyLocksPort;
  readonly prices?: PriceTablePort;
  readonly ledger?: BudgetLedgerPort;
  readonly checkpoints?: AttemptCheckpointPort;
  readonly redactor?: PacketSecurityRedactorPort;
  readonly proxy?: LoopbackAllowlistProxyPort;
  readonly mcp?: LeasedMcpServerPort;
  readonly permissions?: ClaudeStdioPermissionController;
  readonly bus?: NormalizedRuntimeEventBus;
  readonly hostEnv?: NodeJS.ProcessEnv;
  readonly authorizedEnvOverlay?: Readonly<Record<string, string>>;
  readonly homeDir?: string;
  readonly defaultConnectionId?: string;
  readonly interruptGraceMs?: number;
}

interface SessionRecord {
  readonly spec: ClaudeSessionSpec;
  readonly sessionId: string;
  readonly attemptId: string;
  readonly mode: ExecutionMode;
  readonly modelId: string;
  readonly configDir: string;
  readonly plan: ClaudeLaunchPlan;
  readonly sandboxTier: string;
  readonly jobId: string;
  claudeSessionId: string | null;
  spendRecorded: boolean;
}

/**
 * Console-key-only headless Claude Code runtime.
 * Implements the ten-method agent runtime contract against local sibling ports.
 */
export class ClaudeCodeRuntimeAdapter {
  readonly runtime = CLAUDE_RUNTIME_ID;
  private readonly command: string;
  private readonly commandPrefix: readonly string[];
  private readonly spawner: ProcessSpawner;
  private readonly jobs: WindowsJobSupervisorPort;
  private readonly sandbox: SandboxTierSelectorPort;
  private readonly connections: ApiConnectionManagerPort;
  private readonly cliGate: CliMinVersionGatePort;
  private readonly locks: CompliancePolicyLocksPort | null;
  private readonly prices: PriceTablePort;
  private readonly ledger: BudgetLedgerPort;
  private readonly checkpoints: AttemptCheckpointPort;
  private readonly redactor: PacketSecurityRedactorPort;
  private readonly proxy: LoopbackAllowlistProxyPort;
  private readonly mcp: LeasedMcpServerPort;
  private readonly permissions: ClaudeStdioPermissionController;
  private readonly bus: NormalizedRuntimeEventBus;
  private readonly transport: ClaudeStreamJsonTransport;
  private readonly enforcer = new ClaudeConsoleKeyComplianceEnforcer();
  private readonly hostEnv: NodeJS.ProcessEnv;
  private readonly overlay: Readonly<Record<string, string>>;
  private readonly homeDir: string;
  private readonly defaultConnectionId: string;
  private readonly sessions = new Map<string, SessionRecord>();
  private readonly specs = new Map<string, ClaudeSessionSpec>();
  private readonly liveAttempt = new Map<string, string>();

  constructor(options: ClaudeCodeRuntimeAdapterOptions = {}) {
    this.command = options.command ?? "claude";
    this.commandPrefix = options.commandPrefix ?? [];
    this.spawner = options.spawner ?? nodeProcessSpawner();
    this.jobs = options.jobs ?? new OsClaudeJob();
    this.sandbox = options.sandbox ?? new LocalSandboxTierSelector();
    const vault = options.vault ?? new LocalWindowsDpapiSecretsVault();
    this.connections = options.connections ?? new LocalApiConnectionManager(vault);
    this.cliGate = options.cliGate ?? new LocalCliMinVersionGate();
    this.locks = options.complianceLocks ?? null;
    this.prices = options.prices ?? new LocalPriceTable();
    this.ledger = options.ledger ?? new LocalBudgetLedger();
    this.checkpoints = options.checkpoints ?? new LocalAttemptCheckpoints();
    this.redactor = options.redactor ?? new LocalPacketSecurityRedactor();
    this.proxy = options.proxy ?? new AllowlistClaudeProxy();
    this.mcp = options.mcp ?? new AttemptMcpClaudeLease();
    this.permissions = options.permissions ?? new ClaudeStdioPermissionController();
    this.bus = options.bus ?? new NormalizedRuntimeEventBus();
    this.hostEnv = options.hostEnv ?? process.env;
    this.overlay = options.authorizedEnvOverlay ?? {};
    this.homeDir = options.homeDir ?? os.homedir();
    this.defaultConnectionId = options.defaultConnectionId ?? "";
    this.transport = new ClaudeStreamJsonTransport(
      this.spawner,
      this.jobs,
      this.bus,
      this.redactor,
      options.interruptGraceMs ?? 500,
    );
  }

  async probe(): Promise<ClaudeProbeResult> {
    const modes = ["wrapped", "stripped"] as const;
    const version = await this.readVersion();
    if (!version) {
      return {
        runtime: CLAUDE_RUNTIME_ID,
        installed: false,
        version: null,
        status: "missing",
        supportedModes: modes,
        minVersion: null,
        reason: "Claude Code CLI was not found or did not report a version",
      };
    }
    const gate = this.cliGate.evaluate("claude", version);
    if (!gate.launchCodingTasks || gate.reason === "below_minimum" || gate.reason === "missing") {
      return {
        runtime: CLAUDE_RUNTIME_ID,
        installed: true,
        version,
        status: "version_too_old",
        supportedModes: modes,
        minVersion: gate.minVersion,
        reason: `Claude Code ${version} is below the minimum safe version ${gate.minVersion ?? "required"}`,
      };
    }
    return {
      runtime: CLAUDE_RUNTIME_ID,
      installed: true,
      version,
      status: "ready",
      supportedModes: modes,
      minVersion: gate.minVersion,
      reason: "Claude Code meets the minimum version for stream-json permission prompts and budget caps",
    };
  }

  async authStatus(connectionId = this.defaultConnectionId): Promise<ClaudeAuthStatus> {
    const secret = connectionId ? this.connections.readConsoleKey(connectionId) : null;
    const verdict = this.enforcer.evaluate({
      secret,
      hostEnv: this.hostEnv,
      delivery: "env",
    });
    if (!verdict.ok && verdict.code !== "missing_console_key" && verdict.code !== "invalid_prefix") {
      return {
        runtime: CLAUDE_RUNTIME_ID,
        state: "rejected_subscription_credential",
        readsPersonalClaudeHome: false,
        message: verdict.message,
      };
    }
    if (!verdict.ok) {
      return {
        runtime: CLAUDE_RUNTIME_ID,
        state: "missing_console_key",
        readsPersonalClaudeHome: false,
        message: CONSOLE_KEY_REQUIRED_MESSAGE,
      };
    }
    return {
      runtime: CLAUDE_RUNTIME_ID,
      state: "console_key_present",
      readsPersonalClaudeHome: false,
      message: "Anthropic Console API key is available",
    };
  }

  async startSession(spec: ClaudeSessionSpec): Promise<ClaudeSessionHandle> {
    const mode: ExecutionMode = spec.mode ?? "wrapped";
    if (mode !== "wrapped" && mode !== "stripped") {
      throw new ClaudeCodeAdapterError("invalid_mode", "Claude Code mode must be wrapped or stripped");
    }
    const delivery = spec.credentialDelivery ?? "env";
    const secret = this.connections.readConsoleKey(spec.connectionId);
    const verdict = this.enforcer.evaluate({ secret, hostEnv: this.hostEnv, delivery });
    if (!verdict.ok) throw new ClaudeCodeAdapterError(verdict.code, verdict.message);
    if (this.locks) {
      const extra = this.locks.inspectCredential({
        secret: verdict.secret,
        provider: "claude",
        kind: "console_api_key",
      });
      if (!extra.allowed) {
        throw new ClaudeCodeAdapterError(extra.code || "compliance_lock", extra.message || CONSOLE_KEY_REQUIRED_MESSAGE);
      }
    }
    const reservation = this.ledger.reserve({
      attemptId: spec.attemptId,
      connectionId: spec.connectionId,
      ceilingMicroUsd: spec.budgetMicroUsd,
    });
    const maxBudgetUsd = formatBudgetUsd(reservation.remainingMicroUsd);
    const sandbox = this.sandbox.selectTier({
      runtime: CLAUDE_RUNTIME_ID,
      worktreeRoot: spec.worktreeRoot,
      requestedMode: mode,
    });
    if (sandbox.hold) {
      throw new ClaudeCodeAdapterError("sandbox_hold", sandbox.reason);
    }
    const probed = await this.probe();
    if (probed.status === "version_too_old") {
      throw new ClaudeCodeAdapterError("version_too_old", probed.reason);
    }
    if (probed.status !== "ready") {
      throw new ClaudeCodeAdapterError("missing_cli", probed.reason);
    }

    const sessionId = randomUUID();
    const job = await this.jobs.create(sessionId);
    const lease = await this.mcp.lease({ sessionId, tools: DEFAULT_LEASED_MCP_TOOLS });
    const workspace = prepareIsolatedWorkspace({
      attemptId: spec.attemptId,
      worktreeRoot: spec.worktreeRoot,
      writeScope: spec.writeScope,
      skills: spec.skills ?? [],
      homeDir: this.homeDir,
      mcpEndpoint: lease.endpoint,
      leasedTools: lease.tools,
    });
    const proxy =
      delivery === "proxy" ? await this.proxy.bind({ sessionId, connectionId: spec.connectionId }) : null;
    const scrubbed = scrubChildEnvironment({
      hostEnv: this.hostEnv,
      configDir: workspace.configDir,
      delivery,
      secret: verdict.secret,
      ...(proxy ? { proxyEnv: proxy.env } : {}),
      sandboxTier: sandbox.tier,
      authorizedOverlay: this.overlay,
    });
    const args = buildClaudeArgv({
      commandPrefix: this.commandPrefix,
      maxBudgetUsd,
      mcpConfigPath: workspace.mcpConfigPath,
      systemPromptPath: workspace.systemPromptPath,
      mode,
      ...(spec.resumeSessionId ? { resumeSessionId: spec.resumeSessionId } : {}),
    });
    const plan: ClaudeLaunchPlan = {
      command: this.command,
      args,
      cwd: spec.worktreeRoot,
      env: scrubbed.env,
      configDir: workspace.configDir,
      mcpConfigPath: workspace.mcpConfigPath,
      systemPromptPath: workspace.systemPromptPath,
      maxBudgetUsd,
      mode,
      childEnvHasConsoleKey: scrubbed.childEnvHasConsoleKey,
    };
    this.redactor.register(verdict.secret);
    const record: SessionRecord = {
      spec,
      sessionId,
      attemptId: spec.attemptId,
      mode,
      modelId: spec.modelId ?? "claude-sonnet",
      configDir: workspace.configDir,
      plan,
      sandboxTier: sandbox.tier,
      jobId: job.jobId,
      claudeSessionId: null,
      spendRecorded: false,
    };
    this.sessions.set(sessionId, record);
    this.specs.set(spec.attemptId, spec);
    try {
      const claudeSessionId = await this.transport.start({
        sessionId,
        plan,
        jobId: job.jobId,
        onPermission: (prompt) => this.permissions.decide(prompt, this.policyContext(record)),
      });
      record.claudeSessionId = claudeSessionId;
      this.liveAttempt.set(spec.attemptId, sessionId);
      this.saveCheckpoint(record, "running", []);
      return {
        sessionId,
        attemptId: spec.attemptId,
        claudeSessionId,
        mode,
        maxBudgetUsd,
        configDir: workspace.configDir,
        sandboxTier: sandbox.tier,
      };
    } catch (error) {
      this.sessions.delete(sessionId);
      removeConfigDir(workspace.configDir);
      throw error;
    }
  }

  async sendTurn(sessionId: string, briefOrPrompt: string): Promise<void> {
    const record = this.require(sessionId);
    try {
      const result = await this.transport.sendUserMessage(sessionId, briefOrPrompt);
      const reason = result.subtype === "error_max_budget_usd" ? "error_max_budget_usd" : "result";
      await this.recordSpend(record, reason);
      if (result.subtype === "error_max_budget_usd") {
        this.saveCheckpoint(record, "error_max_budget_usd", BUDGET_STOP_HANDOFF);
      }
    } catch (error) {
      await this.recordSpend(record, "exit");
      this.saveCheckpoint(record, "exit", []);
      throw error;
    }
  }

  async steer(sessionId: string, deltaNote: string): Promise<void> {
    this.require(sessionId);
    if (this.transport.turnInFlight(sessionId)) {
      this.transport.writeSteer(sessionId, deltaNote);
      return;
    }
    await this.sendTurn(sessionId, deltaNote);
  }

  async interrupt(sessionId: string): Promise<{ readonly elapsedMs: number; readonly forced: boolean }> {
    const record = this.require(sessionId);
    const timing = await this.transport.interrupt(sessionId);
    await this.recordSpend(record, "interrupt");
    this.saveCheckpoint(record, "interrupt", []);
    removeConfigDir(record.configDir);
    if (this.liveAttempt.get(record.attemptId) === sessionId) this.liveAttempt.delete(record.attemptId);
    return timing;
  }

  async resume(sessionId: string, checkpointRef: CheckpointRef | string): Promise<ClaudeResumeResult> {
    const ref = typeof checkpointRef === "string" ? { attemptId: checkpointRef } : checkpointRef;
    const known = this.sessions.get(sessionId);
    const attemptId = ref.attemptId || known?.attemptId || "";
    const stored = attemptId ? this.checkpoints.latest(attemptId) : null;
    const claudeSessionId = ref.claudeSessionId ?? stored?.claudeSessionId ?? known?.claudeSessionId ?? "";
    const spec = attemptId ? this.specs.get(attemptId) : undefined;
    if (!claudeSessionId || !spec) return { supported: false, reason: "unsupported_resume" };
    const live = this.liveAttempt.get(attemptId);
    if (live) await this.interrupt(live);
    const handle = await this.startSession({ ...spec, resumeSessionId: claudeSessionId });
    return { supported: true, sessionId: handle.sessionId, claudeSessionId: handle.claudeSessionId };
  }

  events(sessionId: string): AsyncIterable<NormalizedRuntimeEvent> {
    this.require(sessionId);
    return this.bus.stream(sessionId);
  }

  async respondPermission(
    sessionId: string,
    requestId: string,
    decision: ClaudePermissionDecision,
  ): Promise<ClaudePermissionDecision> {
    this.require(sessionId);
    const recorded = this.transport.decision(sessionId, requestId);
    if (!recorded) {
      throw new ClaudeCodeAdapterError("unknown_permission", "No Claude Code permission request with that id");
    }
    if (decision.behavior === "allow" && recorded.behavior === "deny") return recorded;
    return recorded;
  }

  async usage(sessionId: string): Promise<ClaudeUsageReport> {
    const record = this.require(sessionId);
    const tokens = this.transport.usage(sessionId);
    const quote = this.prices.estimateMicroUsd(record.modelId, tokens);
    const providerText = this.transport.providerCostUsd(sessionId);
    const provider = providerText === null ? null : decimalDollarsToMicroUsd(providerText);
    const estimated = quote.priced ? quote.microUsd : null;
    const crossCheck = crossCheckOf(quote.priced, estimated, provider);
    const cost = provider ?? estimated;
    return {
      inputTokens: tokens.inputTokens,
      outputTokens: tokens.outputTokens,
      cacheReadInputTokens: tokens.cacheReadInputTokens,
      cacheCreationInputTokens: tokens.cacheCreationInputTokens,
      cachedInputTokens: tokens.cacheReadInputTokens + tokens.cacheCreationInputTokens,
      reasoningTokens: 0,
      ...(cost !== null ? { costMicroUsd: asNumber(cost) } : {}),
      providerCostMicroUsd: provider === null ? null : asNumber(provider),
      estimatedCostMicroUsd: estimated === null ? null : asNumber(estimated),
      crossCheck,
      partial: !this.transport.hasResult(sessionId),
    };
  }

  sessionDiagnostics(sessionId: string): ClaudeSessionDiagnostics {
    const record = this.require(sessionId);
    return {
      sessionId,
      attemptId: record.attemptId,
      argv: record.plan.args,
      configDir: record.configDir,
      mode: record.mode,
      sandboxTier: record.sandboxTier,
      maxBudgetUsd: record.plan.maxBudgetUsd,
      childEnvHasConsoleKey: record.plan.childEnvHasConsoleKey,
      claudeSessionId: record.claudeSessionId,
      jobId: record.jobId,
      mcpConfigPath: record.plan.mcpConfigPath,
      systemPromptPath: record.plan.systemPromptPath,
    };
  }

  terminate(sessionId: string): ReturnType<ClaudeCodeRuntimeAdapter["interrupt"]> {
    return this.interrupt(sessionId);
  }

  dispose(): Promise<void> {
    return this.close();
  }

  async close(): Promise<void> {
    for (const sessionId of [...this.sessions.keys()]) {
      const record = this.sessions.get(sessionId);
      if (!record) continue;
      try {
        await this.transport.interrupt(sessionId);
      } catch (error) {
        if (!(error instanceof ClaudeCodeAdapterError)) throw error;
      }
      removeConfigDir(record.configDir);
    }
  }

  private policyContext(record: SessionRecord): PolicyContext {
    const appData = this.hostEnv.APPDATA;
    return {
      worktreeRoot: record.spec.worktreeRoot,
      writeScope: record.spec.writeScope,
      homeDir: this.homeDir,
      leasedTools: [...DEFAULT_LEASED_MCP_TOOLS],
      ...(record.spec.readOnlyRoots ? { readOnlyRoots: record.spec.readOnlyRoots } : {}),
      ...(typeof appData === "string" ? { appData } : {}),
    };
  }

  private async recordSpend(record: SessionRecord, reason: SpendReceipt["reason"]): Promise<void> {
    if (record.spendRecorded || !record.claudeSessionId) return;
    const report = await this.usage(record.sessionId);
    const provider =
      report.providerCostMicroUsd === null ? null : BigInt(Math.trunc(report.providerCostMicroUsd));
    const estimated =
      report.estimatedCostMicroUsd === null ? null : BigInt(Math.trunc(report.estimatedCostMicroUsd));
    this.ledger.recordSpend({
      attemptId: record.attemptId,
      sessionId: record.sessionId,
      claudeSessionId: record.claudeSessionId,
      modelId: record.modelId,
      inputTokens: report.inputTokens,
      outputTokens: report.outputTokens,
      cacheReadInputTokens: report.cacheReadInputTokens,
      cacheCreationInputTokens: report.cacheCreationInputTokens,
      providerCostMicroUsd: provider,
      estimatedCostMicroUsd: estimated,
      crossCheck: report.crossCheck,
      reason,
      wipPreserved: true,
    });
    record.spendRecorded = true;
  }

  private saveCheckpoint(
    record: SessionRecord,
    kind: AttemptCheckpoint["kind"],
    handoff: readonly string[],
  ): void {
    if (!record.claudeSessionId) return;
    this.checkpoints.save({
      attemptId: record.attemptId,
      sessionId: record.sessionId,
      claudeSessionId: record.claudeSessionId,
      kind,
      wipPreserved: true,
      handoff,
    });
  }

  private require(sessionId: string): SessionRecord {
    const record = this.sessions.get(sessionId);
    if (!record) throw new ClaudeCodeAdapterError("unknown_session", `Unknown Claude Code session ${sessionId}`);
    return record;
  }

  private async readVersion(): Promise<string | null> {
    const scrubbed = scrubChildEnvironment({
      hostEnv: this.hostEnv,
      configDir: os.tmpdir(),
      delivery: "proxy",
      secret: null,
      sandboxTier: "probe",
      authorizedOverlay: this.overlay,
    });
    const child = this.spawner.spawn(this.command, [...this.commandPrefix, "--version"], {
      cwd: process.cwd(),
      env: scrubbed.env,
    });
    let stdout = "";
    child.stdout?.on("data", (chunk: Buffer | string) => {
      stdout += typeof chunk === "string" ? chunk : chunk.toString("utf8");
    });
    const code = await new Promise<number | null>((resolve) => {
      const timer = setTimeout(() => {
        child.kill("SIGTERM");
        resolve(null);
      }, 5_000);
      child.once("exit", (exitCode) => {
        clearTimeout(timer);
        resolve(exitCode);
      });
    });
    if (code !== 0) return null;
    const match = /(\d+\.\d+\.\d+)/.exec(stdout);
    return match?.[1] ?? null;
  }
}

function crossCheckOf(priced: boolean, estimated: bigint | null, provider: bigint | null): CostCrossCheck {
  if (!priced) return "unpriced";
  if (provider === null || estimated === null) return "estimate_only";
  return provider === estimated ? "match" : "mismatch";
}

function asNumber(value: bigint): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new ClaudeCodeAdapterError("cost_overflow", "micro-USD cost exceeds the safe integer range");
  }
  return Number(value);
}
