import fs from "node:fs";
import { assertAgentRuntimeAdapter } from "../core/interface.js";
import type { PermissionReply } from "../core/types.js";
import { AcpConnection, LocalGenericAcpClient, type AcpSpawnRequest, type JsonRpcRequest } from "./acp-client.js";
import { OpenCodeGenericAcp } from "./generic-acp.js";
import { OsOpenCodeJob } from "./os-ports.js";
import { OpenCodeCompactionController, type CompactionAssessment } from "./compaction-controller.js";
import { OpenCodeConfigGenerator, type GeneratedOpenCodeConfig } from "./config-generator.js";
import { OpenCodeAdapterError } from "./errors.js";
import { isRecord, readString } from "./json.js";
import type { WindowsJobObjectPort } from "./job-object.js";
import { LocalDeterministicSupervisionPolicyEngine, type PolicyDecision } from "./policy-engine.js";
import {
  AllowAllPacing,
  InMemoryBudgetLedger,
  InMemoryCheckpointStore,
  InMemorySandboxSelector,
  PrefixSteeringClassifier,
  type AllowancePacingPort,
  type AttemptCheckpointStorePort,
  type BudgetLedgerPort,
  type SandboxTierSelectorPort,
  type SteeringClassifierPort,
} from "./ports.js";
import { buildOpenCodeChildEnv, redactSecrets } from "./provider-route.js";
import { OpenCodeSkillMounter, type SkillMountResult } from "./skill-mount.js";
import {
  EMPTY_USAGE,
  parseAcpUsageUpdate,
  readCostMicroUsd,
  toReceipt,
} from "./usage.js";
import { probeOpenCodeBinary } from "./version-gate.js";
import {
  DEFAULT_OPENCODE_MIN_VERSION,
  LABELED_WIP_HEADER,
  type AuthStatus,
  type CliVersionPolicy,
  type CommandRunner,
  type ExecutionMode,
  type NormalizedRuntimeEvent,
  type NormalizedUsageReceipt,
  type ProviderConnection,
  type ResumeResult,
  type StartSessionSpec,
  type SteerResult,
  type StoredDecision,
  type UsageTotals,
  type VersionProbe,
} from "./types.js";

export interface CheckpointRef {
  readonly nativeSessionId: string;
  readonly delta: "none" | "additive" | "contradictory";
}

export interface TurnResult {
  readonly stopReason: string;
  readonly compaction: CompactionAssessment;
  readonly usage: NormalizedUsageReceipt;
  readonly sessionId: string;
  readonly turnId: string;
  readonly deliveredPrompt: string;
}

export interface SessionInspection {
  readonly events: readonly NormalizedRuntimeEvent[];
  readonly decisions: readonly StoredDecision[];
  readonly prompts: readonly string[];
  readonly childEnv: Readonly<Record<string, string>>;
  readonly stderr: string;
  readonly configPath: string;
}

export interface OpenCodeRuntimeAdapterOptions {
  readonly binaryPath?: string;
  readonly versionPolicy?: CliVersionPolicy;
  readonly commandRunner?: CommandRunner;
  readonly sandbox?: SandboxTierSelectorPort;
  readonly pacing?: AllowancePacingPort;
  readonly ledger?: BudgetLedgerPort;
  readonly checkpoints?: AttemptCheckpointStorePort;
  readonly jobs?: WindowsJobObjectPort;
  readonly steering?: SteeringClassifierPort;
  readonly hostEnv?: Readonly<Record<string, string | undefined>>;
  readonly connection?: ProviderConnection;
  readonly spawnAcp?: (request: AcpSpawnRequest) => AcpConnection;
}

interface ParsedPermission {
  readonly requestId: string;
  readonly tool: string;
  readonly args: Record<string, unknown>;
  readonly path: string;
  readonly command: string;
  readonly options: readonly { readonly optionId: string; readonly kind: string }[];
}

