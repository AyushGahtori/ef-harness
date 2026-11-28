import path from "node:path";
import { openCursorAcp } from "./acp-launch.js";
import {
  AGENT_RUNTIME_ADAPTER_METHODS,
  CONFORMANCE_CHECKS,
  CURSOR_KEY_EXPIRED_ACCOUNT_CARD,
  CURSOR_LOGIN_ACTION,
  DEFAULT_LEASED_MCP_TOOLS,
  INTERRUPT_BUDGET_MS,
} from "./constants.js";
import { CursorAdapterError, isUnauthorizedError } from "./errors.js";
import { CursorUsageAndHookController } from "./hooks.js";
import { cleanupEphemeralMounts, createGuardedIo, mountVettedSkills, prepareIsolatedCursorHome } from "./isolation.js";
import type { WorktreeIo } from "./isolation.js";
import type { OpenCursorAgent, StoredPermission } from "./ports.js";
import type { CursorRuntimeDeps } from "./ports.js";
import { assertSandboxTier, buildSandboxOptions } from "./sandbox-options.js";
import { openCursorSdk } from "./sdk-launch.js";
import type {
  AgentRuntimeAdapter,
  BeforeShellInput,
  CursorAuthStatus,
  CursorCheckpointRecord,
  CursorCheckpointRef,
  CursorInterruptReceipt,
  CursorLaunchRecord,
  CursorProbeResult,
  CursorQuotaSnapshot,
  CursorResumeResult,
  CursorSessionRef,
  CursorSessionSpec,
  CursorSteerReceipt,
  CursorTransportKind,
  CursorTurnReceipt,
  CursorVendorEvent,
  ExecutionMode,
  FileToolKind,
  HookDecision,
  NormalizedRuntimeEvent,
  NormalizedUsage,
  PermissionApplyResult,
  PermissionDecision,
  PreToolUseInput,
} from "./types.js";
import { emptyUsage, shouldPauseForOnDemand } from "./usage.js";

interface CursorSession {
  readonly sessionId: string;
  readonly attemptId: string;
  readonly connectionId: string;
  readonly worktree: string;
  readonly brief: string;
  briefVersion: string;
  readonly mode: ExecutionMode;
  readonly transportKind: CursorTransportKind;
  readonly controller: CursorUsageAndHookController;
  readonly io: WorktreeIo;
  agent: OpenCursorAgent | null;
  jobId: string;
  launch: CursorLaunchRecord | null;
  abort: AbortController;
  apiKey: string;
  wipDiff: string;
  steeringNotes: string[];
  events: NormalizedRuntimeEvent[];
  eventsClosed: boolean;
  wake: (() => void) | null;
  turn: number;
  lastUsage: NormalizedUsage;
  pausedForOnDemand: boolean;
  onDemandNotified: boolean;
  authParked: boolean;
  aborted: boolean;
  requestSeq: number;
  resumeCount: number;
  readonly permissions: Map<string, StoredPermission>;
}

export class SupervisedCursorRuntime implements AgentRuntimeAdapter {
  private readonly sessions = new Map<string, CursorSession>();
  private readonly parkedConnections = new Set<string>();

  constructor(
    protected readonly deps: CursorRuntimeDeps,
    private readonly kind: CursorTransportKind,
  ) {}

  hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  describeLaunch(sessionId: string): CursorLaunchRecord {
    return this.require(sessionId).launch ?? missingLaunch();
  }

  readCheckpoint(sessionId: string): Promise<CursorCheckpointRecord | null> {
    return this.deps.checkpoints.load(sessionId);
  }

  methods(): readonly string[] {
    return AGENT_RUNTIME_ADAPTER_METHODS;
  }

