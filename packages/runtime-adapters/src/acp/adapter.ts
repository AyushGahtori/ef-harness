import fs from "node:fs";
import path from "node:path";
import { AcpMcpAndSkillBinder, DEFAULT_MCP_TOOLS, LocalLeasedMcpServer, LocalSkillMounter } from "./binder.js";
import type { LeasedMcpPort, SkillMounterPort } from "./binder.js";
import { AcpHostFsAndTerminalBridge, readNumber, requireString } from "./bridge.js";
import type { BridgeSession } from "./bridge.js";
import {
  AcpProtocolError,
  AcpRpcError,
  DEFAULT_CANCEL_GRACE_MS,
  DEFAULT_INITIALIZE_TIMEOUT_MS,
  DEFAULT_PROMPT_TIMEOUT_MS,
  JSON_RPC_METHOD_NOT_FOUND,
} from "./errors.js";
import { makeEvent, NormalizedRuntimeEventBus, textFromContent, usageFromUpdate } from "./events.js";
import { LocalHarnessRunEngine } from "./harness.js";
import type { HarnessRunPort } from "./harness.js";
import { isAlive, killProcessTree, LocalWindowsJob } from "./job.js";
import type { WindowsJobPort } from "./job.js";
import { LocalWarmExecutionPool } from "./pool.js";
import type { WarmExecutionPoolPort } from "./pool.js";
import { LocalSupervisionPolicy } from "./policy.js";
import type { SupervisionPolicyPort } from "./policy.js";
import { ACP_RUNTIME_PROFILES, scrubSpawnEnv } from "./profiles.js";
import type { AcpRuntimeProfile } from "./profiles.js";
import { LocalPacketSecurityRedactor, LocalTurnLog, registerSecrets } from "./redaction.js";
import type { PacketSecurityRedactorPort } from "./redaction.js";
import { AcpJsonRpcTransport, readParams } from "./transport.js";
import type { AcpSpawnedProcess } from "./spawn.js";
import { defaultSpawn } from "./spawn.js";
import type {
  AcpPermissionKind,
  AcpPermissionOutcome,
  AuthStatus,
  NormalizedRuntimeEvent,
  NormalizedUsage,
  PermissionDecisionInput,
  ProbeResult,
  PromptBlock,
  ResumeResult,
  SessionRef,
  SupervisionRequest,
  TurnResult,
} from "./types.js";
import { emptyUsage, isRecord } from "./types.js";
import type { AcpSessionSpec } from "./types.js";

export interface GenericAcpAdapterOptions {
  readonly profile?: AcpRuntimeProfile;
  readonly policy?: SupervisionPolicyPort;
  readonly events?: NormalizedRuntimeEventBus;
  readonly jobs?: WindowsJobPort;
  readonly harness?: HarnessRunPort;
  readonly mcp?: LeasedMcpPort;
  readonly skills?: SkillMounterPort;
  readonly redactor?: PacketSecurityRedactorPort;
  readonly turnLog?: LocalTurnLog;
  readonly bridge?: AcpHostFsAndTerminalBridge;
  readonly pool?: WarmExecutionPoolPort;
  readonly spawn?: (request: import("./spawn.js").AcpSpawnRequest) => AcpSpawnedProcess;
  readonly initializeTimeoutMs?: number;
  readonly cancelGraceMs?: number;
  readonly promptTimeoutMs?: number;
}

interface PermissionSlot {
  settled: boolean;
  outcome: AcpPermissionOutcome | null;
}

interface LiveSession {
  readonly id: string;
  readonly spec: AcpSessionSpec;
  readonly mode: "wrapped" | "stripped";
  readonly jobId: string;
  agentSessionId: string;
  loadSession: boolean;
  child: AcpSpawnedProcess | null;
  pid: number | null;
  transport: AcpJsonRpcTransport | null;
  interrupting: boolean;
  turnActive: boolean;
  cleaned: boolean;
  exited: boolean;
  usage: NormalizedUsage;
  readonly steerQueue: string[];
  readonly pendingPermissions: Set<PermissionSlot>;
  readonly manualDecisions: Map<string, PermissionDecisionInput>;
  mcpServers: readonly Record<string, unknown>[];
  leaseId: string | null;
  exitCode: number | null;
  exitTask: Promise<void> | null;
}