interface LiveSession {
  readonly spec: StartSessionSpec;
  readonly mode: ExecutionMode;
  readonly connection: AcpConnection;
  readonly version: string;
  readonly config: GeneratedOpenCodeConfig;
  readonly childEnv: Record<string, string>;
  readonly secrets: readonly string[];
  readonly events: NormalizedRuntimeEvent[];
  readonly decisions: StoredDecision[];
  readonly prompts: string[];
  steering: string[];
  usage: UsageTotals;
  lastCostMicroUsd: number;
  readonly repeats: Map<string, number>;
  compaction: CompactionAssessment | null;
  interrupted: boolean;
  settled: boolean;
  wake: (() => void) | null;
  skills: SkillMountResult | null;
  loadSession: boolean;
  nativeSessionId: string;
}

function readStopReason(result: unknown): string {
  if (isRecord(result) && typeof result.stopReason === "string") return result.stopReason;
  return "end_turn";
}

function permissionArgs(raw: unknown): Record<string, unknown> {
  return isRecord(raw) ? raw : {};
}

function parsePermission(params: unknown): ParsedPermission {
  const record = isRecord(params) ? params : {};
  const toolCall = isRecord(record.toolCall) ? record.toolCall : record;
  const rawInput = permissionArgs(toolCall.rawInput ?? record.rawInput);
  const requestId = readString(toolCall.toolCallId) ?? readString(record.requestId) ?? "permission";
  const tool =
    readString(rawInput.tool) ??
    readString(toolCall.title) ??
    readString(toolCall.kind) ??
    "unknown";
  const optionsRaw = Array.isArray(record.options) ? record.options : [];
  const options = optionsRaw.flatMap((option) => {
    if (!isRecord(option) || typeof option.optionId !== "string") return [];
    return [{ optionId: option.optionId, kind: typeof option.kind === "string" ? option.kind : "" }];
  });
  return {
    requestId,
    tool,
    args: rawInput,
    path: readString(rawInput.path) ?? readString(rawInput.file) ?? "",
    command: readString(rawInput.command) ?? "",
    options,
  };
}

function acpPermissionResult(decision: PolicyDecision, options: ParsedPermission["options"]): unknown {
  const wanted = decision.acpOutcome;
  const match =
    options.find((option) => option.kind === wanted) ??
    options.find((option) => option.optionId === (decision.decision === "allow" ? "allow" : "reject"));
  const optionId = match?.optionId ?? (decision.decision === "allow" ? "allow" : "reject");
  return { outcome: { outcome: "selected", optionId } };
}

export class OpenCodeRuntimeAdapter {
  readonly runtime = "opencode" as const;
  private readonly binaryPath: string;
  private readonly versionPolicy: CliVersionPolicy;
  private readonly commandRunner: CommandRunner | undefined;
  private readonly sandbox: SandboxTierSelectorPort;
  private readonly pacing: AllowancePacingPort;
  private readonly ledger: BudgetLedgerPort;
  private readonly checkpoints: AttemptCheckpointStorePort;
  private readonly jobs: WindowsJobObjectPort;
  private readonly steering: SteeringClassifierPort;
  private readonly hostEnv: Readonly<Record<string, string | undefined>>;
  private readonly spawnAcp: ((request: AcpSpawnRequest) => AcpConnection) | undefined;
  private readonly acp = new LocalGenericAcpClient();
  private readonly genericAcp = new OpenCodeGenericAcp();
  private readonly generator = new OpenCodeConfigGenerator();
  private readonly skillMounter = new OpenCodeSkillMounter();
  private readonly policy = new LocalDeterministicSupervisionPolicyEngine();
  private readonly compactionController = new OpenCodeCompactionController();
  private readonly sessions = new Map<string, LiveSession>();
  private readonly connection: ProviderConnection | undefined;

  constructor(options: OpenCodeRuntimeAdapterOptions = {}) {
    this.binaryPath = options.binaryPath ?? "opencode";
    this.versionPolicy = options.versionPolicy ?? { minVersion: DEFAULT_OPENCODE_MIN_VERSION, denylist: [] };
    this.commandRunner = options.commandRunner;
    this.sandbox = options.sandbox ?? new InMemorySandboxSelector();
    this.pacing = options.pacing ?? new AllowAllPacing();
    this.ledger = options.ledger ?? new InMemoryBudgetLedger();
    this.checkpoints = options.checkpoints ?? new InMemoryCheckpointStore();
    this.jobs = options.jobs ?? new OsOpenCodeJob();
    assertAgentRuntimeAdapter(this);
    this.steering = options.steering ?? new PrefixSteeringClassifier();
    this.hostEnv = options.hostEnv ?? process.env;
    this.spawnAcp = options.spawnAcp;
    this.connection = options.connection;
  }