  async probe(): Promise<CursorProbeResult> {
    const availability =
      this.kind === "sdk"
        ? await this.deps.sdk.available()
        : await this.deps.acp.probe("cursor-agent");
    const version = availability.version;
    const gate = this.deps.cliGate.evaluate(this.kind === "sdk" ? "@cursor/sdk" : "cursor-agent", version);
    const versionStatus = !availability.installed || !version
      ? "missing"
      : gate.reason === "below_minimum"
        ? "version_too_old"
        : "ok";
    const verified = versionStatus === "ok" && this.deps.conformance.verified(version);
    return {
      runtime: "cursor",
      installed: availability.installed,
      version,
      versionStatus,
      requiredVersion: gate.minVersion,
      modes: ["wrapped", "stripped"],
      transport: this.kind,
      trust: verified ? "conformance_verified" : versionStatus === "ok" ? "observe_only" : "disabled",
      liveBuildsEnabled: verified,
      conformanceChecks: CONFORMANCE_CHECKS,
    };
  }

  async authStatus(connectionId?: string): Promise<CursorAuthStatus> {
    if (!connectionId) {
      throw new CursorAdapterError("connection_required", "Cursor authStatus requires a connection id");
    }
    const snapshot = await this.deps.expiry.inspect(connectionId, this.deps.clock());
    const status = snapshot.expired && snapshot.status === "active" ? "expired" : snapshot.status;
    return {
      signedIn: status === "active",
      status,
      connectionId,
      expiresAt: snapshot.expiresAt,
      readsPersonalCursorHome: false,
    };
  }

