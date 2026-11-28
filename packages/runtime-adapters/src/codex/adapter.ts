import { rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { CodexAppServerClient, type ApprovalHandler } from "./app-server.js";
import { CodexAcpFallbackTransport } from "./acp-fallback.js";
import { prepareCodexHome } from "./codex-home.js";
import { CodexAllowanceWindDownError, CodexRuntimeError, isCodexRuntimeError } from "./errors.js";
import { asRecord, asString } from "./jsonrpc.js";
import { isPersonalCodexPath } from "./paths.js";
import { LocalDeterministicSupervisionPolicyEngine } from "./policy.js";
import {
  LocalAllowancePacingController,
  LocalCliMinVersionGate,
  LocalEventBus,
  LocalLabeledWipRebuilder,
  LocalRedactor,
  LocalResumeHandoff,
  LocalSteeringDisposition,
  LocalTierAMxcSandbox,
  LocalWipSnapshot,
  MemoryCheckpointStore,
  type AttemptCheckpointStorePort,
  type CliMinVersionGatePort,
  type DeterministicSupervisionPolicyEnginePort,
  type GenericAcpAdapterPort,
  type LabeledWipRebuilderPort,
  type RedactorPort,
  type ResumeHandoffPort,
  type SiwcTokenRefresherPort,
  type SteeringDispositionPort,
  type TierAMxcSandboxPort,
  type WindowsJobPort,
  type WipSnapshotPort,
} from "./ports.js";
import {
  assertSafeCodexArgs,
  buildCodexEnv,
  LocalWindowsJob,
  nodeSpawn,
  readCommandVersion,
  type ProcessSpawner,
} from "./process.js";
import { CodexRateLimitBridge } from "./rate-limit.js";
import {
  TOKEN_REFRESH_LEAD_MS,
  currencyOf,
  emptyUsage,
  type CodexAuthStatus,
  type CodexConnection,
  type CodexCurrency,
  type CodexProbe,
  type CodexRateLimitSnapshot,
  type CodexSessionHandle,
  type CodexSessionSpec,
  type CodexTransport,
  type CodexUsageReport,
  type NormalizedRuntimeEvent,
  type NormalizedUsage,
  type TurnReceipt,
} from "./types.js";

export interface SteerReceipt {
  readonly kind: "turn" | "fresh";
  readonly label: string | null;
  readonly turn: TurnReceipt | null;
}

export interface ResumeReceipt {
  readonly ok: boolean;
  readonly threadId: string;
  readonly fallback: "native" | "fresh";
  readonly label: string | null;
}

export interface CodexRuntimeAdapterOptions {
  readonly versionGate?: CliMinVersionGatePort;
  readonly minVersion?: string;
  readonly versionCommand?: string;
  readonly versionReader?: () => Promise<string | null>;
  readonly tokenRefresher?: SiwcTokenRefresherPort;
  readonly pacing?: CodexRateLimitBridge;
  readonly policy?: DeterministicSupervisionPolicyEnginePort;
  readonly sandbox?: TierAMxcSandboxPort;
  readonly jobs?: WindowsJobPort;
  readonly checkpoints?: AttemptCheckpointStorePort;
  readonly wip?: WipSnapshotPort;
  readonly resumeHandoff?: ResumeHandoffPort;
  readonly steering?: SteeringDispositionPort;
  readonly freshSession?: LabeledWipRebuilderPort;
  readonly redactor?: RedactorPort;
  readonly spawner?: ProcessSpawner;
  readonly genericAcp?: GenericAcpAdapterPort;
  readonly clock?: () => number;
  readonly userHome?: string;
  readonly codexHomeRoot?: string;
  readonly command?: string;
  readonly appServerArgs?: readonly string[];
  readonly acpCommand?: string;
  readonly acpArgs?: readonly string[];
  readonly transportPreference?: "auto" | CodexTransport;
  readonly loopbackProxy?: string;
  readonly hostEnv?: NodeJS.ProcessEnv;
  readonly interruptGraceMs?: number;
}

interface LiveSession {
  sessionId: string;
  attemptId: string;
  threadId: string | null;
  transport: CodexTransport;
  worktreeRoot: string;
  writeScope: readonly string[];
  brief: string;
  modelId: string;
  connection: CodexConnection;
  codexHome: string;
  currency: CodexCurrency;
  jobId: string;
  client: CodexAppServerClient | null;
  turnActive: boolean;
  interrupting: boolean;
  windDown: boolean;
  activeTurnId: string | null;
  usage: NormalizedUsage;
  rate: CodexRateLimitSnapshot | null;
  step: number;
  mcpEndpoint: string;
  loopbackProxy: string;
  mcpBearer: string;
}

const DEFAULT_PROXY = "http://127.0.0.1:9";
const DEFAULT_MIN_VERSION = "0.42.0";

export class CodexRuntimeAdapter {
  private readonly sessions = new Map<string, LiveSession>();
  private readonly decisions = new Map<string, "allow" | "deny">();
  private readonly versionGate: CliMinVersionGatePort;
  private readonly policy: DeterministicSupervisionPolicyEnginePort;
  private readonly sandbox: TierAMxcSandboxPort;
  private readonly jobs: WindowsJobPort;
  private readonly checkpoints: AttemptCheckpointStorePort;
  private readonly wip: WipSnapshotPort;
  private readonly resumeHandoff: ResumeHandoffPort;
  private readonly steering: SteeringDispositionPort;
  private readonly fresh: LabeledWipRebuilderPort;
  private readonly redactor: RedactorPort;
  private readonly spawner: ProcessSpawner;
  private readonly bridge: CodexRateLimitBridge;
  private readonly acp: GenericAcpAdapterPort;
  private readonly bus = new LocalEventBus();
  private readonly clock: () => number;
  private readonly userHome: string;
  private readonly codexHomeRoot: string;
  private readonly command: string;
  private readonly appServerArgs: readonly string[];
  private readonly acpCommand: string;
  private readonly acpArgs: readonly string[];
  private readonly transportPreference: "auto" | CodexTransport;
  private readonly loopbackProxy: string;
  private readonly hostEnv: NodeJS.ProcessEnv;
  private readonly interruptGraceMs: number;
  private readonly versionReader: () => Promise<string | null>;
  private readonly tokens: SiwcTokenRefresherPort | null;

  constructor(options: CodexRuntimeAdapterOptions = {}) {
    const controller = new LocalAllowancePacingController();
    this.versionGate = options.versionGate ?? new LocalCliMinVersionGate(options.minVersion ?? DEFAULT_MIN_VERSION);
    this.policy = options.policy ?? new LocalDeterministicSupervisionPolicyEngine();
    this.sandbox = options.sandbox ?? new LocalTierAMxcSandbox();
    this.jobs = options.jobs ?? new LocalWindowsJob();
    this.checkpoints = options.checkpoints ?? new MemoryCheckpointStore();
    this.wip = options.wip ?? new LocalWipSnapshot();
    this.resumeHandoff = options.resumeHandoff ?? new LocalResumeHandoff();
    this.steering = options.steering ?? new LocalSteeringDisposition();
    this.fresh = options.freshSession ?? new LocalLabeledWipRebuilder();
    this.redactor = options.redactor ?? new LocalRedactor();
    this.spawner = options.spawner ?? nodeSpawn;
    this.bridge = options.pacing ?? new CodexRateLimitBridge(controller.burn, controller.weights);
    this.clock = options.clock ?? (() => Date.now());
    this.userHome = options.userHome ?? os.homedir();
    this.codexHomeRoot = options.codexHomeRoot ?? path.join(os.tmpdir(), "ef-harness-codex-homes");
    this.command = options.command ?? "codex";
    this.appServerArgs = options.appServerArgs ?? ["app-server"];
    this.acpCommand = options.acpCommand ?? "codex-acp";
    this.acpArgs = options.acpArgs ?? [];
    this.transportPreference = options.transportPreference ?? "auto";
    this.loopbackProxy = options.loopbackProxy ?? DEFAULT_PROXY;
    this.hostEnv = options.hostEnv ?? process.env;
    this.interruptGraceMs = options.interruptGraceMs ?? 200;
    this.tokens = options.tokenRefresher ?? null;
    const versionCommand = options.versionCommand ?? "codex";
    this.versionReader = options.versionReader ?? (async () => readCommandVersion(versionCommand, ["--version"]));
    const sink = {
      publish: (event: NormalizedRuntimeEvent) => {
        this.publish(event);
      },
      now: () => this.clock(),
    };
    this.acp = options.genericAcp ?? new CodexAcpFallbackTransport(this.spawner, sink, this.policy);
  }

  async probe(): Promise<CodexProbe> {
    const installed = await this.versionReader();
    const gate = this.versionGate.evaluate("codex", installed);
    const status = gate.status === "allowed" ? "ready" : gate.status;
    return {
      runtime: "codex",
      status,
      installedVersion: installed,
      requiredVersion: gate.minVersion,
      modes: ["wrapped"],
      transports: ["app-server", "codex-acp"],
    };
  }

  authStatus(): CodexAuthStatus {
    const session = [...this.sessions.values()].at(-1);
    const connection = session?.connection;
    if (!connection) {
      return {
        signedIn: false,
        kind: "unsigned",
        currency: null,
        expiresAtMs: null,
        refreshWithin180s: false,
        readsPersonalCodexHome: false,
      };
    }
    const expiresAtMs = connection.kind === "sign_in_with_chatgpt" ? connection.expiresAtMs : null;
    return {
      signedIn: true,
      kind: connection.kind,
      currency: currencyOf(connection),
      expiresAtMs,
      refreshWithin180s: expiresAtMs !== null && expiresAtMs - this.clock() < TOKEN_REFRESH_LEAD_MS,
      readsPersonalCodexHome: false,
    };
  }

  async startSession(spec: CodexSessionSpec): Promise<CodexSessionHandle> {
    const probe = await this.probe();
    if (probe.status !== "ready") {
      const detail =
        probe.status === "version_too_old"
          ? `codex ${probe.installedVersion ?? "unknown"} is below minimum safe version ${probe.requiredVersion}`
          : "codex is not installed";
      throw new CodexRuntimeError(probe.status, detail);
    }
    this.sealConnection(spec.connection);
    const proxy = spec.loopbackProxy ?? this.loopbackProxy;
    const alignment = this.sandbox.align({ worktreeRoot: spec.worktreeRoot, loopbackProxy: proxy });
    const home = prepareCodexHome({
      codexHomeRoot: this.codexHomeRoot,
      attemptId: spec.attemptId,
      userHome: this.userHome,
      worktreeRoot: spec.worktreeRoot,
      alignment,
      mcpEndpoint: spec.mcpEndpoint,
      skills: spec.skills ?? [],
    });
    const job = this.jobs.create(spec.attemptId);
    const session: LiveSession = {
      sessionId: `codex-${spec.attemptId}`,
      attemptId: spec.attemptId,
      threadId: null,
      transport: "app-server",
      worktreeRoot: spec.worktreeRoot,
      writeScope: spec.writeScope,
      brief: spec.brief,
      modelId: spec.modelId,
      connection: spec.connection,
      codexHome: home.codexHome,
      currency: currencyOf(spec.connection),
      jobId: job.jobId,
      client: null,
      turnActive: false,
      interrupting: false,
      windDown: false,
      activeTurnId: null,
      usage: emptyUsage(),
      rate: null,
      step: 0,
      mcpEndpoint: spec.mcpEndpoint,
      loopbackProxy: proxy,
      mcpBearer: `lease-${spec.attemptId}`,
    };
    const preference = spec.transport ?? this.transportPreference;
    if (preference === "codex-acp") {
      await this.openAcp(session);
    } else {
      try {
        await this.openAppServer(session);
      } catch (error) {
        session.client?.kill();
        session.client = null;
        if (preference !== "auto" || !isProtocolFailure(error)) {
          this.jobs.kill(session.jobId, "start_failed");
          throw error;
        }
        await this.openAcp(session);
      }
    }
    this.sessions.set(session.sessionId, session);
    this.checkpoint(session, null, null);
    if (session.transport === "app-server") await this.readLimits(session, "session_start");
    return this.handle(session);
  }

  async sendTurn(sessionId: string, prompt: string): Promise<TurnReceipt> {
    const session = this.require(sessionId);
    if (session.windDown && session.rate) {
      throw new CodexAllowanceWindDownError(session.rate.primary.usedPpm, session.rate.primary.resetAt);
    }
    await this.refreshIfDue(session);
    if (session.transport === "codex-acp") return this.acpTurn(session, prompt);
    return this.appTurn(session, prompt);
  }

  async steer(sessionId: string, note: string): Promise<SteerReceipt> {
    const session = this.require(sessionId);
    if (this.steering.classify({ note }) === "contradictory") {
      const rebuilt = this.fresh.rebuild({
        attemptId: session.attemptId,
        threadId: session.threadId,
        reason: "contradiction",
        wipTreeSha: null,
      });
      this.checkpoint(session, rebuilt.label, null);
      return { kind: "fresh", label: rebuilt.label, turn: null };
    }
    if (session.transport === "app-server" && session.client && session.threadId) {
      const resumed = await session.client.threadResume(session.threadId);
      if (!resumed.ok) {
        const rebuilt = this.fresh.rebuild({
          attemptId: session.attemptId,
          threadId: session.threadId,
          reason: "resume_failure",
          wipTreeSha: null,
        });
        this.checkpoint(session, rebuilt.label, null);
        return { kind: "fresh", label: rebuilt.label, turn: null };
      }
      session.threadId = resumed.threadId;
    }
    const turn = await this.sendTurn(sessionId, note);
    return { kind: "turn", label: null, turn };
  }

  async interrupt(sessionId: string): Promise<void> {
    const session = this.require(sessionId);
    session.interrupting = true;
    if (session.transport === "codex-acp") {
      await this.acp.interrupt(sessionId);
      return;
    }
    if (!session.client || !session.threadId || !session.activeTurnId) {
      session.client?.kill();
      return;
    }
    try {
      await session.client.turnInterrupt(session.threadId, session.activeTurnId, this.interruptGraceMs);
    } catch (error) {
      if (!isCodexRuntimeError(error)) throw error;
      this.jobs.kill(session.jobId, "interrupt");
      session.client.kill();
    }
  }

  async resume(sessionId: string, checkpointRef: { readonly threadId: string }): Promise<ResumeReceipt> {
    const session = this.require(sessionId);
    if (session.transport === "codex-acp") {
      const loaded = await this.acp.resume(sessionId, checkpointRef.threadId);
      if (!loaded.ok) return this.freshResume(session, checkpointRef.threadId);
      session.threadId = loaded.threadId;
      this.checkpoint(session, null, null);
      return { ok: true, threadId: loaded.threadId, fallback: "native", label: null };
    }
    if (!session.client) throw new CodexRuntimeError("no_client", "codex app-server is not running");
    const loaded = await session.client.threadResume(checkpointRef.threadId);
    if (!loaded.ok) return this.freshResume(session, checkpointRef.threadId);
    session.threadId = loaded.threadId;
    this.checkpoint(session, null, null);
    return { ok: true, threadId: loaded.threadId, fallback: "native", label: null };
  }

  events(sessionId: string): AsyncIterable<NormalizedRuntimeEvent> {
    if (!this.sessions.has(sessionId) && !this.bus.isClosed(sessionId)) {
      throw new CodexRuntimeError("unknown_session", `unknown Codex session ${sessionId}`);
    }
    const bus = this.bus;
    return (async function* events() {
      let index = 0;
      for (;;) {
        const history = bus.history(sessionId);
        while (index < history.length) {
          const event = history[index];
          index += 1;
          if (event) yield event;
        }
        if (bus.isClosed(sessionId)) return;
        await bus.wait(sessionId);
      }
    })();
  }

  takeEvents(sessionId: string): readonly NormalizedRuntimeEvent[] {
    return this.bus.history(sessionId);
  }

  async respondPermission(sessionId: string, requestId: string, decision: "allow" | "deny"): Promise<void> {
    this.require(sessionId);
    const existing = this.decisions.get(requestId);
    if (!existing) throw new CodexRuntimeError("unknown_permission", `unknown permission ${requestId}`);
    if (existing === "deny" && decision === "allow") return;
    this.decisions.set(requestId, decision);
  }

  usage(sessionId: string): Promise<CodexUsageReport> {
    const session = this.require(sessionId);
    if (session.currency === "ppm") {
      return Promise.resolve({
        inputTokens: session.usage.inputTokens,
        cachedInputTokens: session.usage.cachedInputTokens,
        outputTokens: session.usage.outputTokens,
        reasoningTokens: session.usage.reasoningTokens,
        currency: "ppm",
        quotaPpm: session.rate?.primary.usedPpm ?? 0,
      });
    }
    return Promise.resolve({
      inputTokens: session.usage.inputTokens,
      cachedInputTokens: session.usage.cachedInputTokens,
      outputTokens: session.usage.outputTokens,
      reasoningTokens: session.usage.reasoningTokens,
      currency: "micro-USD",
      costMicroUsd: session.usage.inputTokens + session.usage.outputTokens,
    });
  }

  async shutdown(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.client?.kill();
    if (session.transport === "codex-acp") await this.acp.close(sessionId);
    this.jobs.kill(session.jobId, "shutdown");
    this.bus.close(sessionId);
    if (!isPersonalCodexPath(session.codexHome, this.userHome)) {
      rmSync(session.codexHome, { recursive: true, force: true });
    }
    this.sessions.delete(sessionId);
  }

  private async appTurn(session: LiveSession, prompt: string): Promise<TurnReceipt> {
    const client = session.client;
    if (!client || !session.threadId) {
      throw new CodexRuntimeError("no_client", "codex app-server is not running");
    }
    session.turnActive = true;
    session.interrupting = false;
    const threadId = session.threadId;
    this.publish({
      type: "turn_started",
      sessionId: session.sessionId,
      atMs: this.clock(),
      threadId,
    });
    try {
      const turnId = await client.turnStart(threadId, prompt);
      session.activeTurnId = turnId;
      const completed = await client.waitForTurn();
      session.turnActive = false;
      session.usage = addUsage(session.usage, completed.usage);
      this.publish({
        type: "usage_reported",
        sessionId: session.sessionId,
        atMs: this.clock(),
        usage: completed.usage,
        currency: session.currency,
        threadId,
      });
      this.publish({
        type: "turn_completed",
        sessionId: session.sessionId,
        atMs: this.clock(),
        stopReason: completed.status,
        threadId,
      });
      await this.readLimits(session, "turn_completed", completed.usage);
      let refreshed = false;
      if (this.tokenDue(session)) {
        await this.restartForToken(session);
        refreshed = true;
      }
      this.checkpoint(session, null, null);
      return {
        turnId: completed.turnId,
        threadId: session.threadId ?? threadId,
        stopReason: completed.status,
        refreshed,
        resumedThreadId: refreshed ? session.threadId : null,
        exitCode: null,
      };
    } catch (error) {
      session.turnActive = false;
      if (session.interrupting) {
        return {
          turnId: session.activeTurnId ?? "turn",
          threadId,
          stopReason: "interrupted",
          refreshed: false,
          resumedThreadId: null,
          exitCode: null,
        };
      }
      if (isCodexRuntimeError(error) && error.code === "process_exit") {
        this.handoffCrash(session);
        return {
          turnId: session.activeTurnId ?? "turn",
          threadId,
          stopReason: "failed",
          refreshed: false,
          resumedThreadId: null,
          exitCode: 1,
        };
      }
      throw error;
    }
  }

  private async acpTurn(session: LiveSession, prompt: string): Promise<TurnReceipt> {
    const completed = await this.acp.sendTurn(session.sessionId, prompt);
    const usage = await this.acp.usage(session.sessionId);
    session.usage = addUsage(session.usage, usage);
    this.checkpoint(session, null, null);
    return {
      turnId: completed.turnId,
      threadId: session.threadId ?? completed.turnId,
      stopReason: completed.stopReason,
      refreshed: false,
      resumedThreadId: null,
      exitCode: null,
    };
  }

  private async openAppServer(session: LiveSession, resumeThreadId?: string): Promise<void> {
    assertSafeCodexArgs(this.appServerArgs);
    const proc = this.spawner({
      command: this.command,
      args: this.appServerArgs,
      cwd: session.worktreeRoot,
      env: this.envFor(session),
    });
    this.jobs.attach(session.jobId, proc.pid);
    const client = new CodexAppServerClient(
      proc,
      (approval) => this.decideFor(session, approval),
      (method, params) => {
        this.onAppEvent(session, method, params);
      },
    );
    session.client = client;
    session.transport = "app-server";
    try {
      await client.initialize();
    } catch (error) {
      client.kill();
      session.client = null;
      throw error;
    }
    if (resumeThreadId) {
      const resumed = await client.threadResume(resumeThreadId);
      if (!resumed.ok) {
        client.kill();
        session.client = null;
        this.fresh.rebuild({
          attemptId: session.attemptId,
          threadId: resumeThreadId,
          reason: "resume_failure",
          wipTreeSha: null,
        });
        throw new CodexRuntimeError("resume_failure", "thread/resume failed after token refresh");
      }
      session.threadId = resumed.threadId;
      return;
    }
    session.threadId = await client.threadStart({
      cwd: session.worktreeRoot,
      model: session.modelId,
      brief: session.brief,
    });
  }

  private async openAcp(session: LiveSession): Promise<void> {
    assertSafeCodexArgs(this.acpArgs);
    const started = await this.acp.startSession({
      harnessSessionId: session.sessionId,
      command: this.acpCommand,
      args: this.acpArgs,
      cwd: session.worktreeRoot,
      env: this.envFor(session),
      worktreeRoot: session.worktreeRoot,
      writeScope: session.writeScope,
      mcpEndpoint: session.mcpEndpoint,
      brief: session.brief,
    });
    this.jobs.attach(session.jobId, started.pid);
    session.threadId = started.nativeSessionId;
    session.transport = "codex-acp";
    session.client = null;
  }

  private decideFor(session: LiveSession, approval: Parameters<ApprovalHandler>[0]) {
    this.publish({
      type: "permission_requested",
      sessionId: session.sessionId,
      atMs: this.clock(),
      requestId: approval.requestId,
      ...(approval.path ? { path: approval.path } : {}),
      ...(approval.command ? { command: approval.command } : {}),
    });
    const decision = this.policy.decide({
      worktreeRoot: session.worktreeRoot,
      writeScope: session.writeScope,
      request:
        approval.method === "item/commandExecution/requestApproval"
          ? { kind: "shell", command: approval.command ?? "" }
          : { kind: "edit", path: approval.path ?? "" },
    });
    this.decisions.set(approval.requestId, decision.effect);
    this.publish({
      type: "permission_decided",
      sessionId: session.sessionId,
      atMs: this.clock(),
      requestId: approval.requestId,
      decision: decision.effect,
      reason: decision.reason,
      elapsedMs: decision.elapsedMs,
      ...(approval.path ? { path: approval.path } : {}),
      ...(approval.command ? { command: approval.command } : {}),
    });
    return {
      decision: decision.effect === "allow" ? ("accept" as const) : ("decline" as const),
      reason: decision.reason,
      elapsedMs: decision.elapsedMs,
    };
  }

  private onAppEvent(session: LiveSession, method: string, params: unknown): void {
    if (method !== "item/delta") return;
    const text = asString(asRecord(params)?.delta) ?? "";
    this.publish({
      type: "assistant_delta",
      sessionId: session.sessionId,
      atMs: this.clock(),
      text: this.redactor.redact(text),
      ...(session.threadId ? { threadId: session.threadId } : {}),
    });
  }

  private async readLimits(
    session: LiveSession,
    phase: "session_start" | "turn_completed",
    turnUsage: NormalizedUsage = emptyUsage(),
  ): Promise<void> {
    if (!session.client) return;
    const payload = await session.client.readRateLimits();
    const feed = this.bridge.ingest({
      connectionId: session.connection.connectionId,
      modelId: session.modelId,
      payload,
      effectiveTokens: effectiveTokens(turnUsage),
      phase,
    });
    session.rate = feed.snapshot;
    if (feed.windDown) session.windDown = true;
    this.publish({
      type: "rate_limited",
      sessionId: session.sessionId,
      atMs: this.clock(),
      usedPercent: feed.snapshot.primary.usedPercent,
      usedPpm: feed.snapshot.primary.usedPpm,
      resetsAt: feed.snapshot.primary.resetAt,
      windDown: feed.windDown,
      currency: session.currency,
      ...(session.threadId ? { threadId: session.threadId } : {}),
    });
  }

  private async refreshIfDue(session: LiveSession): Promise<void> {
    if (!session.turnActive && this.tokenDue(session)) await this.restartForToken(session);
  }

  private tokenDue(session: LiveSession): boolean {
    if (session.connection.kind !== "sign_in_with_chatgpt") return false;
    return session.connection.expiresAtMs - this.clock() < TOKEN_REFRESH_LEAD_MS;
  }

  private async restartForToken(session: LiveSession): Promise<void> {
    if (session.connection.kind !== "sign_in_with_chatgpt") return;
    const threadId = session.threadId;
    if (!threadId) throw new CodexRuntimeError("missing_thread", "cannot refresh without a threadId");
    if (!this.tokens) {
      throw new CodexRuntimeError("auth_refresh_failed", "SiwcTokenRefresher is not configured");
    }
    this.checkpoint(session, null, null);
    const refreshed = await this.tokens.refresh({ connectionId: session.connection.connectionId });
    this.redactor.seal(refreshed.accessToken);
    session.connection = {
      kind: "sign_in_with_chatgpt",
      connectionId: session.connection.connectionId,
      accessToken: refreshed.accessToken,
      expiresAtMs: refreshed.expiresAtMs,
    };
    session.currency = "ppm";
    session.client?.kill();
    this.jobs.kill(session.jobId, "token_refresh");
    session.client = null;
    await this.openAppServer(session, threadId);
  }

  private handoffCrash(session: LiveSession): void {
    this.jobs.kill(session.jobId, "unexpected_exit");
    const wip = this.wip.capture(session.worktreeRoot);
    this.checkpoint(session, null, wip.wipTreeSha);
    const handoff = this.resumeHandoff.onChildExit({
      attemptId: session.attemptId,
      threadId: session.threadId,
      exitCode: 1,
      wipTreeSha: wip.wipTreeSha,
    });
    if (handoff.action === "fresh_session") {
      this.fresh.rebuild({
        attemptId: session.attemptId,
        threadId: session.threadId,
        reason: "child_exit",
        wipTreeSha: wip.wipTreeSha,
      });
    }
    this.publish({
      type: "session_exited",
      sessionId: session.sessionId,
      atMs: this.clock(),
      exitCode: 1,
      abnormal: true,
      ...(session.threadId ? { threadId: session.threadId } : {}),
    });
  }

  private freshResume(session: LiveSession, threadId: string): ResumeReceipt {
    const rebuilt = this.fresh.rebuild({
      attemptId: session.attemptId,
      threadId,
      reason: "resume_failure",
      wipTreeSha: null,
    });
    this.checkpoint(session, rebuilt.label, null);
    return { ok: false, threadId, fallback: "fresh", label: rebuilt.label };
  }

  private envFor(session: LiveSession): NodeJS.ProcessEnv {
    return buildCodexEnv({
      hostEnv: this.hostEnv,
      codexHome: session.codexHome,
      connection: session.connection,
      proxy: session.loopbackProxy,
      mcpBearer: session.mcpBearer,
    });
  }

  private checkpoint(session: LiveSession, handoff: string | null, wipRef: string | null): void {
    session.step += 1;
    this.checkpoints.upsert({
      attempt: session.attemptId,
      step: session.step,
      wip_ref: wipRef,
      session_ref: session.threadId,
      contract_versions: JSON.stringify({ codex: session.transport, currency: session.currency }),
      pending_effects: "[]",
      handoff_artifact: handoff,
      updated_at: this.clock(),
    });
  }

  private publish(event: NormalizedRuntimeEvent): void {
    if (event.requestId && event.decision) this.decisions.set(event.requestId, event.decision);
    if (event.text === undefined) {
      this.bus.publish(event);
      return;
    }
    this.bus.publish({ ...event, text: this.redactor.redact(event.text) });
  }

  private sealConnection(connection: CodexConnection): void {
    this.redactor.seal(connection.kind === "sign_in_with_chatgpt" ? connection.accessToken : connection.apiKey);
  }

  private handle(session: LiveSession): CodexSessionHandle {
    return {
      sessionId: session.sessionId,
      threadId: session.threadId ?? "",
      transport: session.transport,
      codexHome: session.codexHome,
      currency: session.currency,
    };
  }

  private require(sessionId: string): LiveSession {
    const session = this.sessions.get(sessionId);
    if (!session) throw new CodexRuntimeError("unknown_session", `unknown Codex session ${sessionId}`);
    return session;
  }
}

function addUsage(left: NormalizedUsage, right: NormalizedUsage): NormalizedUsage {
  return {
    inputTokens: left.inputTokens + right.inputTokens,
    cachedInputTokens: left.cachedInputTokens + right.cachedInputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    reasoningTokens: left.reasoningTokens + right.reasoningTokens,
  };
}

function effectiveTokens(usage: NormalizedUsage): number {
  return usage.inputTokens + usage.cachedInputTokens + usage.outputTokens + usage.reasoningTokens;
}

function isProtocolFailure(error: unknown): boolean {
  return isCodexRuntimeError(error) && error.code === "protocol_failed";
}