/**
 * Configurable ACP base used by Codex-ACP, Copilot-ACP, Cursor-ACP, Gemini-ACP, and OpenCode-ACP.
 * Framing, permission, filesystem, and terminal security live here once.
 */
export class GenericAcpAdapter {
  readonly eventsBus: NormalizedRuntimeEventBus;
  readonly turnLog: LocalTurnLog;
  readonly bridge: AcpHostFsAndTerminalBridge;
  private readonly profile: AcpRuntimeProfile;
  private readonly policy: SupervisionPolicyPort;
  private readonly jobs: WindowsJobPort;
  private readonly harness: HarnessRunPort;
  private readonly binder: AcpMcpAndSkillBinder;
  private readonly redactor: PacketSecurityRedactorPort;
  private readonly spawnProcess: (request: import("./spawn.js").AcpSpawnRequest) => AcpSpawnedProcess;
  private readonly initializeTimeoutMs: number;
  private readonly cancelGraceMs: number;
  private readonly promptTimeoutMs: number;
  private readonly sessions = new Map<string, LiveSession>();

  constructor(options: GenericAcpAdapterOptions = {}) {
    this.profile = options.profile ?? ACP_RUNTIME_PROFILES.generic;
    this.policy = options.policy ?? new LocalSupervisionPolicy();
    this.eventsBus = options.events ?? new NormalizedRuntimeEventBus();
    this.jobs = options.jobs ?? new LocalWindowsJob();
    this.redactor = options.redactor ?? new LocalPacketSecurityRedactor();
    this.harness =
      options.harness ?? new LocalHarnessRunEngine({ jobs: this.jobs, redact: (text) => this.redactor.redact(text) });
    this.turnLog = options.turnLog ?? new LocalTurnLog(this.redactor);
    this.binder = new AcpMcpAndSkillBinder(
      options.mcp ?? new LocalLeasedMcpServer(),
      options.skills ?? new LocalSkillMounter(),
    );
    const pool = options.pool ?? new LocalWarmExecutionPool(2);
    this.bridge =
      options.bridge ??
      new AcpHostFsAndTerminalBridge(
        this.policy,
        this.harness,
        this.jobs,
        this.eventsBus,
        this.redactor,
        pool,
        4 * 1024 * 1024,
        (event) =>
          this.turnLog.append({
            sessionId: event.sessionId,
            kind: "security",
            text: `${event.method} ${event.reason}`,
          }),
      );
    this.spawnProcess = options.spawn ?? defaultSpawn;
    this.initializeTimeoutMs = options.initializeTimeoutMs ?? DEFAULT_INITIALIZE_TIMEOUT_MS;
    this.cancelGraceMs = options.cancelGraceMs ?? DEFAULT_CANCEL_GRACE_MS;
    this.promptTimeoutMs = options.promptTimeoutMs ?? DEFAULT_PROMPT_TIMEOUT_MS;
  }

  async probe(): Promise<ProbeResult> {
    const installed = commandExists(this.profile.command);
    return {
      installed,
      version: this.profile.version,
      status: installed ? "ok" : "missing",
      modes: ["wrapped", "stripped"],
      runtime: this.profile.id,
      capabilities: {
        initialize: true,
        sessionNew: true,
        sessionPrompt: true,
        sessionUpdate: true,
        requestPermission: true,
        hostFs: true,
        hostTerminal: true,
        mcp: true,
      },
    };
  }

  authStatus(): Promise<AuthStatus> {
    return Promise.resolve({ status: "not_required", signedIn: true, scrapedHome: false });
  }

