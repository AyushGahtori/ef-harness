import { spawn } from "node:child_process";
import { assertJobLimits, assertTimeout, clampNestedLimits } from "./limits.js";
import { JsonLineLogger, type StructuredLogger } from "./logger.js";
import { reconcileOrphanedProcesses } from "./reconcile.js";
import { delayFor } from "./timer.js";
import {
  JobObjectError,
  type CommandRequest,
  type CommandResult,
  type EnvProcessRow,
  type JobAccounting,
  type JobHandle,
  type JobLimits,
  type JobSpec,
  type OrphanSweepReport,
  type ProcessAssignment,
  type ProcessInspection,
  type ProcessSupervisor,
  type ProjectStateDb,
  type SpawnedProcess,
  type SpawnRequest,
  type TerminationReason,
} from "./types.js";

export interface PosixChild {
  readonly pid: number;
  wait(timeoutMs: number): Promise<{
    readonly exited: boolean;
    readonly exitCode: number | null;
    readonly stdout: string;
    readonly stderr: string;
  }>;
}

export interface PosixHost {
  spawn(spec: {
    readonly file: string;
    readonly args: readonly string[];
    readonly detached: true;
    readonly cwd?: string;
  }): PosixChild;
  killGroup(pid: number, signal: NodeJS.Signals): void;
  inspect(pid: number): ProcessInspection | Promise<ProcessInspection>;
  terminate(
    pid: number,
    startTime: number,
  ): ProcessInspection | "terminated" | Promise<ProcessInspection | "terminated">;
}

export function killPosixProcessGroup(
  pid: number,
  signal: NodeJS.Signals = "SIGKILL",
  kill: (pid: number, signal: NodeJS.Signals) => void = (target, sig) => {
    process.kill(target, sig);
  },
): void {
  kill(-pid, signal);
}

export function nodePosixHost(): PosixHost {
  return {
    spawn(spec) {
      const child = spawn(spec.file, [...spec.args], {
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
        ...(spec.cwd === undefined ? {} : { cwd: spec.cwd }),
      });
      if (!child.pid) throw new JobObjectError("spawn_failed", "posix spawn did not return a pid");
      return new NodePosixChild(child);
    },
    killGroup(pid, signal) {
      killPosixProcessGroup(pid, signal);
    },
    inspect(pid) {
      try {
        process.kill(pid, 0);
      } catch {
        return { status: "not_found", pid };
      }
      return {
        status: "unverified",
        pid,
        detail: "posix identity has no verified start_time",
      };
    },
    terminate(pid) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        return { status: "not_found", pid };
      }
      return {
        status: "unverified",
        pid,
        detail: "posix termination cannot prove start_time",
      };
    },
  };
}

class NodePosixChild implements PosixChild {
  private readonly stdoutChunks: Buffer[] = [];
  private readonly stderrChunks: Buffer[] = [];
  private exitCode: number | null = null;
  private exited = false;

  constructor(private readonly child: ReturnType<typeof spawn>) {
    child.stdout?.on("data", (chunk: Buffer) => {
      this.stdoutChunks.push(chunk);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      this.stderrChunks.push(chunk);
    });
    child.on("exit", (code) => {
      this.exited = true;
      this.exitCode = code;
    });
  }

  get pid(): number {
    return this.child.pid ?? 0;
  }

  async wait(timeoutMs: number): Promise<{
    exited: boolean;
    exitCode: number | null;
    stdout: string;
    stderr: string;
  }> {
    if (!this.exited) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, timeoutMs);
        this.child.once("exit", () => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
    return {
      exited: this.exited,
      exitCode: this.exitCode,
      stdout: Buffer.concat(this.stdoutChunks).toString("utf8"),
      stderr: Buffer.concat(this.stderrChunks).toString("utf8"),
    };
  }
}

interface LivePosixJob {
  readonly handle: JobHandle;
  readonly processes: Map<number, { readonly row: EnvProcessRow; readonly child: PosixChild | null }>;
  groupPid: number | null;
  closed: boolean;
  terminationReason: TerminationReason | null;
  timer: ReturnType<typeof setTimeout> | null;
}

