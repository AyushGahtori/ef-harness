import { SupervisionError } from "./errors.js";
import type { NormalizedRuntimeEvent } from "./runtime-event.js";
import type { ExecutionMode, ForeignRuntimeId, NormalizedUsage, PermissionReply, SandboxTierId } from "./types.js";

export const AGENT_RUNTIME_ADAPTER_METHODS = [
  "probe",
  "authStatus",
  "startSession",
  "sendTurn",
  "steer",
  "interrupt",
  "resume",
  "events",
  "respondPermission",
  "usage",
] as const;

export type AgentRuntimeAdapterMethod = (typeof AGENT_RUNTIME_ADAPTER_METHODS)[number];

export type ProbeStatus = "ready" | "missing" | "version_too_old" | "non_compliant";

export interface ProbeResult {
  readonly runtime: ForeignRuntimeId;
  readonly installed: boolean;
  readonly version: string | null;
  readonly status: ProbeStatus;
  readonly compliant: boolean;
  readonly complianceReason: string;
  readonly minVersion: string | null;
  readonly gateReason: "ok" | "missing" | "below_minimum" | "unknown_runtime";
  readonly modes: readonly ExecutionMode[];
  readonly launchCodingTasks: boolean;
}

export interface AuthQuota {
  readonly remainingPercent: number | null;
  readonly resetsAt: string | null;
}

export interface AuthStatus {
  readonly signedIn: boolean;
  readonly expiresAt: string | null;
  readonly quota: AuthQuota | null;
  readonly source: "injected" | "vendor_login" | "none";
}

export interface SessionStartSpec {
  readonly sessionId: string;
  readonly worktreeRoot: string;
  readonly cwd?: string;
  readonly writeScope: readonly string[];
  readonly readOnlyPaths?: readonly string[];
  readonly sealedPaths?: readonly string[];
  readonly brief: string;
  readonly requestedMode?: ExecutionMode;
  readonly tighterIsolation?: boolean;
  readonly nativeHooksConformant?: boolean;
  readonly credentialEnv?: Readonly<Record<string, string>>;
  readonly homeDir?: string;
  readonly appData?: string;
  readonly resumeSupported?: boolean;
  readonly command?: string;
  readonly args?: readonly string[];
}

export interface SessionHandle {
  readonly sessionId: string;
  readonly runtime: ForeignRuntimeId;
  readonly mode: ExecutionMode;
  readonly modeReason: string;
  readonly jobId: string;
  readonly sandboxTier: SandboxTierId;
  readonly proxyEndpoint: string;
  readonly mcpLeaseId: string;
  readonly mcpEndpoint: string;
  readonly mcpTools: readonly string[];
  readonly pid: number;
  readonly nativeFileTools: boolean;
  readonly nativeShell: boolean;
  readonly nativeWeb: boolean;
  readonly environment: Readonly<Record<string, string>>;
}

export interface TurnReceipt {
  readonly sessionId: string;
  readonly turnId: string;
  readonly deliveredPrompt: string;
}

export interface SteerReceipt {
  readonly sessionId: string;
  readonly queued: true;
}

export interface InterruptResult {
  readonly sessionId: string;
  readonly denied: readonly { readonly requestId: string; readonly reason: string }[];
  readonly killedPids: readonly number[];
  readonly elapsedMs: number;
}

export interface ResumeResult {
  readonly supported: boolean;
  readonly reason: "unsupported_resume" | "resumed";
  readonly sessionId: string;
  readonly checkpointRef: string;
}

/**
 * The only lifecycle surface a foreign coding runtime may expose to the kernel.
 * Ten methods, same order for every vendor adapter.
 */
export interface AgentRuntimeAdapter {
  readonly runtime: ForeignRuntimeId;
  probe(): Promise<ProbeResult>;
  authStatus(): Promise<AuthStatus>;
  startSession(spec: SessionStartSpec): Promise<SessionHandle>;
  sendTurn(sessionId: string, briefOrPrompt: string): Promise<TurnReceipt>;
  steer(sessionId: string, deltaNote: string): Promise<SteerReceipt>;
  interrupt(sessionId: string): Promise<InterruptResult>;
  resume(sessionId: string, checkpointRef: string): Promise<ResumeResult>;
  events(sessionId: string): AsyncIterable<NormalizedRuntimeEvent>;
  respondPermission(sessionId: string, requestId: string, decision: PermissionReply): PermissionReply;
  usage(sessionId: string): NormalizedUsage;
}

export function assertAgentRuntimeAdapter(value: unknown): asserts value is AgentRuntimeAdapter {
  if (!value || typeof value !== "object") {
    throw new SupervisionError("adapter_contract", "Adapter must be an object");
  }
  if (AGENT_RUNTIME_ADAPTER_METHODS.length !== 10) {
    throw new SupervisionError("adapter_contract", "The adapter contract must list exactly 10 methods");
  }
  const record = value as Record<string, unknown>;
  const missing = AGENT_RUNTIME_ADAPTER_METHODS.filter((name) => typeof record[name] !== "function");
  if (missing.length > 0) {
    throw new SupervisionError("adapter_contract", `Adapter is missing ${missing.join(", ")}`);
  }
  if (typeof record.runtime !== "string" || record.runtime.length === 0) {
    throw new SupervisionError("adapter_contract", "Adapter must name its runtime");
  }
}
