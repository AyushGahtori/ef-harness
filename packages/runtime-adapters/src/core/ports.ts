import { spawnSync } from "node:child_process";
import type { ExecutionMode, ForeignRuntimeId, SandboxTierId } from "./types.js";
import { SupervisionError } from "./errors.js";
import { assignWindowsJob, terminateWindowsJob } from "./windows-job.js";

/**
 * Local ports for sibling tasks that are not on the foundation base.
 * Swap each class for the real export named in `.agent-handoffs/task-142.md`.
 */

export interface CliGateDecision {
  readonly launchCodingTasks: boolean;
  readonly status: "allowed" | "disabled";
  readonly reason: "ok" | "missing" | "below_minimum" | "unknown_runtime";
  readonly minVersion: string | null;
}

/** Task 135 `CliMinVersionGate.evaluate`. */
export interface CliMinVersionGatePort {
  evaluate(runtime: string, installedVersion: string): CliGateDecision;
}

/** Slice of Task 135 `SignedProviderPolicyEngine` used by `probe()`. */
export interface SignedProviderPolicyEnginePort {
  complianceForRuntime(runtime: string): { readonly compliant: boolean; readonly reason: string };
}

export interface JobAssignment {
  readonly jobId: string;
}

/**
 * Task text names `WindowsJobSupervisor` (Task 041). The published process-tree
 * primitive on the sibling branch is Task 040 `WindowsJobManager`.
 */
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

/**
 * Task text names `SandboxTierSelector` (Task 045). The published class is
 * Task 043 `SandboxTierSelector.resolve`.
 */
export interface SandboxTierSelectorPort {
  selectTier(input: {
    readonly runtime: string;
    readonly worktreeRoot: string;
    readonly requestedMode: ExecutionMode;
  }): SandboxTierChoice | Promise<SandboxTierChoice>;
}

/** Task 046 loopback allowlist proxy. */
export interface ProxyBinding {
  readonly endpoint: string;
  readonly env: Readonly<Record<string, string>>;
}

export interface LoopbackAllowlistProxyPort {
  bind(input: {
    readonly sessionId: string;
    readonly tier: SandboxTierId;
  }): ProxyBinding | Promise<ProxyBinding>;
}

/** Task text names `LeasedMcpServer` (Task 049). */
export interface McpLease {
  readonly leaseId: string;
  readonly endpoint: string;
  readonly tools: readonly string[];
}

export interface LeasedMcpServerPort {
  lease(input: {
    readonly sessionId: string;
    readonly tools: readonly string[];
  }): McpLease | Promise<McpLease>;
}

/** Task 119 `SessionProcessCapGuard`. */
export interface SessionProcessCapGuardPort {
  spawn(input: { readonly sessionId: string; readonly runtime: ForeignRuntimeId }): void;
  markBusy(sessionId: string, busy: boolean): void;
  endSession(sessionId: string): void;
}

/** Task 011 `SecretRedactor`, named `PacketSecurityRedactor` by this task. */
export interface PacketSecurityRedactor {
  register(label: string, value: string): void;
  forget(label: string): boolean;
  redact(text: string): string;
  redactValue(value: unknown): unknown;
}

export const DEFAULT_LEASED_MCP_TOOLS = ["kb.*", "harness.run", "harness.read_result"] as const;

const RUNTIME_FLOOR_ALIASES: Readonly<Record<string, string>> = {
  "claude-code": "claude",
  cursor: "cursor-agent",
  "gemini-cli": "gemini",
};

export class LocalCliMinVersionGate implements CliMinVersionGatePort {
  private readonly floors = new Map<string, string>();

  constructor(floors: Readonly<Record<string, string>> = {}) {
    for (const [runtime, version] of Object.entries(floors)) {
      this.floors.set(runtime, version);
      const alias = RUNTIME_FLOOR_ALIASES[runtime];
      if (alias) this.floors.set(alias, version);
    }
  }

  evaluate(runtime: string, installedVersion: string): CliGateDecision {
    const floor = this.floors.get(runtime) ?? this.floors.get(RUNTIME_FLOOR_ALIASES[runtime] ?? "") ?? null;
    if (!floor) {
      return { launchCodingTasks: true, status: "allowed", reason: "ok", minVersion: null };
    }
    if (!installedVersion.trim()) {
      return { launchCodingTasks: false, status: "disabled", reason: "missing", minVersion: floor };
    }
    if (compareSemver(installedVersion, floor) < 0) {
      return { launchCodingTasks: false, status: "disabled", reason: "below_minimum", minVersion: floor };
    }
    return { launchCodingTasks: true, status: "allowed", reason: "ok", minVersion: floor };
  }
}

export class LocalSignedProviderPolicy implements SignedProviderPolicyEnginePort {
  constructor(private readonly blocked: ReadonlyMap<string, string> = new Map()) {}

