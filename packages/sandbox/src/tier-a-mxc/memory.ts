import type { JobAccounting, JobHandle, JobLimits, SandboxAuditEntry, SandboxAuditLogger, SandboxGovernorSink, WindowsJobManagerPort } from "./types.js";

export class MemoryJob implements JobHandle {
  readonly id: string;
  readonly pids: number[] = [];
  closed = false;
  terminatedReason: string | null = null;

  constructor(
    readonly name: string,
    readonly limits: JobLimits,
  ) {
    this.id = name;
  }

  async close(): Promise<void> {
    this.closed = true;
  }

  accounting(): JobAccounting {
    return {
      peakJobMemoryUsed: 0,
      currentWorkingSet: 0,
      totalUserTimeMs: 0,
      totalKernelTimeMs: 0,
      activeProcesses: this.closed ? 0 : this.pids.length,
    };
  }
}

export interface MemoryJobManager extends WindowsJobManagerPort {
  readonly kind: "memory";
  readonly jobs: MemoryJob[];
}

export function createMemoryJobManager(): MemoryJobManager {
  const jobs: MemoryJob[] = [];
  return {
    kind: "memory",
    jobs,
    async createJob(name, limits) {
      if (limits.killOnJobClose !== true) throw new Error("kill on close required");
      if (limits.uiRestrictions !== true) throw new Error("ui restrictions required");
      if (!Number.isFinite(limits.jobMemoryBytes) || limits.jobMemoryBytes <= 0) {
        throw new Error("memory limit required");
      }
      if (!Number.isFinite(limits.activeProcessLimit) || limits.activeProcessLimit <= 0) {
        throw new Error("process limit required");
      }
      const job = new MemoryJob(name, limits);
      jobs.push(job);
      return job;
    },
    async assignProcess(job, pid) {
      if (job instanceof MemoryJob) job.pids.push(pid);
    },
    async queryJobAccounting(job) {
      if (job instanceof MemoryJob) return job.accounting();
      return {
        peakJobMemoryUsed: 0,
        currentWorkingSet: 0,
        totalUserTimeMs: 0,
        totalKernelTimeMs: 0,
        activeProcesses: 0,
      };
    },
    async terminateJob(job, reason) {
      if (job instanceof MemoryJob) {
        job.terminatedReason = reason;
        job.closed = true;
      }
    },
  };
}

export interface MemoryAuditLog extends SandboxAuditLogger {
  readonly entries: SandboxAuditEntry[];
}

export function createMemoryAuditLog(): MemoryAuditLog {
  const entries: SandboxAuditEntry[] = [];
  return {
    entries,
    write(entry) {
      entries.push(entry);
    },
  };
}

export interface MemoryGovernor extends SandboxGovernorSink {
  readonly latencies: LaunchLatencyRecord[];
  readonly denials: DenialRecord[];
}

interface LaunchLatencyRecord {
  readonly tier: "A";
  readonly attemptId: string;
  readonly latencyMs: number;
  readonly p50Ms: number;
  readonly p95Ms: number;
}

interface DenialRecord {
  readonly type: "sandbox_denial";
  readonly tier: "A";
  readonly attemptId: string;
  readonly target: string;
  readonly access: "read" | "write" | "network";
  readonly errno: "EACCES" | "EPERM";
  readonly ruleId: string;
  readonly source: "policy" | "os";
}

export function createMemoryGovernor(): MemoryGovernor {
  const latencies: LaunchLatencyRecord[] = [];
  const denials: DenialRecord[] = [];
  return {
    latencies,
    denials,
    reportLaunchLatency(sample) {
      latencies.push(sample);
    },
    reportDenial(event) {
      denials.push(event);
    },
  };
}