  async startSession(spec: AcpSessionSpec): Promise<SessionRef> {
    const session = this.openSession(spec);
    try {
      const child = this.spawnProcess({
        command: this.profile.command,
        args: this.profile.args,
        cwd: session.spec.cwd ?? session.spec.worktreeRoot,
        env: scrubSpawnEnv(this.profile.envAllowlist, spec.env ?? {}),
      });
      session.child = child;
      session.pid = child.pid;
      this.jobs.attach(session.jobId, child.pid);
      const transport = new AcpJsonRpcTransport(
        { stdin: child.stdin, stdout: child.stdout, stderr: child.stderr },
        {
          redactor: this.redactor,
          onWire: (summary) => this.turnLog.append({ sessionId: session.id, kind: "acp_wire", text: summary }),
          onFatal: (error) => this.onTransportFatal(session, error),
        },
      );
      session.transport = transport;
      transport.inbound = (request) => this.onInbound(session, request);
      transport.start();
      child.once("exit", (code) => {
        session.exitCode = code;
        void this.onChildExit(session, code);
      });
      const initialized = await transport.request(
        "initialize",
        {
          protocolVersion: this.profile.quirks.protocolVersion,
          clientCapabilities: {
            fs: { readTextFile: true, writeTextFile: true },
            terminal: true,
            mcp: true,
          },
          clientInfo: { name: "EF Harness", version: "0.0.0" },
        },
        this.initializeTimeoutMs,
      );
      const negotiated = negotiate(initialized);
      if (!this.profile.quirks.tolerateStdoutBanner && transport.startupBanners.length > 0) {
        throw new AcpProtocolError("framing_corruption", "stdout banner is not allowed for this runtime");
      }
      session.loadSession = negotiated.loadSession;
      const bound = await this.binder.bind({
        sessionId: session.id,
        attemptId: spec.attemptId,
        taskId: spec.taskId,
        worktreeRoot: spec.worktreeRoot,
        tools: spec.mcpTools ?? DEFAULT_MCP_TOOLS,
        skills: spec.skills ?? [],
        mcpType: this.profile.quirks.mcpTransport,
      });
      this.redactor.register("mcp-bearer", bound.bearerToken);
      session.leaseId = bound.leaseId;
      session.mcpServers = bound.mcpServers.map((server) => ({ ...server }));
      const created = await transport.request(
        "session/new",
        {
          cwd: spec.cwd ?? spec.worktreeRoot,
          mcpServers: bound.mcpServers,
        },
        this.initializeTimeoutMs,
      );
      if (!isRecord(created) || typeof created.sessionId !== "string" || !created.sessionId) {
        throw new AcpProtocolError("malformed_frame", "session/new did not return a sessionId");
      }
      session.agentSessionId = created.sessionId;
      this.eventsBus.publish(makeEvent("session_started", session.id, { agentSessionId: created.sessionId }));
      for (const banner of transport.startupBanners) {
        this.turnLog.append({ sessionId: session.id, kind: "acp_stderr", text: `stdout-banner ${banner}` });
      }
      for (const line of transport.stderrLines) {
        this.turnLog.append({ sessionId: session.id, kind: "acp_stderr", text: line });
      }
      return { sessionId: session.id, agentSessionId: created.sessionId, cwd: spec.cwd ?? spec.worktreeRoot };
    } catch (error) {
      await this.failStartup(session, error);
      throw error;
    }
  }

  async sendTurn(sessionId: string, briefOrPrompt: string | readonly PromptBlock[]): Promise<TurnResult> {
    const session = this.require(sessionId);
    const transport = this.requireTransport(session);
    const queued = session.steerQueue.splice(0);
    const blocks = [...queued.map((text) => ({ type: "text" as const, text })), ...promptBlocks(briefOrPrompt)];
    session.turnActive = true;
    this.eventsBus.publish(makeEvent("turn_started", session.id, { blocks: blocks.length }));
    try {
      const result = await transport.request(
        "session/prompt",
        { sessionId: session.agentSessionId, prompt: blocks },
        this.promptTimeoutMs,
      );
      const stopReason = isRecord(result) && typeof result.stopReason === "string" ? result.stopReason : "end_turn";
      const cancelled = stopReason === "cancelled" || session.interrupting;
      this.eventsBus.publish(makeEvent("turn_completed", session.id, { stopReason: cancelled ? "cancelled" : stopReason }));
      return { stopReason: cancelled ? "cancelled" : stopReason, cancelled };
    } catch (error) {
      if (session.interrupting && error instanceof AcpProtocolError) {
        this.eventsBus.publish(makeEvent("turn_completed", session.id, { stopReason: "cancelled" }));
        return { stopReason: "cancelled", cancelled: true };
      }
      throw error;
    } finally {
      session.turnActive = false;
    }
  }