  async startSession(spec: CursorSessionSpec): Promise<CursorSessionRef> {
    const mode = spec.mode ?? "wrapped";
    const probed = await this.probe();
    if (probed.versionStatus !== "ok") {
      throw new CursorAdapterError(
        probed.versionStatus,
        `Update cursor-agent to >= ${probed.requiredVersion ?? "the signed minimum"} before launching`,
      );
    }
    if ((spec.purpose ?? "live_build") === "live_build" && !probed.liveBuildsEnabled) {
      throw new CursorAdapterError(
        "conformance_required",
        "Task 151 must validate preToolUse, beforeShellExecution, and local.sandboxOptions before enabling this cursor-agent version",
      );
    }
    const expiry = await this.deps.expiry.inspect(spec.connectionId, this.deps.clock());
    if (expiry.expired || expiry.status === "expired" || expiry.status === "unauthorized") {
      await this.parkDetached(spec.connectionId, expiry.status === "unauthorized" ? "unauthorized" : "expired");
      throw new CursorAdapterError("auth_expired", CURSOR_KEY_EXPIRED_ACCOUNT_CARD);
    }
    const apiKey = await this.deps.keys.readUserApiKey(spec.connectionId);
    if (!apiKey) throw new CursorAdapterError("signed_out", "Cursor is not signed in");
    this.deps.redactor.register(apiKey);

    const tier = await this.deps.sandbox.selectTier({
      runtime: "cursor",
      worktreeRoot: spec.worktree,
      requestedMode: mode,
    });
    assertSandboxTier(tier.tier, tier.hold, tier.reason);
    const sessionId = `cursor-${spec.attemptId}`;
    if (this.sessions.has(sessionId)) {
      throw new CursorAdapterError("session_exists", `Cursor session ${sessionId} already exists`);
    }
    const proxy = await this.deps.proxy.bind({ sessionId, tier: tier.tier });
    const lease = await this.deps.mcp.lease({ sessionId, tools: [...DEFAULT_LEASED_MCP_TOOLS] });
    const job = this.deps.jobs.create(sessionId);
    const io = this.deps.io ?? createGuardedIo(this.deps.personalCursorHome);
    const isolated = prepareIsolatedCursorHome({
      worktree: spec.worktree,
      personalCursorHome: this.deps.personalCursorHome,
      io,
    });
    mountVettedSkills({
      worktree: spec.worktree,
      skillsDir: isolated.skillsDir,
      skills: spec.skills ?? [],
      io,
    });
    const sandboxOptions = buildSandboxOptions({
      worktree: spec.worktree,
      proxyUrl: proxy.endpoint,
      mcpServers: [
        {
          name: "ef-harness",
          url: lease.endpoint,
          tools: lease.tools,
          bearerRef: lease.leaseId,
        },
      ],
    });
    const controller = new CursorUsageAndHookController({
      worktree: path.resolve(spec.worktree),
      writeScope: spec.writeScope,
      mode,
      leasedTools: lease.tools,
      homeDir: this.deps.homeDir,
    });
    const session: CursorSession = {
      sessionId,
      attemptId: spec.attemptId,
      connectionId: spec.connectionId,
      worktree: spec.worktree,
      brief: spec.brief,
      briefVersion: spec.briefVersion,
      mode,
      transportKind: this.kind,
      controller,
      io,
      agent: null,
      jobId: job.jobId,
      launch: null,
      abort: new AbortController(),
      apiKey,
      wipDiff: spec.wipDiff ?? "",
      steeringNotes: [],
      events: [],
      eventsClosed: false,
      wake: null,
      turn: 0,
      lastUsage: emptyUsage(),
      pausedForOnDemand: false,
      onDemandNotified: false,
      authParked: false,
      aborted: false,
      requestSeq: 0,
      resumeCount: 0,
      permissions: new Map(),
    };
    const hooks = {
      preToolUse: (input: PreToolUseInput): HookDecision => this.recordPreTool(session, input),
      beforeShellExecution: (input: BeforeShellInput): HookDecision => this.recordShell(session, input),
    };
    try {
      session.agent =
        this.kind === "sdk"
          ? await openCursorSdk(this.deps, {
              apiKey,
              ...(spec.modelId ? { modelId: spec.modelId } : {}),
              worktree: spec.worktree,
              configDir: isolated.configDir,
              sandboxOptions,
              mcpServers: sandboxOptions.mcpServers,
              hooks,
            })
          : await openCursorAcp(this.deps, {
              apiKey,
              worktree: spec.worktree,
              configDir: isolated.configDir,
              proxyUrl: proxy.endpoint,
              sandboxOptions,
              hooks,
            });
      for (const pid of session.agent.childPids) this.deps.jobs.attach(job.jobId, pid);
    } catch (error) {
      this.deps.jobs.kill(job.jobId, "launch_failed");
      throw error;
    }
    const argv = session.agent.argv;
    if (argv.join("\n").includes(apiKey)) {
      this.deps.jobs.kill(job.jobId, "credential_in_argv");
      throw new CursorAdapterError("credential_in_argv", "The Cursor key was passed in process argv");
    }
    const launch: CursorLaunchRecord = {
      transport: this.kind,
      mode,
      argv,
      credentialInArgv: false,
      credentialInjected: true,
      sandboxOptions,
      hooksRegistered: { preToolUse: true, beforeShellExecution: true },
      sandboxTier: tier.tier,
      jobId: job.jobId,
      proxyUrl: proxy.endpoint,
      configDir: isolated.configDir,
      personalCursorHome: this.deps.personalCursorHome,
      personalCursorUntouched: true,
      osSandbox: true,
    };
    session.launch = launch;
    this.deps.launches?.push(launch);
    this.sessions.set(sessionId, session);
    this.deps.log.record("cursor_launch", {
      transport: this.kind,
      argv: argv.join(" "),
      configDir: isolated.configDir,
      proxy: proxy.endpoint,
      mode,
    });
    await this.persist(session);
    return {
      sessionId,
      attemptId: spec.attemptId,
      agentId: session.agent.vendorId,
      transport: this.kind,
      mode,
    };
  }

