import os from "node:os";
import path from "node:path";
import { SupervisionError } from "./errors.js";
import { scrubChildEnvironment } from "./env.js";
import { NormalizedRuntimeEventBus } from "./events.js";
import type {
  AgentRuntimeAdapter,
  AuthStatus,
  InterruptResult,
  ProbeResult,
  ProbeStatus,
  ResumeResult,
  SessionHandle,
  SessionStartSpec,
  SteerReceipt,
  TurnReceipt,
} from "./interface.js";
import { WrappedVsStrippedModeSelector } from "./mode.js";
import { DeterministicSupervisionPolicyEngine, USER_STOPPED_REASON } from "./policy.js";
import type { SupervisionContext } from "./policy.js";
import {
  LocalCliMinVersionGate,
  LocalLeasedMcpServer,
    LocalLoopbackAllowlistProxy,
    LocalSandboxTierSelector,
    LocalSessionProcessCap,
    LocalSignedProviderPolicy,
    PidTrackingJobSupervisor,
    killProcessTree,
  type CliMinVersionGatePort,
  type LeasedMcpServerPort,
  type LoopbackAllowlistProxyPort,
  type PacketSecurityRedactor,
  type SandboxTierSelectorPort,
  type SessionProcessCapGuardPort,
  type SignedProviderPolicyEnginePort,
  type WindowsJobSupervisorPort,
} from "./ports.js";
import { LocalPacketSecurityRedactor, RedactingLineBuffer } from "./redactor.js";
import type { AdapterRegistry } from "./registry.js";
import { exitDisposition, type NormalizedRuntimeEvent, type RuntimeEventDraft, type SessionDisposition } from "./runtime-event.js";
import { MandatorySandboxSupervisor } from "./sandbox.js";
import { spawnForeignProcess, type ForeignProcess, type ForeignSpawnRequest } from "./spawn.js";
import type { ForeignRawEvent } from "./translate.js";
import { MemoryTurnLog } from "./turn-log.js";
import type { ForeignRuntimeId, NormalizedUsage, PermissionReply, PolicyDecision, SupervisionRequest } from "./types.js";
import { normalizeUsage } from "./usage.js";

const SECRET_REGISTER_FLOOR = 8;

export interface SupervisedRuntimeOptions {
  readonly runtime: ForeignRuntimeId;
  readonly hostEnv?: Readonly<Record<string, string | undefined>>;
  readonly jobs?: WindowsJobSupervisorPort;
  readonly tiers?: SandboxTierSelectorPort;
  readonly proxy?: LoopbackAllowlistProxyPort;
  readonly mcp?: LeasedMcpServerPort;
  readonly caps?: SessionProcessCapGuardPort;
  readonly versions?: CliMinVersionGatePort;
  readonly signedPolicy?: SignedProviderPolicyEnginePort;
  readonly redactor?: PacketSecurityRedactor;
  readonly registry?: AdapterRegistry;
  readonly policy?: DeterministicSupervisionPolicyEngine;
  readonly modes?: WrappedVsStrippedModeSelector;
  readonly bus?: NormalizedRuntimeEventBus;
  readonly spawn?: (request: ForeignSpawnRequest) => ForeignProcess;
  readonly version?: () => string | null;
  readonly auth?: () => AuthStatus;
  readonly command?: string;
  readonly args?: readonly string[];
  readonly turnLog?: MemoryTurnLog;
}

interface PendingPermission {
  readonly requestId: string;
  readonly request: SupervisionRequest;
  readonly decision: PolicyDecision | null;
}

interface LiveSession {
  readonly spec: SessionStartSpec;
  readonly handle: SessionHandle;
  readonly cwd: string;
  readonly homeDir: string;
  readonly appData: string;
  readonly steering: string[];
  usage: NormalizedUsage;
  readonly pending: Map<string, PendingPermission>;
  settled: boolean;
  readonly resumeSupported: boolean;
  turnCount: number;
}

interface SettleResult {
  readonly denied: readonly { readonly requestId: string; readonly reason: string }[];
  readonly killedPids: readonly number[];
}

/**
 * Reference `AgentRuntimeAdapter`: sandbox, job, proxy, scrubbed env, policy,
 * normalized events, and interrupt teardown. Vendor adapters keep this contract.
 */