  async steer(sessionId: string, deltaNote: string): Promise<{ queued: true }> {
    const session = this.require(sessionId);
    session.steerQueue.push(deltaNote);
    if (this.profile.quirks.steerMethod === "session/steer" && session.transport && session.agentSessionId) {
      session.transport.notify("session/steer", { sessionId: session.agentSessionId, prompt: [{ type: "text", text: deltaNote }] });
    }
    return { queued: true };
  }

  async interrupt(sessionId: string): Promise<void> {
    const session = this.require(sessionId);
    session.interrupting = true;
    for (const slot of session.pendingPermissions) {
      slot.settled = true;
      slot.outcome = { outcome: "cancelled", kind: "reject_once", optionId: "reject_once" };
    }
    if (session.transport && session.agentSessionId) {
      try {
        session.transport.notify("session/cancel", { sessionId: session.agentSessionId });
      } catch (error) {
        if (!(error instanceof AcpProtocolError)) throw error;
      }
    }
    const grace = setTimeout(() => {
      if (session.pid !== null && isAlive(session.pid)) this.jobs.kill(session.jobId, "cancel_grace");
    }, this.cancelGraceMs);
    if (session.child) {
      session.child.once("exit", () => clearTimeout(grace));
    }
    await this.bridge.releaseAll();
  }

  async resume(sessionId: string, checkpointRef?: string): Promise<ResumeResult> {
    const session = this.require(sessionId);
    if (!session.loadSession) return { supported: false, reason: "unsupported_resume" };
    const transport = this.requireTransport(session);
    const result = await transport.request(
      "session/load",
      {
        sessionId: session.agentSessionId,
        cwd: session.spec.cwd ?? session.spec.worktreeRoot,
        mcpServers: session.mcpServers,
        ...(checkpointRef !== undefined ? { checkpointRef } : {}),
      },
      this.initializeTimeoutMs,
    );
    const loaded = isRecord(result) && typeof result.sessionId === "string" ? result.sessionId : session.agentSessionId;
    session.agentSessionId = loaded;
    return { supported: true, reason: "resumed", sessionId: session.id };
  }

  events(sessionId: string): AsyncIterable<NormalizedRuntimeEvent> {
    this.require(sessionId);
    return this.eventsBus.stream(sessionId);
  }

  respondPermission(sessionId: string, requestId: string, decision: PermissionDecisionInput): Promise<void> {
    const session = this.require(sessionId);
    session.manualDecisions.set(requestId, decision);
    if (decision.effect === "deny") {
      for (const slot of session.pendingPermissions) {
        slot.settled = true;
        slot.outcome = { outcome: "cancelled", kind: "reject_once", optionId: "reject_once" };
      }
    }
    return Promise.resolve();
  }

  usage(sessionId: string): Promise<NormalizedUsage> {
    return Promise.resolve(this.require(sessionId).usage);
  }