  complianceForRuntime(runtime: string): { readonly compliant: boolean; readonly reason: string } {
    const reason = this.blocked.get(runtime);
    if (reason) return { compliant: false, reason };
    return { compliant: true, reason: "signed policy allows this runtime" };
  }
}

export class PidTrackingJobSupervisor implements WindowsJobSupervisorPort {
  private readonly jobs = new Map<string, Set<number>>();

  create(sessionId: string): JobAssignment {
    const jobId = `job-${sessionId}`;
    if (this.jobs.has(jobId)) {
      throw new SupervisionError("job_exists", `Job ${jobId} already exists`);
    }
    this.jobs.set(jobId, new Set());
    return { jobId };
  }

  attach(jobId: string, pid: number): void {
    const pids = this.require(jobId);
    if (!Number.isInteger(pid) || pid <= 0) {
      throw new SupervisionError("invalid_pid", "Job attach requires a positive pid");
    }
    if (process.platform === "win32" && !assignWindowsJob(jobId, pid)) {
      throw new SupervisionError("job_assign", `Could not assign pid ${pid} to ${jobId}`);
    }
    pids.add(pid);
  }

  list(jobId: string): readonly number[] {
    return [...this.require(jobId)];
  }

  kill(jobId: string, reason: string): readonly number[] {
    const pids = [...this.require(jobId)];
    const closed = terminateWindowsJob(jobId);
    if (!closed) {
      for (const pid of pids) killProcessTree(pid);
    }
    this.jobs.set(jobId, new Set());
    void reason;
    return pids;
  }

  private require(jobId: string): Set<number> {
    const pids = this.jobs.get(jobId);
    if (!pids) throw new SupervisionError("unknown_job", `Unknown job ${jobId}`);
    return pids;
  }
}

export function killProcessTree(pid: number): void {
  if (!Number.isInteger(pid) || pid <= 0) return;
  if (process.platform === "win32") {
    try {
      process.kill(pid, "SIGKILL");
    } catch (error) {
      if (!isMissingProcess(error)) {
        spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
          windowsHide: true,
          stdio: "ignore",
        });
        return;
      }
    }
    spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore",
    });
    return;
  }
  try {
    process.kill(pid, "SIGKILL");
  } catch (error) {
    if (!isMissingProcess(error)) throw error;
  }
}

export class LocalSandboxTierSelector implements SandboxTierSelectorPort {
  constructor(private readonly tier: SandboxTierId = "A", private readonly hold = false) {}

  selectTier(): SandboxTierChoice {
    if (this.hold) {
      return { tier: this.tier, hold: true, reason: "sandbox tier is not available for this runtime" };
    }
    return { tier: this.tier, hold: false, reason: `os sandbox tier ${this.tier}` };
  }
}

export class LocalLoopbackAllowlistProxy implements LoopbackAllowlistProxyPort {
  constructor(private readonly endpoint = "http://127.0.0.1:9") {}

  bind(input: { readonly sessionId: string; readonly tier: SandboxTierId }): ProxyBinding {
    return {
      endpoint: this.endpoint,
      env: {
        HTTP_PROXY: this.endpoint,
        HTTPS_PROXY: this.endpoint,
        NO_PROXY: "127.0.0.1,localhost",
        EF_HARNESS_PROXY_SESSION: input.sessionId,
        EF_HARNESS_SANDBOX_TIER: input.tier,
      },
    };
  }
}

export class LocalLeasedMcpServer implements LeasedMcpServerPort {
  lease(input: { readonly sessionId: string; readonly tools: readonly string[] }): McpLease {
    return {
      leaseId: `lease-${input.sessionId}`,
      endpoint: `http://127.0.0.1:9/mcp/${input.sessionId}`,
      tools: input.tools,
    };
  }
}

export class LocalSessionProcessCap implements SessionProcessCapGuardPort {
  private readonly resident = new Set<string>();

  constructor(private readonly cap = 8) {}

  spawn(input: { readonly sessionId: string; readonly runtime: ForeignRuntimeId }): void {
    if (this.resident.has(input.sessionId)) {
      throw new SupervisionError("session_exists", `Foreign session ${input.sessionId} already exists`);
    }
    if (this.resident.size >= this.cap) {
      throw new SupervisionError("session_cap", `Foreign session cap ${this.cap} is full`);
    }
    this.resident.add(input.sessionId);
  }

  markBusy(): void {
    return;
  }

  endSession(sessionId: string): void {
    this.resident.delete(sessionId);
  }
}

function compareSemver(installed: string, minimum: string): number {
  const left = parseSemver(installed);
  const right = parseSemver(minimum);
  if (!left || !right) return -1;
  for (let i = 0; i < 3; i += 1) {
    const a = left[i] ?? 0;
    const b = right[i] ?? 0;
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
  return typeof error === "object" && error !== null && "code" in error && error.code === "ESRCH";
}