  async probe(): Promise<VersionProbe & {
    readonly runtime: "opencode";
    readonly status: "ready" | "missing" | "version_too_old" | "non_compliant";
    readonly compliant: boolean;
    readonly complianceReason: string;
    readonly minVersion: string | null;
    readonly gateReason: "ok" | "missing" | "below_minimum" | "unknown_runtime";
    readonly modes: readonly ("wrapped" | "stripped")[];
    readonly launchCodingTasks: boolean;
  }> {
    const probed = probeOpenCodeBinary(this.binaryPath, this.versionPolicy, this.commandRunner);
    const status = probed.trust === "conformance_verified" ? "ready" : probed.installed ? "version_too_old" : "missing";
    return {
      ...probed,
      runtime: "opencode",
      status,
      compliant: probed.trust === "conformance_verified",
      complianceReason: probed.message,
      minVersion: this.versionPolicy.minVersion,
      gateReason: !probed.installed ? "missing" : status === "ready" ? "ok" : "below_minimum",
      modes: ["wrapped", "stripped"],
      launchCodingTasks: status === "ready",
    };
  }

  async authStatus(): Promise<AuthStatus & {
    readonly expiresAt: null;
    readonly quota: null;
    readonly source: "injected" | "none";
  }> {
    if (!this.connection) {
      return {
        runtime: "opencode",
        signedIn: false,
        provider: null,
        scrapedHomeDirectory: false,
        destructive: false,
        expiresAt: null,
        quota: null,
        source: "none",
      };
    }
    return {
      runtime: "opencode",
      signedIn: true,
      provider: this.connection.provider,
      scrapedHomeDirectory: false,
      destructive: false,
      expiresAt: null,
      quota: null,
      source: "injected",
    };
  }