  async stop(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session || session.exited) {
      if (session) await this.cleanupEphemeralMounts(sessionId);
      return;
    }
    await this.interrupt(sessionId);
    await this.finishExit(session, session.exitCode);
  }

  cleanupEphemeralMounts(sessionId: string): Promise<{ removed: string[] }> {
    const session = this.require(sessionId);
    return this.binder.cleanupEphemeralMounts(sessionId, session.spec.worktreeRoot);
  }

  inspect(sessionId: string): {
    readonly loadSession: boolean;
    readonly banners: readonly string[];
    readonly stderr: readonly string[];
    readonly mcpServers: readonly Record<string, unknown>[];
    readonly pid: number | null;
    readonly usage: NormalizedUsage;
  } {
    const session = this.require(sessionId);
    return {
      loadSession: session.loadSession,
      banners: session.transport?.startupBanners ?? [],
      stderr: session.transport?.stderrLines ?? [],
      mcpServers: session.mcpServers,
      pid: session.pid,
      usage: session.usage,
    };
  }

  securityEvents(): readonly { method: string; reason: string }[] {
    return this.bridge.securityEvents;
  }

  private openSession(spec: AcpSessionSpec): LiveSession {
    const id = spec.sessionId ?? `acp-${spec.attemptId}`;
    if (this.sessions.has(id)) throw new AcpProtocolError("spawn_failed", `session ${id} already exists`);
    registerSecrets(this.redactor, spec.secrets ?? []);
    const job = this.jobs.create(id);
    const session: LiveSession = {
      id,
      spec,
      mode: spec.mode ?? "wrapped",
      jobId: job.jobId,
      agentSessionId: "",
      loadSession: false,
      child: null,
      pid: null,
      transport: null,
      interrupting: false,
      turnActive: false,
      cleaned: false,
      exited: false,
      usage: emptyUsage(),
      steerQueue: [],
      pendingPermissions: new Set(),
      manualDecisions: new Map(),
      mcpServers: [],
      leaseId: null,
      exitCode: null,
      exitTask: null,
    };
    this.sessions.set(id, session);
    return session;
  }

  private async onInbound(session: LiveSession, request: { id: number | string; method: string; params?: unknown }): Promise<unknown> {
    const params = readParams({ id: request.id, method: request.method, ...(request.params !== undefined ? { params: request.params } : {}) });
    if (request.method === "session/update") {
      this.onUpdate(session, params);
      return null;
    }
    if (request.method === "session/request_permission") return this.onPermission(session, params);
    const bridgeSession = this.bridgeSession(session);
    if (request.method === "fs/read_text_file") {
      const line = readNumber(params.line);
      const limit = readNumber(params.limit);
      return this.bridge.readTextFile(bridgeSession, {
        sessionId: session.id,
        path: requireString(params, "path"),
        ...(line !== undefined ? { line } : {}),
        ...(limit !== undefined ? { limit } : {}),
      });
    }
    if (request.method === "fs/write_text_file") {
      return this.bridge.writeTextFile(bridgeSession, {
        sessionId: session.id,
        path: requireString(params, "path"),
        content: typeof params.content === "string" ? params.content : "",
      });
    }
    if (request.method === "terminal/create") {
      return this.bridge.createTerminal(bridgeSession, {
        sessionId: session.id,
        command: requireString(params, "command"),
        ...(typeof params.cwd === "string" ? { cwd: params.cwd } : {}),
      });
    }
    if (request.method === "terminal/output") {
      return this.bridge.output(bridgeSession, requireString(params, "terminalId"));
    }
    if (request.method === "terminal/wait_for_exit") {
      return this.bridge.waitForExit(bridgeSession, requireString(params, "terminalId"));
    }
    if (request.method === "terminal/kill") return this.bridge.kill(bridgeSession, requireString(params, "terminalId"));
    if (request.method === "terminal/release") {
      return this.bridge.release(bridgeSession, requireString(params, "terminalId"));
    }
    session.transport?.noteUnknownMethod(request.method);
    throw new AcpRpcError(JSON_RPC_METHOD_NOT_FOUND, `unknown method ${request.method}`);
  }

  private async onPermission(session: LiveSession, params: Record<string, unknown>): Promise<{ outcome: AcpPermissionOutcome }> {
    const requestId = permissionRequestId(params);
    const slot: PermissionSlot = { settled: false, outcome: null };
    session.pendingPermissions.add(slot);
    this.eventsBus.publish(
      makeEvent("permission_requested", session.id, {
        requestId,
        tool: permissionTool(params),
      }),
    );
    if (session.interrupting || slot.settled) {
      session.pendingPermissions.delete(slot);
      const outcome = slot.outcome ?? cancelledPermission(params);
      this.eventsBus.publish(
        makeEvent("permission_decided", session.id, {
          requestId,
          effect: "deny",
          reason: "cancelled",
          kind: outcome.kind,
        }),
      );
      return { outcome };
    }
    const manual = session.manualDecisions.get(requestId);
    const decision = this.policy.decide(supervisionContext(session), mapPermission(params));
    this.eventsBus.publish(
      makeEvent("permission_decided", session.id, {
        requestId,
        effect: decision.effect,
        ...(decision.effect === "deny" ? { reason: decision.reason } : {}),
        elapsedMs: decision.elapsedMs,
      }),
    );
    session.pendingPermissions.delete(slot);
    if (session.interrupting || slot.settled || manual?.effect === "deny") {
      return { outcome: cancelledPermission(params) };
    }
    if (decision.effect === "deny") return { outcome: selectedPermission(params, "reject_once") };
    return { outcome: selectedPermission(params, "allow_once") };
  }

  private onUpdate(session: LiveSession, params: Record<string, unknown>): void {
    const update = isRecord(params.update) ? params.update : params;
    const kind = typeof update.sessionUpdate === "string" ? update.sessionUpdate : "";
    if (kind === "agent_message_chunk" || kind === "agent_thought_chunk") {
      this.eventsBus.publish(
        makeEvent("assistant_delta", session.id, {
          text: textFromContent(update.content),
          channel: kind === "agent_thought_chunk" ? "thought" : "message",
        }),
      );
      return;
    }
    if (kind === "tool_call" || kind === "tool_call_update") {
      const status = typeof update.status === "string" ? update.status : "pending";
      const type = status === "completed" || status === "failed" ? "tool_call_finished" : status === "in_progress" ? "tool_call_started" : "tool_call_requested";
      this.eventsBus.publish(makeEvent(type, session.id, { ...update }));
      return;
    }
    if (kind === "plan") {
      this.eventsBus.publish(makeEvent("plan_updated", session.id, { entries: update.entries ?? [] }));
      return;
    }
    if (kind === "usage_update") {
      session.usage = mergeUsage(session.usage, update);
      this.eventsBus.publish(makeEvent("usage_reported", session.id, { ...session.usage }));
      return;
    }
    if (kind === "rate_limit") {
      this.eventsBus.publish(makeEvent("rate_limited", session.id, { ...update }));
      return;
    }
    this.turnLog.append({ sessionId: session.id, kind: "acp_wire", text: `ignored update ${kind || "unknown"}` });
  }

  private bridgeSession(session: LiveSession): BridgeSession {
    return {
      sessionId: session.id,
      attemptId: session.spec.attemptId,
      taskId: session.spec.taskId,
      worktreeRoot: session.spec.worktreeRoot,
      cwd: session.spec.cwd ?? session.spec.worktreeRoot,
      writeScope: session.spec.writeScope,
      mode: session.mode,
      jobId: session.jobId,
      ...(session.spec.homeDir !== undefined ? { homeDir: session.spec.homeDir } : {}),
      ...(session.spec.appData !== undefined ? { appData: session.spec.appData } : {}),
      leasedTools: session.spec.mcpTools ?? DEFAULT_MCP_TOOLS,
    };
  }

  private onTransportFatal(session: LiveSession, error: Error): void {
    if (session.exited) return;
    this.eventsBus.publish(makeEvent("session_error", session.id, { message: error.message }));
    if (session.pid !== null && isAlive(session.pid)) this.jobs.kill(session.jobId, error.message);
  }

  private async onChildExit(session: LiveSession, code: number | null): Promise<void> {
    if (session.exited) return;
    await this.finishExit(session, code);
  }

  private finishExit(session: LiveSession, code: number | null): Promise<void> {
    if (session.exitTask) return session.exitTask;
    session.exited = true;
    session.exitTask = this.completeExit(session, code);
    return session.exitTask;
  }

  private async completeExit(session: LiveSession, code: number | null): Promise<void> {
    await this.binder.cleanupEphemeralMounts(session.id, session.spec.worktreeRoot);
    session.cleaned = true;
    if (session.leaseId) this.redactor.forget("mcp-bearer");
    try {
      if (session.pid !== null) killProcessTree(session.pid);
      this.jobs.close(session.jobId);
    } catch (error) {
      if (!(error instanceof Error)) throw error;
    }
    if (session.pid !== null) await waitUntilDead(session.pid);
    session.child?.stdin.end();
    this.eventsBus.publish(
      makeEvent("session_exited", session.id, {
        exitCode: code,
        abnormal: code !== 0 && code !== null,
      }),
    );
  }

  private async failStartup(session: LiveSession, error: unknown): Promise<void> {
    this.eventsBus.publish(
      makeEvent("session_error", session.id, { message: error instanceof Error ? error.message : "startup failed" }),
    );
    await this.finishExit(session, session.exitCode);
    if (session.pid !== null && isAlive(session.pid)) this.jobs.kill(session.jobId, "startup_failed");
  }

  private require(sessionId: string): LiveSession {
    const session = this.sessions.get(sessionId);
    if (!session) throw new AcpProtocolError("transport_closed", `unknown session ${sessionId}`);
    return session;
  }

  private requireTransport(session: LiveSession): AcpJsonRpcTransport {
    if (!session.transport) throw new AcpProtocolError("transport_closed", "session transport is closed");
    return session.transport;
  }
}

