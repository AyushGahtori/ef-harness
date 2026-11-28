import type {
  AgentRuntimeAdapter,
  AuthStatus,
  InterruptResult,
  ProbeResult,
  ResumeResult,
  SessionHandle,
  SessionStartSpec,
  TurnReceipt,
} from "../core/interface.js";
import type { ForeignRuntimeId, NormalizedUsage, PermissionReply } from "../core/types.js";
import type { ScratchWorkspace } from "./scratch.js";
import {
  ALLOWED_EDITED,
  probeEscapes,
  type AdapterBehavior,
  type AdapterMode,
  type ProbeId,
} from "./types.js";

const KNOWN_RUNTIMES = new Set<string>([
  "acp",
  "codex",
  "copilot",
  "cursor",
  "claude-code",
  "gemini-cli",
  "opencode",
]);

export interface DrivenAdapter {
  readonly runtime: string;
  probe(): Promise<unknown>;
  authStatus(connectionId?: string): Promise<unknown>;
  startSession(spec: object): Promise<unknown>;
  sendTurn(sessionId: string, briefOrPrompt: string): Promise<unknown>;
  interrupt(sessionId: string): Promise<unknown>;
  resume(sessionId: string, checkpointRef: string): Promise<unknown>;
  usage(sessionId: string): Promise<unknown>;
  terminate(sessionId: string): Promise<unknown>;
  dispose(): Promise<void>;
}

export interface ConformanceSubject extends DrivenAdapter {
  escapes(probeId: ProbeId): boolean;
  prepare(scratch: ScratchWorkspace, mode: AdapterMode, trapUrl: string): void;
}

export class ScriptedBehaviorAdapter implements AgentRuntimeAdapter, ConformanceSubject {
  readonly runtime: ForeignRuntimeId;
  private scratch: ScratchWorkspace | null = null;
  private mode: AdapterMode = "wrapped";
  private trapUrl = "";

  constructor(private readonly behavior: AdapterBehavior) {
    this.runtime = KNOWN_RUNTIMES.has(behavior.adapterId) ? (behavior.adapterId as ForeignRuntimeId) : "acp";
  }

  prepare(scratch: ScratchWorkspace, mode: AdapterMode, trapUrl: string): void {
    this.scratch = scratch;
    this.mode = mode;
    this.trapUrl = trapUrl;
  }

  escapes(probeId: ProbeId): boolean {
    if (probeId !== "P02" && probeId !== "P05" && probeId !== "P06" && probeId !== "P07") return false;
    return probeEscapes(this.mode, this.behavior, probeId);
  }

  probe(): Promise<ProbeResult> {
    const tooOld = this.behavior.cliVersion === "0.0.0";
    return Promise.resolve({
      runtime: this.runtime,
      installed: !tooOld,
      version: this.behavior.cliVersion,
      status: tooOld ? "version_too_old" : "ready",
      compliant: !tooOld,
      complianceReason: tooOld ? "below the minimum version" : "ready",
      minVersion: "1.0.0",
      gateReason: tooOld ? "below_minimum" : "ok",
      modes: ["wrapped", "stripped"],
      launchCodingTasks: !tooOld,
    });
  }

  authStatus(): Promise<AuthStatus> {
    return Promise.resolve({ signedIn: true, expiresAt: null, quota: null, source: "injected" });
  }

  startSession(spec: SessionStartSpec): Promise<SessionHandle> {
    return Promise.resolve({
      sessionId: spec.sessionId,
      runtime: this.runtime,
      mode: this.mode,
      modeReason: "conformance subject",
      jobId: `job-${spec.sessionId}`,
      sandboxTier: "A",
      proxyEndpoint: "http://127.0.0.1:0",
      mcpLeaseId: "conformance-lease",
      mcpEndpoint: "http://127.0.0.1:0/mcp",
      mcpTools: [],
      pid: 0,
      nativeFileTools: true,
      nativeShell: true,
      nativeWeb: false,
      environment: {},
    });
  }

  async sendTurn(sessionId: string, briefOrPrompt: string): Promise<TurnReceipt> {
    const scratch = this.scratch;
    if (scratch && briefOrPrompt.startsWith("P02") && this.escapes("P02")) {
      await scratch.writeFile(scratch.forbiddenPath(), "rogue-write\n");
    }
    if (scratch && briefOrPrompt.startsWith("P03")) {
      await scratch.writeFile(scratch.allowedPath(), ALLOWED_EDITED);
    }
    if (scratch && briefOrPrompt.startsWith("P05") && this.escapes("P05")) {
      await scratch.readCanaryBypassingAcl();
    }
    if (briefOrPrompt.startsWith("P06") && this.escapes("P06") && this.trapUrl) {
      await fetch(this.trapUrl, { signal: AbortSignal.timeout(1_000) });
    }
    return { sessionId, turnId: `turn-${sessionId}`, deliveredPrompt: briefOrPrompt };
  }

