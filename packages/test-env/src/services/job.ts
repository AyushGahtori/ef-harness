import { randomUUID } from "node:crypto";
import {
  WindowsJobObjectManager,
  type JobHandle as SandboxJobHandle,
  type OrphanSweepReport,
  type ProjectStateDb as JobProcessRegistry,
} from "@ef-harness/sandbox";

/** Win32 `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`. */
export const JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x2000;

export const JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE_NAME = "JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE" as const;

export interface JobLimits {
  readonly killOnJobClose: true;
  readonly jobMemoryBytes?: number;
  readonly activeProcessLimit?: number;
}

export interface JobHandle {
  readonly id: string;
  readonly name: string;
  readonly limits: JobLimits;
  readonly killOnCloseFlag: typeof JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE_NAME;
  readonly nativeLimit: typeof JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
}

export interface JobAccounting {
  readonly activeProcesses: number;
  readonly pids: readonly number[];
  readonly native: boolean;
}

/**
 * Consumer port for the sandbox `WindowsJobObjectManager`.
 * Every backing-service child is assigned only when the job carries
 * `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`.
 */
export interface WindowsJobManager {
  createJob(name: string, limits: JobLimits): Promise<JobHandle>;
  assignProcess(job: JobHandle, pid: number): Promise<void>;
  queryJobAccounting(job: JobHandle): Promise<JobAccounting>;
  terminateJob(job: JobHandle): Promise<void>;
  reconcileOrphanedProcesses(): Promise<OrphanSweepReport>;
}

interface LiveJob {
  handle: JobHandle;
  pids: Set<number>;
  nativePids: Set<number>;
  sandbox: SandboxJobHandle | null;
}

export interface TrackingWindowsJobManagerOptions {
  readonly registry?: JobProcessRegistry;
}

/**
 * On Windows this opens a real Job Object through `WindowsJobObjectManager`
 * and assigns child PIDs into it. The manager reads `env_processes` only from
 * the injected writer-backed registry. Other platforms track PIDs and
 * terminate them explicitly.
 */
export class TrackingWindowsJobManager implements WindowsJobManager {
  readonly assignments: { jobId: string; pid: number }[] = [];
  private readonly jobs = new Map<string, LiveJob>();
  private readonly registry: JobProcessRegistry | undefined;
  private native: WindowsJobObjectManager | null = null;

  constructor(options: TrackingWindowsJobManagerOptions = {}) {
    this.registry = options.registry;
  }

  async createJob(name: string, limits: JobLimits): Promise<JobHandle> {
    if (limits.killOnJobClose !== true) {
      throw new Error(`${JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE_NAME} is required`);
    }
    const handle: JobHandle = {
      id: randomUUID(),
      name,
      limits,
      killOnCloseFlag: JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE_NAME,
      nativeLimit: JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };
    const sandbox = process.platform === "win32" ? await this.openWindowsJob(name, limits) : null;
    this.jobs.set(handle.id, { handle, pids: new Set(), nativePids: new Set(), sandbox });
    return handle;
  }

  async assignProcess(job: JobHandle, pid: number): Promise<void> {
    assertKillOnClose(job);
    if (!Number.isInteger(pid) || pid <= 0) {
      throw new Error(`refusing to assign an invalid pid ${pid}`);
    }
    const live = this.lookup(job);
    if (process.platform === "win32") {
      if (!live.sandbox) throw new Error(`job ${job.name} has no Windows job object`);
      await this.requireNative().assignProcess(live.sandbox, pid);
      live.nativePids.add(pid);
    }
    live.pids.add(pid);
    this.assignments.push({ jobId: job.id, pid });
  }

  async queryJobAccounting(job: JobHandle): Promise<JobAccounting> {
    const live = this.lookup(job);
    if (process.platform === "win32" && live.sandbox) {
      const accounting = await this.requireNative().queryJobAccounting(live.sandbox);
      return {
        activeProcesses: accounting.activeProcesses,
        pids: [...live.pids],
        native: true,
      };
    }
    return {
      activeProcesses: live.pids.size,
      pids: [...live.pids],
      native: live.nativePids.size > 0,
    };
  }

  reconcileOrphanedProcesses(): Promise<OrphanSweepReport> {
    return this.requireNative().reconcileOrphanedProcesses();
  }

  private lookup(job: JobHandle): LiveJob {
    const live = this.jobs.get(job.id);
    if (!live) throw new Error(`unknown job ${job.name}`);
    return live;
  }

  async terminateJob(job: JobHandle): Promise<void> {
    const live = this.jobs.get(job.id);
    if (!live) return;
    if (live.sandbox) {
      const native = this.requireNative();
      await native.terminateJob(live.sandbox);
      await native.closeJob(live.sandbox);
    }
    for (const pid of live.pids) {
      if (!live.nativePids.has(pid)) signalPid(pid);
    }
    live.pids.clear();
    this.jobs.delete(job.id);
  }

  private async openWindowsJob(name: string, limits: JobLimits): Promise<SandboxJobHandle> {
    const memoryBytes = limits.jobMemoryBytes ?? 512 * 1024 * 1024;
    const activeProcessLimit = limits.activeProcessLimit ?? 64;
    return this.requireNative().createJob({
      name,
      kind: "project",
      limits: { memoryBytes, activeProcessLimit },
    });
  }

  private requireNative(): WindowsJobObjectManager {
    if (this.native) return this.native;
    const registry = this.registry;
    if (!registry) {
      throw new Error("WindowsJobObjectManager requires a writer-backed env_processes registry");
    }
    this.native = new WindowsJobObjectManager({ registry });
    return this.native;
  }
}

function assertKillOnClose(job: JobHandle): void {
  if (
    job.limits.killOnJobClose !== true ||
    job.killOnCloseFlag !== JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE_NAME ||
    job.nativeLimit !== JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
  ) {
    throw new Error(
      `refusing to assign a process to a job without ${JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE_NAME}`,
    );
  }
}

function signalPid(pid: number): void {
  try {
    process.kill(pid);
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? error.code : "";
    if (code === "ESRCH") return;
    throw error;
  }
}

export function pidIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? error.code : "";
    if (code === "ESRCH") return false;
    throw error;
  }
}