export function createGenericAcpAdapter(options: GenericAcpAdapterOptions = {}): GenericAcpAdapter {
  return new GenericAcpAdapter(options);
}

function negotiate(result: unknown): { loadSession: boolean } {
  if (!isRecord(result) || typeof result.protocolVersion !== "number") {
    throw new AcpProtocolError("version_mismatch", "initialize did not return a protocol version");
  }
  if (result.protocolVersion !== 1) {
    throw new AcpProtocolError("version_mismatch", `unsupported protocol version ${result.protocolVersion}`);
  }
  const caps = isRecord(result.agentCapabilities) ? result.agentCapabilities : {};
  const required = Array.isArray(caps.requiredClientCapabilities) ? caps.requiredClientCapabilities : [];
  const offered = new Set(["fs.readTextFile", "fs.writeTextFile", "terminal", "mcp"]);
  for (const item of required) {
    if (typeof item !== "string" || !offered.has(item)) {
      throw new AcpProtocolError("capability_mismatch", `client cannot serve ${String(item)}`);
    }
  }
  return { loadSession: caps.loadSession === true };
}

function promptBlocks(input: string | readonly PromptBlock[]): PromptBlock[] {
  if (typeof input === "string") return [{ type: "text", text: input }];
  return input.map((block) => ({ type: "text", text: block.text }));
}