  async sendTurn(sessionId: string, briefOrPrompt: string): Promise<CursorTurnReceipt> {
    const session = this.require(sessionId);
    if (session.aborted || !session.agent) {
      throw new CursorAdapterError("session_closed", "Cursor session is closed");
    }
    const expiry = await this.deps.expiry.inspect(session.connectionId, this.deps.clock());
    if (expiry.expired || expiry.status === "expired" || expiry.status === "unauthorized") {
      return this.parkAuth(session, expiry.status === "unauthorized" ? "unauthorized" : "expired");
    }
    if (session.pausedForOnDemand) {
      return this.finishPaused(session);
    }
    let quota: CursorQuotaSnapshot;
    try {
      quota = session.controller.parseAgentUsage(await this.deps.usage.getUsage(session.apiKey));
    } catch (error) {
      if (isUnauthorizedError(error)) return this.parkAuth(session, "unauthorized");
      throw error;
    }
    await this.feedQuota(session, quota);
    if (shouldPauseForOnDemand(quota)) {
      session.pausedForOnDemand = true;
      return this.finishPaused(session);
    }
    session.turn += 1;
    this.emit(session, { type: "turn_started", sessionId: session.sessionId, turn: session.turn });
    let result;
    try {
      result = await session.agent.send(briefOrPrompt, session.abort.signal);
    } catch (error) {
      if (session.aborted || isUnauthorizedError(error)) {
        if (isUnauthorizedError(error) && !session.aborted) return this.parkAuth(session, "unauthorized");
        return this.finishInterrupted(session);
      }
      throw error;
    }
    if (result.httpStatus === 401) return this.parkAuth(session, "unauthorized");
    this.applyVendorEvents(session, result.events);
    const usage = session.controller.parseRunUsage(result.usage, false);
    session.lastUsage = usage;
    this.emit(session, { type: "usage_reported", sessionId: session.sessionId, usage });
    await this.deps.pacing.reportRunUsage({
      connectionId: session.connectionId,
      source: "run.usage",
      usage,
    });
    try {
      const after = session.controller.parseAgentUsage(await this.deps.usage.getUsage(session.apiKey));
      await this.feedQuota(session, after);
      if (shouldPauseForOnDemand(after)) session.pausedForOnDemand = true;
    } catch (error) {
      if (isUnauthorizedError(error)) return this.parkAuth(session, "unauthorized");
      throw error;
    }
    this.emit(session, {
      type: "turn_completed",
      sessionId: session.sessionId,
      turn: session.turn,
      stopReason: "completed",
    });
    await this.persist(session);
    return {
      sessionId: session.sessionId,
      turn: session.turn,
      dispatched: true,
      stopReason: "completed",
      usage,
      silentPaidFallback: false,
    };
  }

  async steer(sessionId: string, deltaNote: string): Promise<CursorSteerReceipt> {
    const session = this.require(sessionId);
    if (session.aborted || !session.agent) {
      throw new CursorAdapterError("session_closed", "Cursor session is closed");
    }
    await session.agent.steer(deltaNote);
    session.steeringNotes.push(deltaNote);
    await this.persist(session);
    return { sessionId, accepted: true, mode: "additive", note: deltaNote };
  }

  async interrupt(sessionId: string): Promise<CursorInterruptReceipt> {
    const session = this.require(sessionId);
    const started = performance.now();
    session.aborted = true;
    session.abort.abort();
    const agent = session.agent;
    if (agent) void agent.abort().then(() => undefined, () => undefined);
    const killedPids = this.deps.jobs.kill(session.jobId, "interrupt");
    const lingeringPids = this.deps.jobs.list(session.jobId);
    cleanupEphemeralMounts({ worktree: session.worktree, io: session.io });
    const elapsedMs = performance.now() - started;
    if (lingeringPids.length > 0) {
      throw new CursorAdapterError("lingering_children", "Cursor job left child processes behind");
    }
    if (elapsedMs >= INTERRUPT_BUDGET_MS) {
      throw new CursorAdapterError("interrupt_timeout", "Cursor interrupt exceeded 500 ms");
    }
    this.emit(session, { type: "session_exited", sessionId, reason: "interrupt" });
    session.eventsClosed = true;
    const wake = session.wake;
    session.wake = null;
    wake?.();
    await this.persist(session);
    return { sessionId, elapsedMs, lingeringPids, killedPids, sdkAbortInvoked: true };
  }