  async startSession(spec: StartSessionSpec): Promise<{
    readonly sessionId: string;
    readonly attemptId: string;
    readonly mode: ExecutionMode;
    readonly trust: "conformance_verified";
    readonly configPath: string;
    readonly runtime: "opencode";
    readonly modeReason: ExecutionMode;
    readonly jobId: string;
    readonly sandboxTier: "A" | "B" | "C" | "D";
    readonly proxyEndpoint: string;
    readonly mcpLeaseId: string;
    readonly mcpEndpoint: string;
    readonly mcpTools: readonly string[];
    readonly pid: number;
    readonly nativeFileTools: boolean;
    readonly nativeShell: false;
    readonly nativeWeb: false;
    readonly environment: Readonly<Record<string, string>>;
  }> {
    const probed = await this.probe();
    if (probed.trust !== "conformance_verified" || !probed.version) {
      throw new OpenCodeAdapterError("version_blocked", probed.message);
    }
    const mode = spec.mode ?? "wrapped";
    const sandbox = this.sandbox.select({ taskId: spec.taskId, mode });
    if (sandbox.hold) {
      throw new OpenCodeAdapterError("sandbox_hold", sandbox.reason);
    }
    this.policy.warm(spec.worktreePath);
    const generated = this.generator.generate({
      configDir: spec.configDir,
      worktreePath: spec.worktreePath,
      mode,
      connection: spec.connection,
      mcp: spec.mcp,
      ...(spec.userConfig !== undefined ? { userConfig: spec.userConfig } : {}),
      ...(spec.repoConfig !== undefined ? { repoConfig: spec.repoConfig } : {}),
      ...(spec.preservePaths !== undefined ? { preservePaths: spec.preservePaths } : {}),
    });
    let mounted: SkillMountResult | null = null;
    let connection: AcpConnection | null = null;
    try {
      mounted = this.skillMounter.mount({
        worktreePath: spec.worktreePath,
        configDir: spec.configDir,
        skills: spec.skills ?? [],
      });
      const childEnv = buildOpenCodeChildEnv({
        hostEnv: this.hostEnv,
        configPath: generated.configPath,
        configDir: generated.configDir,
        providerEnv: generated.providerEnv,
      });
      connection = this.openProcess({
        binaryPath: this.binaryPath,
        env: childEnv,
        cwd: spec.worktreePath,
      });
      const session = this.bindSession({
        spec,
        mode,
        connection,
        version: probed.version,
        config: generated,
        childEnv,
        skills: mounted,
      });
      if (connection.pid !== undefined) this.jobs.attach(session.nativeSessionId, connection.pid);
      const initialized = await connection.request("initialize", {
        protocolVersion: 1,
        clientCapabilities: {
          fs: { readTextFile: true, writeTextFile: true },
          terminal: true,
        },
        clientInfo: { name: "ef-harness", version: "0.0.0" },
      });
      session.loadSession = isRecord(initialized) && isRecord(initialized.agentCapabilities)
        ? initialized.agentCapabilities.loadSession !== false
        : true;
      const created = await connection.request("session/new", {
        cwd: spec.worktreePath,
        mcpServers: [
          {
            name: "ef-harness",
            type: "http",
            url: spec.mcp.url,
            headers: [{ name: "Authorization", value: `Bearer ${spec.mcp.bearerToken}` }],
          },
        ],
      });
      const nativeSessionId = isRecord(created) && typeof created.sessionId === "string" ? created.sessionId : "";
      if (!nativeSessionId) {
        throw new OpenCodeAdapterError("protocol", "opencode acp did not return a sessionId");
      }
      if (this.sessions.has(nativeSessionId)) {
        throw new OpenCodeAdapterError("session_exists", "session id is already live");
      }
      session.nativeSessionId = nativeSessionId;
      if (connection.pid !== undefined) this.jobs.attach(nativeSessionId, connection.pid);
      this.sessions.set(nativeSessionId, session);
      this.checkpoints.save({
        attemptId: spec.attemptId,
        adapterId: "opencode",
        adapterVersion: probed.version,
        nativeSessionId,
        pinnedBaseCommitSha: spec.pinnedBaseCommitSha,
        mustChecklist: spec.mustChecklist,
        writeScope: spec.writeScope,
        lastStepSummary: "session_started",
      });
      return {
        sessionId: nativeSessionId,
        attemptId: spec.attemptId,
        mode,
        trust: "conformance_verified" as const,
        configPath: generated.configPath,
        runtime: "opencode" as const,
        modeReason: mode,
        jobId: nativeSessionId,
        sandboxTier: sandbox.tier,
        proxyEndpoint: spec.mcp.url,
        mcpLeaseId: spec.attemptId,
        mcpEndpoint: spec.mcp.url,
        mcpTools: ["kb.*", "harness.run", "harness.read_result"] as const,
        pid: connection.pid ?? 0,
        nativeFileTools: mode === "wrapped",
        nativeShell: false,
        nativeWeb: false,
        environment: childEnv,
      };
    } catch (error) {
      connection?.close();
      if (mounted) this.skillMounter.cleanup(mounted);
      fs.rmSync(generated.configPath, { force: true });
      throw error;
    }
  }

  async sendTurn(sessionId: string, briefOrPrompt: string): Promise<TurnResult> {
    const session = this.require(sessionId);
    const pacing = this.pacing.mayStartTurn(session.spec.connection.connectionId);
    if (!pacing.allowed) {
      throw new OpenCodeAdapterError("pacing_blocked", pacing.reason);
    }
    const prompt = this.composePrompt(session, briefOrPrompt);
    session.prompts.push(prompt);
    session.interrupted = false;
    this.push(session, { type: "turn_started", sessionId });
    const result = await session.connection.request(
      "session/prompt",
      { sessionId, prompt: [{ type: "text", text: prompt }] },
      15_000,
    );
    const stopReason = readStopReason(result);
    const compaction = this.compactionController.assess({
      usage: session.usage,
      contextCeilingTokens: session.spec.contextCeilingTokens,
      mustChecklist: session.spec.mustChecklist,
      writeScope: session.spec.writeScope,
      brief: session.spec.brief,
      transcript: this.transcript(session),
    });
    session.compaction = compaction;
    const usage = this.receipt(session);
    this.push(session, { type: "turn_completed", sessionId, stopReason });
    this.checkpoints.save({
      attemptId: session.spec.attemptId,
      adapterId: "opencode",
      adapterVersion: session.version,
      nativeSessionId: sessionId,
      pinnedBaseCommitSha: session.spec.pinnedBaseCommitSha,
      mustChecklist: session.spec.mustChecklist,
      writeScope: session.spec.writeScope,
      lastStepSummary: stopReason,
    });
    return {
      stopReason,
      compaction,
      usage,
      sessionId,
      turnId: `${sessionId}:${session.prompts.length}`,
      deliveredPrompt: prompt,
    };
  }