export class PosixProcessGroupSupervisor implements ProcessSupervisor {
  private readonly logger: StructuredLogger;
  private readonly jobs = new Map<string, LivePosixJob>();
  private nextId = 1;
  private disposed = false;

  constructor(
    private readonly registry: ProjectStateDb,
    private readonly host: PosixHost = nodePosixHost(),
    logger?: StructuredLogger,
  ) {
    this.logger = logger ?? new JsonLineLogger();
  }

  async createJob(spec: JobSpec): Promise<JobHandle> {
    this.assertOpen();
    assertJobLimits(spec.limits, spec.kind);
    const parent = spec.parent ? this.jobs.get(spec.parent.id) : undefined;
    if (spec.parent && !parent) throw new JobObjectError("missing_job", "parent job is not open");
    const clamped = clampNestedLimits(spec.limits, parent ? parent.handle.limits : null);
    const timeoutMs = assertTimeout(spec.kind, spec.timeoutMs);
    const handle: JobHandle = {
      id: `posix-${this.nextId}`,
      name: spec.name,
      kind: spec.kind,
      parentId: spec.parent?.id ?? null,
      limits: clamped.effective,
      requestedLimits: spec.limits,
      limitsClamped: clamped.clamped,
      timeoutMs,
    };
    this.nextId += 1;
    const live: LivePosixJob = {
      handle,
      processes: new Map(),
      groupPid: null,
      closed: false,
      terminationReason: null,
      timer: null,
    };
    this.jobs.set(handle.id, live);
    if (timeoutMs !== null) this.armTimeout(live, timeoutMs);
    return handle;
  }

  async assignProcess(
    job: JobHandle,
    pid: number,
    meta?: ProcessAssignment,
  ): Promise<SpawnedProcess> {
    const live = this.require(job);
    this.noteAssignment(live, pid, null, meta ?? { environment: job.name, role: "assigned" });
    return {
      slot: pid,
      pid,
      startTime: 0,
      imagePath: null,
      commandLine: null,
    };
  }

  async spawnInJob(job: JobHandle, request: SpawnRequest): Promise<SpawnedProcess> {
    const live = this.require(job);
    if (live.processes.size >= live.handle.limits.activeProcessLimit) {
      throw new JobObjectError("active_process_limit", `posix job ${job.name} is at its process cap`);
    }
    const child = this.host.spawn({
      file: request.file,
      args: request.args,
      detached: true,
      ...(request.cwd === undefined ? {} : { cwd: request.cwd }),
    });
    if (live.groupPid === null) live.groupPid = child.pid;
    const inspection = await this.host.inspect(child.pid);
    const startTime = inspection.status === "alive" ? inspection.startTime : 0;
    this.noteAssignment(live, child.pid, child, request, startTime);
    return {
      slot: child.pid,
      pid: child.pid,
      startTime,
      imagePath: inspection.status === "alive" ? inspection.imagePath : null,
      commandLine: inspection.status === "alive" ? inspection.commandLine : null,
    };
  }

  async queryJobAccounting(job: JobHandle): Promise<JobAccounting> {
    const live = this.require(job);
    return emptyAccounting(live.handle.limits, live.processes.size);
  }

  async terminateJob(job: JobHandle): Promise<JobAccounting> {
    const live = this.require(job);
    this.killGroup(live, "terminated");
    return this.queryJobAccounting(job);
  }

  async closeJob(job: JobHandle): Promise<void> {
    const live = this.jobs.get(job.id);
    if (!live || live.closed) return;
    this.killGroup(live, "terminated");
    live.closed = true;
    if (live.timer) clearTimeout(live.timer);
    for (const tracked of live.processes.values()) {
      this.registry.deleteEnvProcess(tracked.row.pid, tracked.row.startTime);
    }
    live.processes.clear();
  }