  async resume(sessionId: string, checkpointRef: CursorCheckpointRef): Promise<CursorResumeResult> {
    const session = this.require(sessionId);
    const saved = await this.deps.checkpoints.load(sessionId);
    const labeledWip = saved?.wipDiff ?? session.wipDiff;
    const briefVersion = saved?.briefVersion ?? session.briefVersion;
    const contradictory =
      checkpointRef.contradictory === true ||
      (checkpointRef.briefVersion !== undefined && checkpointRef.briefVersion !== briefVersion);
    if (!saved || contradictory) {
      return {
        supported: false,
        fallback: "fresh_session",
        reason: contradictory ? "contradiction" : "missing_checkpoint",
        sessionId,
        agentId: null,
        labeledWip,
        rebuiltBrief: `${session.brief}\n\nLabeled WIP:\n${labeledWip}`,
      };
    }
    const agent = session.agent;
    if (!agent) {
      return {
        supported: false,
        fallback: "fresh_session",
        reason: "missing_agent",
        sessionId,
        agentId: null,
        labeledWip,
        rebuiltBrief: `${session.brief}\n\nLabeled WIP:\n${labeledWip}`,
      };
    }
    const loaded = await agent.resume(saved.conversationHandle);
    if (!loaded.supported) {
      return {
        supported: false,
        fallback: "fresh_session",
        reason: "unsupported_resume",
        sessionId,
        agentId: null,
        labeledWip,
        rebuiltBrief: `${session.brief}\n\nLabeled WIP:\n${labeledWip}`,
      };
    }
    if (this.deps.jobs.list(session.jobId).length === 0) {
      session.resumeCount += 1;
      const job = this.deps.jobs.create(`${session.sessionId}-resume-${session.resumeCount}`);
      session.jobId = job.jobId;
      for (const pid of agent.childPids) this.deps.jobs.attach(job.jobId, pid);
    }
    session.aborted = false;
    session.eventsClosed = false;
    session.abort = new AbortController();
    return {
      supported: true,
      fallback: "native",
      reason: "resumed",
      sessionId,
      agentId: saved.agentId,
      labeledWip,
      rebuiltBrief: null,
    };
  }

  events(sessionId: string): AsyncIterable<NormalizedRuntimeEvent> {
    const session = this.require(sessionId);
    return {
      async *[Symbol.asyncIterator]() {
        let index = 0;
        for (;;) {
          while (index < session.events.length) {
            const event = session.events[index];
            index += 1;
            if (event) yield event;
          }
          if (session.eventsClosed) return;
          await new Promise<void>((resolve) => {
            session.wake = resolve;
          });
        }
      },
    };
  }

  async respondPermission(
    sessionId: string,
    requestId: string,
    decision: PermissionDecision,
  ): Promise<PermissionApplyResult> {
    const session = this.require(sessionId);
    const stored = session.permissions.get(requestId);
    if (!stored) throw new CursorAdapterError("unknown_permission", "Permission request was not found");
    if (decision.effect === "deny" && stored.decision.effect === "allow") {
      const tightened: HookDecision = {
        permission: "deny",
        effect: "deny",
        reason: decision.reason ?? "kernel denied the tool",
        elapsedMs: stored.decision.elapsedMs,
      };
      session.permissions.set(requestId, { requestId, decision: tightened });
      this.emit(session, {
        type: "permission_decided",
        sessionId,
        requestId,
        effect: "deny",
        reason: tightened.reason,
        elapsedMs: tightened.elapsedMs,
      });
      return {
        requestId,
        effect: tightened.effect,
        reason: tightened.reason,
        elapsedMs: tightened.elapsedMs,
      };
    }
    return {
      requestId,
      effect: stored.decision.effect,
      reason: stored.decision.reason,
      elapsedMs: stored.decision.elapsedMs,
    };
  }

  async usage(sessionId: string): Promise<NormalizedUsage> {
    return this.require(sessionId).lastUsage;
  }