export class SupervisedAgentRuntime implements AgentRuntimeAdapter {
  readonly runtime: ForeignRuntimeId;
  readonly bus: NormalizedRuntimeEventBus;
  readonly turnLog: MemoryTurnLog;
  private readonly hostEnv: Readonly<Record<string, string | undefined>>;
  private readonly tiers: SandboxTierSelectorPort;
  private readonly caps: SessionProcessCapGuardPort;
  private readonly versions: CliMinVersionGatePort;
  private readonly signedPolicy: SignedProviderPolicyEnginePort;
  private readonly redactor: PacketSecurityRedactor;
  private readonly registry: AdapterRegistry | undefined;
  private readonly policy: DeterministicSupervisionPolicyEngine;
  private readonly modes: WrappedVsStrippedModeSelector;
  private readonly sandbox: MandatorySandboxSupervisor;
  private readonly spawn: (request: ForeignSpawnRequest) => ForeignProcess;
  private readonly readVersion: () => string | null;
  private readonly readAuth: () => AuthStatus;
  private readonly command: string;
  private readonly args: readonly string[];
  private readonly sessions = new Map<string, LiveSession>();

  constructor(options: SupervisedRuntimeOptions) {
    this.runtime = options.runtime;
    this.hostEnv = options.hostEnv ?? process.env;
    const jobs = options.jobs ?? new PidTrackingJobSupervisor();
    this.tiers = options.tiers ?? new LocalSandboxTierSelector();
    this.caps = options.caps ?? new LocalSessionProcessCap();
    this.versions = options.versions ?? new LocalCliMinVersionGate();
    this.signedPolicy = options.signedPolicy ?? new LocalSignedProviderPolicy();
    this.redactor = options.redactor ?? new LocalPacketSecurityRedactor();
    this.bus = options.bus ?? new NormalizedRuntimeEventBus(this.redactor);
    this.registry = options.registry;
    this.policy = options.policy ?? new DeterministicSupervisionPolicyEngine();
    this.modes = options.modes ?? new WrappedVsStrippedModeSelector();
    this.sandbox = new MandatorySandboxSupervisor(
      jobs,
      options.proxy ?? new LocalLoopbackAllowlistProxy(),
      options.mcp ?? new LocalLeasedMcpServer(),
    );
    this.spawn = options.spawn ?? spawnForeignProcess;
    this.turnLog = options.turnLog ?? new MemoryTurnLog();
    this.readVersion = options.version ?? (() => null);
    this.readAuth =
      options.auth ??
      (() => ({ signedIn: false, expiresAt: null, quota: null, source: "none" }));
    this.command = options.command ?? process.execPath;
    this.args = options.args ?? ["-e", "setInterval(() => {}, 1000000)"];
  }

  async probe(): Promise<ProbeResult> {
    const version = this.readVersion();
    const gate = this.versions.evaluate(this.runtime, version ?? "");
    const compliance = this.signedPolicy.complianceForRuntime(this.runtime);
    let status: ProbeStatus = "ready";
    if (!version || gate.reason === "missing") status = "missing";
    else if (gate.reason === "below_minimum") status = "version_too_old";
    else if (!compliance.compliant) status = "non_compliant";
    const launchCodingTasks = status === "ready" && gate.launchCodingTasks && compliance.compliant;
    return {
      runtime: this.runtime,
      installed: Boolean(version) && gate.reason !== "missing",
      version,
      status,
      compliant: compliance.compliant,
      complianceReason: compliance.reason,
      minVersion: gate.minVersion,
      gateReason: gate.reason,
      modes: ["wrapped", "stripped"],
      launchCodingTasks,
    };
  }

  async authStatus(): Promise<AuthStatus> {
    return this.readAuth();
  }