function supervisionContext(session: LiveSession) {
  return {
    worktreeRoot: session.spec.worktreeRoot,
    writeScope: session.spec.writeScope,
    mode: session.mode,
    cwd: session.spec.cwd ?? session.spec.worktreeRoot,
    ...(session.spec.homeDir !== undefined ? { homeDir: session.spec.homeDir } : {}),
    ...(session.spec.appData !== undefined ? { appData: session.spec.appData } : {}),
    leasedTools: session.spec.mcpTools ?? DEFAULT_MCP_TOOLS,
  };
}

function mapPermission(params: Record<string, unknown>): SupervisionRequest {
  const toolCall = isRecord(params.toolCall) ? params.toolCall : params;
  const raw = isRecord(toolCall.rawInput) ? toolCall.rawInput : {};
  const kind = typeof toolCall.kind === "string" ? toolCall.kind.toLowerCase() : "";
  const filePath = firstString(raw, ["path", "file", "file_path", "filePath"]);
  const command = firstString(raw, ["command", "cmd"]);
  if (kind === "read" || kind === "search") {
    return { kind: "read", path: filePath ?? "" };
  }
  if (kind === "edit" || kind === "write") return { kind: "edit", path: filePath ?? "" };
  if (kind === "delete") return { kind: "delete", path: filePath ?? "" };
  if (kind === "execute" || kind === "shell" || kind === "terminal" || command) {
    return { kind: "shell", command: command ?? "" };
  }
  if (kind === "web" || kind === "fetch") {
    const url = firstString(raw, ["url"]);
    return url ? { kind: "web", url } : { kind: "web" };
  }
  const tool = firstString(raw, ["name", "tool"]) ?? (typeof toolCall.title === "string" ? toolCall.title : "unknown");
  return { kind: "mcp", tool };
}