  private async finishPaused(session: CursorSession): Promise<CursorTurnReceipt> {
    if (!session.onDemandNotified) {
      session.onDemandNotified = true;
      await this.deps.parker.park({
        connectionId: session.connectionId,
        reason: "on_demand",
        preserveWip: true,
      });
      this.deps.notices.emit({
        kind: "CheckpointStopCard",
        reason: "cursor_on_demand_approval_required",
        connectionId: session.connectionId,
        silentPaidFallback: false,
      });
      await this.deps.fallbackGuard.refuseSilentPaidFallback({
        connectionId: session.connectionId,
        from: "cursor_subscription",
        to: "paid_api_key",
      });
    }
    this.emit(session, {
      type: "rate_limited",
      sessionId: session.sessionId,
      usedPercent: 90,
      onDemandEnabled: true,
    });
    this.emit(session, {
      type: "turn_completed",
      sessionId: session.sessionId,
      turn: session.turn,
      stopReason: "on_demand_approval_required",
    });
    await this.persist(session);
    return {
      sessionId: session.sessionId,
      turn: session.turn,
      dispatched: false,
      stopReason: "on_demand_approval_required",
      usage: session.lastUsage,
      silentPaidFallback: false,
    };
  }

  private finishInterrupted(session: CursorSession): CursorTurnReceipt {
    const usage = emptyUsage(true);
    session.lastUsage = usage;
    this.emit(session, { type: "usage_reported", sessionId: session.sessionId, usage });
    this.emit(session, {
      type: "turn_completed",
      sessionId: session.sessionId,
      turn: session.turn,
      stopReason: "interrupted",
    });
    return {
      sessionId: session.sessionId,
      turn: session.turn,
      dispatched: false,
      stopReason: "interrupted",
      usage,
      silentPaidFallback: false,
    };
  }

  private async parkAuth(
    session: CursorSession,
    status: "expired" | "unauthorized",
  ): Promise<CursorTurnReceipt> {
    await this.parkDetached(session.connectionId, status);
    session.authParked = true;
    this.emit(session, {
      type: "session_error",
      sessionId: session.sessionId,
      kind: "auth",
      message: CURSOR_KEY_EXPIRED_ACCOUNT_CARD,
    });
    this.emit(session, {
      type: "turn_completed",
      sessionId: session.sessionId,
      turn: session.turn,
      stopReason: "auth_expired",
    });
    await this.persist(session);
    return {
      sessionId: session.sessionId,
      turn: session.turn,
      dispatched: false,
      stopReason: "auth_expired",
      usage: session.lastUsage,
      silentPaidFallback: false,
    };
  }

  private async parkDetached(connectionId: string, status: "expired" | "unauthorized"): Promise<void> {
    await this.deps.keys.markAuthExpired(connectionId, status);
    await this.deps.expiry.mark(connectionId, status);
    await this.deps.parker.park({ connectionId, reason: status, preserveWip: true });
    if (this.parkedConnections.has(connectionId)) return;
    this.parkedConnections.add(connectionId);
    this.deps.notices.emit({
      kind: "AccountCard",
      message: CURSOR_KEY_EXPIRED_ACCOUNT_CARD,
      connectionId,
      action: CURSOR_LOGIN_ACTION,
      silentPaidFallback: false,
    });
    await this.deps.sdk.authLogin(connectionId);
    await this.deps.fallbackGuard.refuseSilentPaidFallback({
      connectionId,
      from: "cursor_subscription",
      to: "paid_api_key",
    });
  }

  private async feedQuota(session: CursorSession, quota: CursorQuotaSnapshot): Promise<void> {
    const sample = session.controller.toPacingSample(quota);
    await this.deps.pacing.observeAuthoritativeUsage({
      connectionId: session.connectionId,
      ...sample,
    });
  }