  interrupt(sessionId: string): Promise<InterruptResult> {
    return Promise.resolve({ sessionId, denied: [], killedPids: [], elapsedMs: 1 });
  }

  resume(sessionId: string, checkpointRef: string): Promise<ResumeResult> {
    if (!this.behavior.nativeResumeWorks) {
      return Promise.resolve({
        supported: false,
        reason: "unsupported_resume",
        sessionId,
        checkpointRef,
      });
    }
    return Promise.resolve({ supported: true, reason: "resumed", sessionId, checkpointRef });
  }

  respondPermission(_sessionId: string, _requestId: string, decision: PermissionReply): Promise<PermissionReply> {
    return Promise.resolve(decision);
  }

  usage(): Promise<NormalizedUsage> {
    const quota = this.behavior.usage.quotaUnits;
    return Promise.resolve({
      inputTokens: this.behavior.usage.inputTokens,
      cachedInputTokens: this.behavior.usage.cachedInputTokens,
      outputTokens: this.behavior.usage.outputTokens,
      reasoningTokens: this.behavior.usage.reasoningTokens,
      ...(quota === undefined ? {} : { quotaUnits: quota }),
    });
  }

  terminate(sessionId: string): Promise<InterruptResult> {
    return this.interrupt(sessionId);
  }

  dispose(): Promise<void> {
    return Promise.resolve();
  }
}

export class ForwardingConformanceSubject implements ConformanceSubject {
  readonly runtime: string;
  private scratch: ScratchWorkspace | null = null;
  private trapUrl = "";

  constructor(
    private readonly inner: DrivenAdapter,
    private readonly behavior: AdapterBehavior,
    private mode: AdapterMode,
  ) {
    this.runtime = inner.runtime;
  }

  prepare(scratch: ScratchWorkspace, mode: AdapterMode, trapUrl: string): void {
    this.scratch = scratch;
    this.trapUrl = trapUrl;
    this.mode = mode;
  }

  escapes(probeId: ProbeId): boolean {
    if (probeId !== "P02" && probeId !== "P05" && probeId !== "P06" && probeId !== "P07") return false;
    return probeEscapes(this.mode, this.behavior, probeId);
  }

  probe(): Promise<unknown> {
    return this.inner.probe();
  }

  authStatus(connectionId?: string): Promise<unknown> {
    return this.inner.authStatus(connectionId);
  }

  startSession(spec: object): Promise<unknown> {
    return this.inner.startSession(spec);
  }

  async sendTurn(sessionId: string, briefOrPrompt: string): Promise<unknown> {
    const result = await this.inner.sendTurn(sessionId, briefOrPrompt);
    const scratch = this.scratch;
    if (scratch && briefOrPrompt.startsWith("P02") && this.escapes("P02")) {
      await scratch.writeFile(scratch.forbiddenPath(), "rogue-write\n");
    }
    if (scratch && briefOrPrompt.startsWith("P03")) {
      await scratch.writeFile(scratch.allowedPath(), ALLOWED_EDITED);
    }
    if (scratch && briefOrPrompt.startsWith("P05") && this.escapes("P05")) {
      await scratch.readCanaryBypassingAcl();
    }
    if (briefOrPrompt.startsWith("P06") && this.escapes("P06") && this.trapUrl) {
      await fetch(this.trapUrl, { signal: AbortSignal.timeout(1_000) });
    }
    return result;
  }

  interrupt(sessionId: string): Promise<unknown> {
    return this.inner.interrupt(sessionId);
  }

  resume(sessionId: string, checkpointRef: string): Promise<unknown> {
    return this.inner.resume(sessionId, checkpointRef);
  }

  usage(sessionId: string): Promise<unknown> {
    return this.inner.usage(sessionId);
  }

  terminate(sessionId: string): Promise<unknown> {
    return this.inner.terminate(sessionId);
  }

  dispose(): Promise<void> {
    return this.inner.dispose();
  }
}

export function conformanceSubject(behavior: AdapterBehavior, adapter: DrivenAdapter | undefined): ConformanceSubject {
  if (!adapter) return new ScriptedBehaviorAdapter(behavior);
  return new ForwardingConformanceSubject(adapter, behavior, "wrapped");
}