function permissionRequestId(params: Record<string, unknown>): string {
  const toolCall = isRecord(params.toolCall) ? params.toolCall : params;
  return typeof toolCall.toolCallId === "string" ? toolCall.toolCallId : "permission";
}

function permissionTool(params: Record<string, unknown>): string {
  const toolCall = isRecord(params.toolCall) ? params.toolCall : params;
  return typeof toolCall.title === "string" ? toolCall.title : permissionRequestId(params);
}

function selectedPermission(params: Record<string, unknown>, kind: AcpPermissionKind): AcpPermissionOutcome {
  return { outcome: "selected", kind, optionId: optionIdFor(params, kind) ?? kind };
}

function cancelledPermission(params: Record<string, unknown>): AcpPermissionOutcome {
  return { outcome: "cancelled", kind: "reject_once", optionId: optionIdFor(params, "reject_once") ?? "reject_once" };
}

function optionIdFor(params: Record<string, unknown>, kind: AcpPermissionKind): string | null {
  if (!Array.isArray(params.options)) return null;
  for (const option of params.options) {
    if (!isRecord(option)) continue;
    if (option.kind === kind && typeof option.optionId === "string") return option.optionId;
  }
  return null;
}

function firstString(record: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return null;
}

function mergeUsage(current: NormalizedUsage, update: Record<string, unknown>): NormalizedUsage {
  const parsed = usageFromUpdate(update);
  const next: NormalizedUsage = {
    inputTokens: hasOwn(update, "inputTokens", "input_tokens") ? parsed.inputTokens : current.inputTokens,
    cachedInputTokens: hasOwn(update, "cachedInputTokens", "cached_input_tokens") ? parsed.cachedInputTokens : current.cachedInputTokens,
    outputTokens: hasOwn(update, "outputTokens", "output_tokens") ? parsed.outputTokens : current.outputTokens,
    reasoningTokens: hasOwn(update, "reasoningTokens", "reasoning_tokens", "thoughtTokens") ? parsed.reasoningTokens : current.reasoningTokens,
  };
  if (parsed.costMicroUsd !== undefined) return { ...next, costMicroUsd: parsed.costMicroUsd };
  if (current.costMicroUsd !== undefined) return { ...next, costMicroUsd: current.costMicroUsd };
  return next;
}

function hasOwn(record: Record<string, unknown>, ...keys: string[]): boolean {
  return keys.some((key) => Object.prototype.hasOwnProperty.call(record, key));
}

async function waitUntilDead(pid: number): Promise<void> {
  const started = Date.now();
  while (isAlive(pid) && Date.now() - started < 2_000) {
    killProcessTree(pid);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

function commandExists(command: string): boolean {
  if (path.isAbsolute(command) || command.includes(path.sep) || command.includes("/")) return fs.existsSync(command);
  const pathEnv = process.env.PATH ?? process.env.Path ?? "";
  const extensions = process.platform === "win32" ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";") : [""];
  for (const directory of pathEnv.split(path.delimiter)) {
    if (!directory) continue;
    for (const extension of extensions) {
      const candidate = path.join(directory, process.platform === "win32" ? `${command}${extension}` : command);
      if (fs.existsSync(candidate)) return true;
    }
  }
  return false;
}