  async startSession(spec: SessionStartSpec): Promise<SessionHandle> {
    if (spec.sessionId.trim().length === 0) {
      throw new SupervisionError("invalid_session", "sessionId is required");
    }
    if (this.sessions.has(spec.sessionId)) {
      throw new SupervisionError("session_exists", `Session ${spec.sessionId} already exists`);
    }
    if (this.registry) this.registry.assignCodingTask(this.runtime);
    const probed = await this.probe();
    if (!probed.launchCodingTasks) {
      throw new SupervisionError("launch_blocked", `${this.runtime} probe status is ${probed.status}`);
    }
    const choice = await this.tiers.selectTier({
      runtime: this.runtime,
      worktreeRoot: spec.worktreeRoot,
      requestedMode: spec.requestedMode ?? "wrapped",
    });
    if (choice.hold) throw new SupervisionError("sandbox_unavailable", choice.reason);
    const mode = this.modes.select({
      ...(spec.requestedMode ? { requestedMode: spec.requestedMode } : {}),
      tighterIsolation: spec.tighterIsolation === true,
      nativeHooksConformant: spec.nativeHooksConformant !== false,
      tier: choice.tier,
      tierHeld: false,
    });
    const envelope = await this.sandbox.prepare({
      sessionId: spec.sessionId,
      runtime: this.runtime,
      choice,
      mode,
    });
    const authorized: Record<string, string> = { ...envelope.proxy.env };
    for (const [key, value] of Object.entries(spec.credentialEnv ?? {})) {
      authorized[key] = value;
      if (value.length >= SECRET_REGISTER_FLOOR) this.redactor.register(key, value);
    }
    const environment = scrubChildEnvironment(this.hostEnv, authorized);
    const cwd = path.resolve(spec.cwd ?? spec.worktreeRoot);
    try {
      this.caps.spawn({ sessionId: spec.sessionId, runtime: this.runtime });
    } catch (error) {
      this.sandbox.kill(envelope.jobId, "session_cap");
      throw error;
    }
    let child: ForeignProcess | null = null;
    try {
      child = this.spawn({
        sessionId: spec.sessionId,
        command: spec.command ?? this.command,
        args: [...(spec.args ?? this.args)],
        cwd,
        env: environment,
        jobId: envelope.jobId,
      });
      this.sandbox.attach(envelope.jobId, child.pid);
      child.release();
    } catch (error) {
      this.caps.endSession(spec.sessionId);
      this.sandbox.kill(envelope.jobId, "spawn_failed");
      if (child) killProcessTree(child.pid);
      throw error;
    }
    const handle: SessionHandle = {
      sessionId: spec.sessionId,
      runtime: this.runtime,
      mode: mode.mode,
      modeReason: mode.reason,
      jobId: envelope.jobId,
      sandboxTier: envelope.tier,
      proxyEndpoint: envelope.proxy.endpoint,
      mcpLeaseId: envelope.mcp.leaseId,
      mcpEndpoint: envelope.mcp.endpoint,
      mcpTools: envelope.mcp.tools,
      pid: child.pid,
      nativeFileTools: mode.nativeFileTools,
      nativeShell: mode.nativeShell,
      nativeWeb: mode.nativeWeb,
      environment,
    };
    const live: LiveSession = {
      spec,
      handle,
      cwd,
      homeDir: spec.homeDir ?? os.homedir(),
      appData: spec.appData ?? process.env.APPDATA ?? "",
      steering: [],
      usage: normalizeUsage({}),
      pending: new Map(),
      settled: false,
      resumeSupported: spec.resumeSupported !== false,
      turnCount: 0,
    };
    this.sessions.set(spec.sessionId, live);
    this.watchPipes(spec.sessionId, child);
    return handle;
  }

  async sendTurn(sessionId: string, briefOrPrompt: string): Promise<TurnReceipt> {
    const live = this.requireOpen(sessionId);
    const notes = live.steering.splice(0, live.steering.length);
    const deliveredPrompt = [briefOrPrompt, ...notes].filter((part) => part.trim().length > 0).join("\n\n");
    live.turnCount += 1;
    const turnId = `${sessionId}-turn-${live.turnCount}`;
    this.caps.markBusy(sessionId, true);
    this.emit(sessionId, { type: "turn_started", turnId });
    return { sessionId, turnId, deliveredPrompt };
  }

  async steer(sessionId: string, deltaNote: string): Promise<SteerReceipt> {
    const live = this.requireOpen(sessionId);
    if (deltaNote.trim().length === 0) {
      throw new SupervisionError("empty_steer", "Steering note is empty");
    }
    live.steering.push(deltaNote);
    return { sessionId, queued: true };
  }

  async interrupt(sessionId: string): Promise<InterruptResult> {
    const started = performance.now();
    const settled = this.settle(sessionId, "stopped", null, USER_STOPPED_REASON);
    return {
      sessionId,
      denied: settled.denied,
      killedPids: settled.killedPids,
      elapsedMs: performance.now() - started,
    };
  }

  async resume(sessionId: string, checkpointRef: string): Promise<ResumeResult> {
    const live = this.require(sessionId);
    if (!live.resumeSupported) {
      return { supported: false, reason: "unsupported_resume", sessionId, checkpointRef };
    }
    return { supported: true, reason: "resumed", sessionId, checkpointRef };
  }

  events(sessionId: string): AsyncIterable<NormalizedRuntimeEvent> {
    this.require(sessionId);
    return this.bus.subscribe(sessionId);
  }

  respondPermission(sessionId: string, requestId: string, decision: PermissionReply): PermissionReply {
    const live = this.require(sessionId);
    const pending = live.pending.get(requestId);
    if (!pending) {
      throw new SupervisionError("unknown_permission", `No pending permission ${requestId}`);
    }
    const policy = pending.decision ?? this.policy.decide(pending.request, this.contextFor(live));
    const reply = applyPermission(decision, policy);
    live.pending.delete(requestId);
    this.emit(
      sessionId,
      reply.reason === undefined
        ? { type: "permission_decided", requestId, effect: reply.effect }
        : { type: "permission_decided", requestId, effect: reply.effect, reason: reply.reason },
    );
    return reply;
  }

  usage(sessionId: string): NormalizedUsage {
    return this.require(sessionId).usage;
  }