  private applyVendorEvents(session: CursorSession, events: readonly CursorVendorEvent[]): void {
    for (const event of events) {
      if (event.type === "assistant") {
        this.emit(session, {
          type: "assistant_delta",
          sessionId: session.sessionId,
          text: this.deps.redactor.redact(event.text ?? ""),
        });
        continue;
      }
      if (event.type === "file_edited") {
        this.emit(session, {
          type: "file_edited",
          sessionId: session.sessionId,
          paths: event.paths ?? [],
        });
        continue;
      }
      if (event.type === "shell") {
        this.recordShell(session, {
          ...(event.requestId ? { requestId: event.requestId } : {}),
          command: event.command ?? "",
        });
        continue;
      }
      if (event.type === "tool" && event.kind && event.kind !== "web") {
        this.recordPreTool(session, {
          ...(event.requestId ? { requestId: event.requestId } : {}),
          toolName: event.toolName ?? event.kind,
          kind: event.kind,
          ...(event.path ? { path: event.path } : {}),
          ...(event.url ? { url: event.url } : {}),
          ...(event.mcpTool ? { mcpTool: event.mcpTool } : {}),
        });
        continue;
      }
      if (event.type === "tool" && event.kind === "web") {
        this.recordPreTool(session, {
          ...(event.requestId ? { requestId: event.requestId } : {}),
          toolName: event.toolName ?? "web",
          kind: "web",
          ...(event.url ? { url: event.url } : {}),
        });
      }
    }
  }

  private recordPreTool(session: CursorSession, input: PreToolUseInput): HookDecision {
    const requestId = input.requestId ?? `req-${session.requestSeq++}`;
    const existing = session.permissions.get(requestId);
    if (existing) return existing.decision;
    const decision = session.controller.preToolUse({ ...input, requestId });
    session.permissions.set(requestId, { requestId, decision });
    this.emitToolDecision(session, requestId, input.kind, decision);
    return decision;
  }

  private recordShell(session: CursorSession, input: BeforeShellInput): HookDecision {
    const requestId = input.requestId ?? `req-${session.requestSeq++}`;
    const existing = session.permissions.get(requestId);
    if (existing) return existing.decision;
    const decision = session.controller.beforeShellExecution({ ...input, requestId });
    session.permissions.set(requestId, { requestId, decision });
    this.emitToolDecision(session, requestId, "shell", decision);
    return decision;
  }

  private emitToolDecision(
    session: CursorSession,
    requestId: string,
    kind: FileToolKind | "shell",
    decision: HookDecision,
  ): void {
    this.emit(session, { type: "tool_call_requested", sessionId: session.sessionId, requestId, kind });
    this.emit(session, { type: "permission_requested", sessionId: session.sessionId, requestId, kind });
    this.emit(session, {
      type: "permission_decided",
      sessionId: session.sessionId,
      requestId,
      effect: decision.effect,
      reason: decision.reason,
      elapsedMs: decision.elapsedMs,
    });
    if (decision.effect === "allow") {
      this.emit(session, { type: "tool_call_started", sessionId: session.sessionId, requestId });
    }
    this.emit(session, {
      type: "tool_call_finished",
      sessionId: session.sessionId,
      requestId,
      exitCode: decision.effect === "allow" ? 0 : 1,
    });
  }

  private emit(session: CursorSession, event: NormalizedRuntimeEvent): void {
    session.events.push(event);
    const wake = session.wake;
    session.wake = null;
    wake?.();
  }

  private async persist(session: CursorSession): Promise<void> {
    const agentId = session.agent?.vendorId ?? session.sessionId;
    const record: CursorCheckpointRecord = {
      sessionId: session.sessionId,
      attemptId: session.attemptId,
      connectionId: session.connectionId,
      agentId,
      conversationHandle: agentId,
      brief: session.brief,
      briefVersion: session.briefVersion,
      wipDiff: session.wipDiff,
      mode: session.mode,
      transport: session.transportKind,
      steeringNotes: [...session.steeringNotes],
    };
    await this.deps.checkpoints.save(record);
  }

  private require(sessionId: string): CursorSession {
    const session = this.sessions.get(sessionId);
    if (!session) throw new CursorAdapterError("unknown_session", `Unknown Cursor session ${sessionId}`);
    return session;
  }
}

function missingLaunch(): never {
  throw new CursorAdapterError("missing_launch", "Cursor session has no launch record");
}