  steer(sessionId: string, deltaNote: string): SteerResult {
    const session = this.require(sessionId);
    if (this.steering.classify(deltaNote) === "contradictory") {
      return {
        accepted: false,
        queued: false,
        reason: "contradictory",
        fallback: "fresh_session_labeled_wip",
        labeledWip: this.labeledWip(session),
      };
    }
    session.steering.push(deltaNote);
    return {
      accepted: true,
      queued: true,
      reason: "additive",
      fallback: "none",
      labeledWip: "",
    };
  }

  async interrupt(sessionId: string): Promise<{
    readonly sessionId: string;
    readonly denied: readonly { readonly requestId: string; readonly reason: string }[];
    readonly killedPids: readonly number[];
    readonly elapsedMs: number;
  }> {
    const session = this.require(sessionId);
    session.interrupted = true;
    let timedOut = false;
    const cancel = session.connection.request("session/cancel", { sessionId }, 500);
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        timedOut = true;
        resolve();
      }, 500);
      cancel.then(
        () => {
          clearTimeout(timer);
          resolve();
        },
        () => {
          clearTimeout(timer);
          resolve();
        },
      );
    });
    const killed = timedOut ? await this.jobs.terminateTree(sessionId) : { killedPids: [] as readonly number[] };
    return { sessionId, denied: [], killedPids: killed.killedPids, elapsedMs: 0 };
  }

  async resume(sessionId: string, checkpointRef: CheckpointRef | string): Promise<ResumeResult> {
    const ref = typeof checkpointRef === "string" ? { nativeSessionId: checkpointRef, delta: "none" as const } : checkpointRef;
    const session = this.require(sessionId);
    if (ref.delta === "contradictory") {
      return this.freshSession(session, "contradictory");
    }
    if (!session.loadSession) {
      return this.freshSession(session, "load_unsupported");
    }
    try {
      await session.connection.request("session/load", {
        sessionId: ref.nativeSessionId,
        cwd: session.spec.worktreePath,
      });
      return {
        supported: true,
        sessionId: ref.nativeSessionId,
        fallback: "none",
        reason: "loaded",
        labeledWip: "",
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "load_failed";
      return this.freshSession(session, message);
    }
  }

  async *events(sessionId: string): AsyncIterable<NormalizedRuntimeEvent> {
    const session = this.require(sessionId);
    let index = 0;
    while (true) {
      if (index < session.events.length) {
        const event = session.events[index];
        index += 1;
        if (event) yield event;
        continue;
      }
      if (session.settled) return;
      await new Promise<void>((resolve) => {
        if (index < session.events.length || session.settled) {
          resolve();
          return;
        }
        session.wake = resolve;
      });
    }
  }

  async respondPermission(
    sessionId: string,
    requestId: string,
    decision: "allow" | "deny" | PermissionReply,
  ): Promise<StoredDecision & PermissionReply> {
    const effect = typeof decision === "string" ? decision : decision.effect;
    const session = this.require(sessionId);
    const stored = session.decisions.find((item) => item.requestId === requestId);
    if (!stored) {
      throw new OpenCodeAdapterError("permission", "unknown permission request");
    }
    if (effect === "allow" && stored.decision === "deny") return { ...stored, effect: stored.decision };
    if (effect === "deny" && stored.decision === "allow") {
      return { ...stored, decision: "deny", acpOutcome: "reject_once", reason: stored.reason, effect: "deny" };
    }
    return { ...stored, effect: stored.decision };
  }

  async usage(sessionId: string): Promise<NormalizedUsageReceipt & {
    readonly cachedInputTokens: number;
    readonly cacheReadInputTokens: number;
    readonly cacheCreationInputTokens: number;
  }> {
    const receipt = this.receipt(this.require(sessionId));
    return {
      ...receipt,
      cachedInputTokens: receipt.cacheReadTokens,
      cacheReadInputTokens: receipt.cacheReadTokens,
      cacheCreationInputTokens: receipt.cacheWriteTokens,
    };
  }

  async terminate(sessionId: string): Promise<{
    readonly sessionId: string;
    readonly denied: readonly [];
    readonly killedPids: readonly number[];
    readonly elapsedMs: number;
  }> {
    const closed = await this.closeSession(sessionId);
    return { sessionId, denied: [], killedPids: closed.leakedPids, elapsedMs: 0 };
  }

  async dispose(): Promise<void> {
    await this.genericAcp.adapter.dispose();
    for (const sessionId of [...this.sessions.keys()]) {
      try {
        await this.closeSession(sessionId);
      } catch {
        /* a session that already exited still leaves the map */
      }
    }
  }

  inspect(sessionId: string): SessionInspection {
    const session = this.require(sessionId);
    return {
      events: [...session.events],
      decisions: [...session.decisions],
      prompts: [...session.prompts],
      childEnv: { ...session.childEnv },
      stderr: redactSecrets(session.connection.stderr, session.secrets),
      configPath: session.config.configPath,
    };
  }

  trackDescendant(sessionId: string, pid: number): void {
    this.require(sessionId);
    this.jobs.attach(sessionId, pid);
  }

  async closeSession(sessionId: string): Promise<{ readonly leakedPids: readonly number[] }> {
    const session = this.require(sessionId);
    try {
      await session.connection.request("session/cancel", { sessionId }, 500);
    } catch {
      /* the child may already have exited */
    }
    session.connection.close();
    const job = await this.jobs.terminateTree(sessionId);
    if (session.skills) this.skillMounter.cleanup(session.skills);
    fs.rmSync(session.config.configPath, { force: true });
    session.settled = true;
    this.push(session, { type: "session_exited", sessionId, exitCode: job.leakedPids.length === 0 ? 0 : 1 });
    this.sessions.delete(sessionId);
    if (job.leakedPids.length > 0) {
      throw new OpenCodeAdapterError("orphan_process", "OpenCode left surviving child processes");
    }
    return { leakedPids: job.leakedPids };
  }

  private openProcess(request: AcpSpawnRequest): AcpConnection {
    if (this.spawnAcp) return this.spawnAcp(request);
    return this.acp.spawn(request);
  }

  private bindSession(input: {
    readonly spec: StartSessionSpec;
    readonly mode: ExecutionMode;
    readonly connection: AcpConnection;
    readonly version: string;
    readonly config: GeneratedOpenCodeConfig;
    readonly childEnv: Record<string, string>;
    readonly skills: SkillMountResult | null;
  }): LiveSession {
    const secrets = [input.spec.mcp.bearerToken];
    if (input.spec.connection.apiKey) secrets.push(input.spec.connection.apiKey);
    const session: LiveSession = {
      spec: input.spec,
      mode: input.mode,
      connection: input.connection,
      version: input.version,
      config: input.config,
      childEnv: input.childEnv,
      secrets,
      events: [],
      decisions: [],
      prompts: [],
      steering: [],
      usage: { ...EMPTY_USAGE },
      lastCostMicroUsd: 0,
      repeats: new Map(),
      compaction: null,
      interrupted: false,
      settled: false,
      wake: null,
      skills: input.skills,
      loadSession: true,
      nativeSessionId: input.spec.attemptId,
    };
    input.connection.onAgentRequest((request) => this.onAgentRequest(session, request));
    input.connection.onNotification((method, params) => {
      this.onNotification(session, method, params);
    });
    input.connection.onProtocolError((error) => {
      this.push(session, { type: "session_error", sessionId: session.nativeSessionId, message: error.message });
    });
    if (input.connection.pid !== undefined) {
      this.jobs.attach(input.spec.attemptId, input.connection.pid);
    }
    return session;
  }

  private async onAgentRequest(session: LiveSession, request: JsonRpcRequest): Promise<unknown> {
    if (request.method !== "session/request_permission") {
      return { outcome: { outcome: "cancelled" } };
    }
    if (session.interrupted) {
      return { outcome: { outcome: "cancelled" } };
    }
    const parsed = parsePermission(request.params);
    const fingerprint = `${parsed.tool}\n${parsed.command}\n${parsed.path}`;
    const repeatCount = (session.repeats.get(fingerprint) ?? 0) + 1;
    session.repeats.set(fingerprint, repeatCount);
    const decision = this.policy.decide({
      worktreePath: session.spec.worktreePath,
      writeScope: session.spec.writeScope,
      tool: parsed.tool,
      args: parsed.args,
      repeatCount,
    });
    const stored: StoredDecision = {
      requestId: parsed.requestId,
      tool: parsed.tool,
      decision: decision.decision,
      acpOutcome: decision.acpOutcome,
      reason: decision.reason,
      elapsedMs: decision.elapsedMs,
    };
    session.decisions.push(stored);
    const sessionId = session.nativeSessionId;
    this.push(session, { type: "permission_requested", sessionId, requestId: parsed.requestId, tool: parsed.tool });
    this.push(session, {
      type: "permission_decided",
      sessionId,
      requestId: parsed.requestId,
      decision: decision.decision,
      reason: decision.reason,
    });
    this.push(session, { type: "tool_call_requested", sessionId, requestId: parsed.requestId, tool: parsed.tool });
    if (decision.decision === "allow") {
      this.push(session, { type: "tool_call_started", sessionId, requestId: parsed.requestId, tool: parsed.tool });
      if ((parsed.tool === "edit" || parsed.tool === "write") && parsed.path) {
        this.push(session, { type: "file_edited", sessionId, paths: [parsed.path] });
      }
      this.push(session, { type: "tool_call_finished", sessionId, requestId: parsed.requestId, tool: parsed.tool });
    }
    return acpPermissionResult(decision, parsed.options);
  }

  private onNotification(session: LiveSession, method: string, params: unknown): void {
    if (method !== "session/update") return;
    const record = isRecord(params) ? params : {};
    const update = isRecord(record.update) ? record.update : record;
    const usage = parseAcpUsageUpdate(update);
    if (usage) {
      session.usage = usage;
      session.lastCostMicroUsd = readCostMicroUsd(update, session.spec.connection.provider);
      const receipt = this.receipt(session);
      this.ledger.record(receipt);
      this.push(session, { type: "usage_reported", sessionId: session.nativeSessionId, usage: receipt });
    }
    if (update.sessionUpdate === "agent_message_chunk") {
      const content = isRecord(update.content) ? update.content : {};
      const text = readString(content.text) ?? "";
      if (text) {
        this.push(session, { type: "assistant_delta", sessionId: session.nativeSessionId, text });
      }
    }
  }

  private composePrompt(session: LiveSession, text: string): string {
    const parts: string[] = [];
    if (session.compaction?.action === "pinned_compaction") {
      parts.push(session.compaction.compactedBrief);
    }
    parts.push(text);
    if (session.steering.length > 0) {
      parts.push(session.steering.map((note) => `STEERING: ${note}`).join("\n"));
      session.steering = [];
    }
    return parts.join("\n\n");
  }

  private transcript(session: LiveSession): string {
    const lines: string[] = [];
    for (const event of session.events) {
      if (event.type === "assistant_delta") lines.push(event.text);
    }
    return lines.join("\n");
  }

  private receipt(session: LiveSession): NormalizedUsageReceipt {
    return toReceipt({
      attemptId: session.spec.attemptId,
      connectionId: session.spec.connection.connectionId,
      provider: session.spec.connection.provider,
      usage: session.usage,
      costMicroUsd: session.lastCostMicroUsd,
    });
  }

  private labeledWip(session: LiveSession): string {
    return `${LABELED_WIP_HEADER}\n${session.spec.writeScope.join("\n")}`;
  }

  private freshSession(session: LiveSession, reason: string): ResumeResult {
    return {
      supported: false,
      sessionId: null,
      fallback: "fresh_session_labeled_wip",
      reason,
      labeledWip: this.labeledWip(session),
    };
  }

  private push(session: LiveSession, event: NormalizedRuntimeEvent): void {
    session.events.push(event);
    const wake = session.wake;
    session.wake = null;
    wake?.();
  }

  private require(sessionId: string): LiveSession {
    const session = this.sessions.get(sessionId);
    if (!session) throw new OpenCodeAdapterError("session_not_found", `unknown session ${sessionId}`);
    return session;
  }
}