  requestPermission(sessionId: string, requestId: string, request: SupervisionRequest): PolicyDecision {
    const live = this.requireOpen(sessionId);
    const decision = this.policy.decide(request, this.contextFor(live));
    live.pending.set(requestId, { requestId, request, decision });
    this.emit(sessionId, { type: "permission_requested", requestId, request });
    return decision;
  }

  ingest(sessionId: string, raw: ForeignRawEvent): readonly NormalizedRuntimeEvent[] {
    const live = this.require(sessionId);
    const events = this.bus.ingest(sessionId, raw);
    for (const event of events) {
      this.turnLog.append({ sessionId, stream: "event", text: JSON.stringify(event) });
      if (event.type === "permission_requested" && !live.pending.has(event.requestId)) {
        live.pending.set(event.requestId, { requestId: event.requestId, request: event.request, decision: null });
      }
      if (event.type === "usage_reported") live.usage = event.usage;
      if (event.type === "turn_completed") this.caps.markBusy(sessionId, false);
      if (event.type === "session_exited") this.finishForeignExit(live, event.disposition);
    }
    return events;
  }

  private watchPipes(sessionId: string, child: ForeignProcess): void {
    const stdout = new RedactingLineBuffer(this.redactor);
    const stderr = new RedactingLineBuffer(this.redactor);
    const append = (stream: "stdout" | "stderr") => (line: string) => {
      this.turnLog.append({ sessionId, stream, text: line });
    };
    child.onStdout((chunk) => stdout.push(chunk, append("stdout")));
    child.onStderr((chunk) => stderr.push(chunk, append("stderr")));
    child.onExit((code) => {
      stdout.flush(append("stdout"));
      stderr.flush(append("stderr"));
      this.settle(sessionId, exitDisposition(code), code, "session_exited");
    });
  }

  private settle(
    sessionId: string,
    disposition: SessionDisposition,
    exitCode: number | null,
    denyReason: string,
  ): SettleResult {
    const live = this.require(sessionId);
    if (live.settled) return { denied: [], killedPids: [] };
    const denied: { requestId: string; reason: string }[] = [];
    for (const requestId of [...live.pending.keys()]) {
      const reply = this.respondPermission(sessionId, requestId, { effect: "deny", reason: denyReason });
      denied.push({ requestId, reason: reply.reason ?? denyReason });
    }
    live.settled = true;
    const killedPids = this.sandbox.kill(live.handle.jobId, disposition);
    this.caps.markBusy(sessionId, false);
    this.caps.endSession(sessionId);
    this.emit(sessionId, {
      type: "session_exited",
      disposition,
      exitCode,
      handoff: disposition === "abnormal" ? "Task 150" : null,
    });
    this.bus.close(sessionId);
    return { denied, killedPids };
  }

  private finishForeignExit(live: LiveSession, disposition: SessionDisposition): void {
    if (live.settled) return;
    live.settled = true;
    for (const requestId of [...live.pending.keys()]) {
      this.respondPermission(live.handle.sessionId, requestId, { effect: "deny", reason: "session_exited" });
    }
    this.sandbox.kill(live.handle.jobId, disposition);
    this.caps.markBusy(live.handle.sessionId, false);
    this.caps.endSession(live.handle.sessionId);
    this.bus.close(live.handle.sessionId);
  }

  private emit(sessionId: string, draft: RuntimeEventDraft): NormalizedRuntimeEvent {
    const event = this.bus.publish(sessionId, draft);
    this.turnLog.append({ sessionId, stream: "event", text: JSON.stringify(event) });
    return event;
  }

  private contextFor(live: LiveSession): SupervisionContext {
    return {
      sessionId: live.handle.sessionId,
      worktreeRoot: live.spec.worktreeRoot,
      cwd: live.cwd,
      writeScope: live.spec.writeScope,
      readOnlyPaths: live.spec.readOnlyPaths ?? [],
      sealedPaths: live.spec.sealedPaths ?? [],
      mode: live.handle.mode,
      homeDir: live.homeDir,
      appData: live.appData,
      leasedTools: live.handle.mcpTools,
    };
  }

  private require(sessionId: string): LiveSession {
    const live = this.sessions.get(sessionId);
    if (!live) throw new SupervisionError("unknown_session", `Unknown session ${sessionId}`);
    return live;
  }

  private requireOpen(sessionId: string): LiveSession {
    const live = this.require(sessionId);
    if (live.settled) throw new SupervisionError("session_closed", `Session ${sessionId} is closed`);
    return live;
  }
}

function applyPermission(decision: PermissionReply, policy: PolicyDecision): PermissionReply {
  if (decision.effect === "deny") {
    return decision.reason === undefined ? { effect: "deny" } : { effect: "deny", reason: decision.reason };
  }
  if (policy.effect === "allow") return { effect: "allow" };
  return { effect: "deny", reason: policy.reason };
}