  async runCommand(parent: JobHandle | null, request: CommandRequest): Promise<CommandResult> {
    const job = await this.createJob({
      name: request.jobName ?? `${request.environment}:${request.role}`,
      kind: "command",
      limits: request.limits,
      timeoutMs: request.timeoutMs,
      ...(parent ? { parent } : {}),
    });
    const started = process.hrtime.bigint();
    try {
      const live = this.require(job);
      const spawned = await this.spawnInJob(job, {
        file: request.file,
        args: request.args,
        environment: request.environment,
        role: request.role,
        ...(request.cwd === undefined ? {} : { cwd: request.cwd }),
        ...(request.port === undefined ? {} : { port: request.port }),
      });
      const tracked = live.processes.get(spawned.pid);
      const child = tracked?.child;
      if (!child) throw new JobObjectError("spawn_failed", "posix command has no child");
      let reason: TerminationReason = "exited";
      let exitCode: number | null = null;
      let stdout = "";
      let stderr = "";
      const status = await child.wait(request.timeoutMs);
      stdout = status.stdout;
      stderr = status.stderr;
      if (!status.exited) {
        reason = "timeout";
        this.killGroup(live, "timeout");
      } else {
        exitCode = status.exitCode;
        this.killGroup(live, "exited");
      }
      return {
        reason,
        exitCode,
        stdout,
        stderr,
        stdoutTruncated: false,
        stderrTruncated: false,
        accounting: emptyAccounting(job.limits, 0),
        pid: spawned.pid,
        startTime: spawned.startTime,
        durationMs: Math.max(0, Math.round(Number(process.hrtime.bigint() - started) / 1e6)),
        job,
      };
    } finally {
      await this.closeJob(job);
    }
  }

  reconcileOrphanedProcesses(): Promise<OrphanSweepReport> {
    return reconcileOrphanedProcesses({
      registry: this.registry,
      logger: this.logger,
      inspect: (pid) => this.host.inspect(pid),
      terminate: (pid, startTime) => this.host.terminate(pid, startTime),
    });
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    for (const live of [...this.jobs.values()]) {
      if (!live.closed) await this.closeJob(live.handle);
    }
  }

  private noteAssignment(
    live: LivePosixJob,
    pid: number,
    child: PosixChild | null,
    meta: { readonly environment: string; readonly role: string; readonly port?: number },
    startTime = 0,
  ): void {
    const row: EnvProcessRow = {
      pid,
      startTime,
      environment: meta.environment,
      role: meta.role,
      port: meta.port ?? null,
      jobName: live.handle.name,
    };
    this.registry.insertEnvProcess(row);
    live.processes.set(pid, { row, child });
  }

  private killGroup(live: LivePosixJob, reason: TerminationReason): void {
    if (live.terminationReason === null) live.terminationReason = reason;
    if (live.groupPid !== null) this.host.killGroup(live.groupPid, "SIGKILL");
  }

  private armTimeout(live: LivePosixJob, timeoutMs: number): void {
    const start = process.hrtime.bigint();
    const fire = (): void => {
      const elapsed = Number(process.hrtime.bigint() - start) / 1e6;
      if (elapsed + 15 < timeoutMs) {
        live.timer = setTimeout(fire, delayFor(timeoutMs - elapsed));
        return;
      }
      if (!live.closed) this.killGroup(live, "timeout");
    };
    live.timer = setTimeout(fire, delayFor(timeoutMs));
  }

  private require(job: JobHandle): LivePosixJob {
    const live = this.jobs.get(job.id);
    if (!live || live.closed) throw new JobObjectError("missing_job", `job ${job.name} is not open`);
    return live;
  }

  private assertOpen(): void {
    if (this.disposed) throw new JobObjectError("disposed", "posix supervisor is disposed");
  }
}

function emptyAccounting(limits: JobLimits, activeProcesses: number): JobAccounting {
  return {
    activeProcesses,
    totalProcesses: activeProcesses,
    totalTerminatedProcesses: 0,
    peakJobMemoryBytes: 0,
    currentJobMemoryBytes: 0,
    peakProcessMemoryBytes: 0,
    jobMemoryLimitBytes: limits.memoryBytes,
    processMemoryLimitBytes: limits.memoryBytes,
    activeProcessLimit: limits.activeProcessLimit,
    userCpuMs: 0,
    kernelCpuMs: 0,
    totalPageFaults: 0,
    limitFlags: 0,
    uiRestrictions: 0,
    cpuRatePercent: limits.cpuRatePercent ?? null,
    killOnJobClose: false,
    uiHandlesRestricted: false,
    memoryLimitHit: false,
    activeProcessLimitHit: false,
  };
}
