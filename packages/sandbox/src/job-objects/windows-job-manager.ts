import { assertTimeout, assertJobLimits, clampNestedLimits } from "./limits.js";
import { reconcileOrphanedProcesses } from "./reconcile.js";
import { JsonLineLogger, type StructuredLogger } from "./logger.js";
import { SqliteProjectStateDb } from "./env-process-registry.js";
import { Win32HelperClient, type NativeJobInfo } from "./helper-client.js";
import { windowsCommandLine } from "./quote.js";
import { delayFor } from "./timer.js";
import type {
  CommandRequest,
  CommandResult,
  EnvProcessRow,
  JobAccounting,
  JobHandle,
  JobProcessInfo,
  JobSpec,
  OrphanSweepReport,
  ProcessAssignment,
  ProcessInspection,
  ProcessSupervisor,
  ProjectStateDb,
  SpawnedProcess,
  SpawnRequest,
  TerminationReason,
} from "./types.js";
import { JobObjectError } from "./types.js";

const QUIESCE_TIMEOUT_MS = 2000;
const QUIESCE_POLL_MS = 25;
const OUTPUT_DRAIN_MS = 80;

interface TrackedProcess {
  readonly slot: number;
  readonly pid: number;
  readonly startTime: number;
  readonly row: EnvProcessRow;
}

interface LiveJob {
  handle: JobHandle;
  nativeId: number;
  timer: ReturnType<typeof setTimeout> | null;
  readonly processes: Map<number, TrackedProcess>;
  closed: boolean;
  terminationReason: TerminationReason | null;
}

export interface WindowsJobManagerOptions {
  readonly registry?: ProjectStateDb;
  readonly stateDbPath?: string;
  readonly logger?: StructuredLogger;
}

export class WindowsJobManager implements ProcessSupervisor {
  private readonly registry: ProjectStateDb;
  private readonly ownsRegistry: boolean;
  private readonly logger: StructuredLogger;
  private readonly jobs = new Map<string, LiveJob>();
  private helperPromise: Promise<Win32HelperClient> | null = null;
  private activeHelper: Win32HelperClient | null = null;
  private disposed = false;
  private readonly onExit = (): void => {
    this.activeHelper?.killSync();
  };

  constructor(options: WindowsJobManagerOptions = {}) {
    if (options.registry && options.stateDbPath) {
      throw new JobObjectError("invalid_options", "pass registry or stateDbPath, not both");
    }
    if (options.registry) {
      this.registry = options.registry;
      this.ownsRegistry = false;
    } else if (options.stateDbPath) {
      this.registry = new SqliteProjectStateDb(options.stateDbPath);
      this.ownsRegistry = true;
    } else {
      throw new JobObjectError("invalid_options", "WindowsJobManager requires a ProjectStateDb or stateDbPath");
    }
    this.logger = options.logger ?? new JsonLineLogger();
    process.on("exit", this.onExit);
  }

  async createJob(spec: JobSpec): Promise<JobHandle> {
    this.assertOpen();
    if (spec.name.trim().length === 0) {
      throw new JobObjectError("invalid_name", "job name is required");
    }
    assertJobLimits(spec.limits, spec.kind);
    const parent = spec.parent ? this.require(spec.parent) : null;
    const clamped = clampNestedLimits(spec.limits, parent ? parent.handle.limits : null);
    assertJobLimits(clamped.effective, spec.kind);
    const timeoutMs = assertTimeout(spec.kind, spec.timeoutMs);
    if (clamped.clamped) {
      this.logger.warn("nested job limits were tightened to the parent cap", {
        job: spec.name,
        detail: clamped.notes.join("; "),
      });
    }
    const helper = await this.helper();
    const created = await helper.createJob({
      memoryBytes: clamped.effective.memoryBytes,
      activeProcessLimit: clamped.effective.activeProcessLimit,
      cpuRatePercent: clamped.effective.cpuRatePercent ?? 0,
      parentJobId: parent ? parent.nativeId : 0,
    });
    try {
      assertAppliedLimits(created, clamped.effective);
    } catch (error) {
      await helper.close(created.jobId);
      throw error;
    }
    const handle: JobHandle = {
      id: `job-${created.jobId}`,
      name: spec.name,
      kind: spec.kind,
      parentId: spec.parent?.id ?? null,
      limits: clamped.effective,
      requestedLimits: spec.limits,
      limitsClamped: clamped.clamped,
      timeoutMs,
    };
    const live: LiveJob = {
      handle,
      nativeId: created.jobId,
      timer: null,
      processes: new Map(),
      closed: false,
      terminationReason: null,
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
    const helper = await this.helper();
    const assigned = await helper.assignPid(live.nativeId, pid);
    const spawned: SpawnedProcess = {
      slot: -assigned.pid,
      pid: assigned.pid,
      startTime: assigned.startTime,
      imagePath: assigned.imagePath,
      commandLine: assigned.commandLine,
    };
    if (meta) this.remember(live, spawned, meta);
    return spawned;
  }

  async spawnInJob(job: JobHandle, request: SpawnRequest): Promise<SpawnedProcess> {
    const live = this.require(job);
    const helper = await this.helper();
    const spawnedNative = await helper.spawn({
      jobId: live.nativeId,
      application: request.file,
      commandLine: windowsCommandLine(request.file, request.args),
      capture: false,
      resume: request.resume !== false,
      ...(request.cwd === undefined ? {} : { cwd: request.cwd }),
    });
    const spawned: SpawnedProcess = {
      slot: spawnedNative.slot,
      pid: spawnedNative.pid,
      startTime: spawnedNative.startTime,
      imagePath: spawnedNative.imagePath,
      commandLine: spawnedNative.commandLine,
    };
    this.remember(live, spawned, request);
    return spawned;
  }

  async resume(spawned: SpawnedProcess): Promise<void> {
    this.assertOpen();
    await (await this.helper()).resume(spawned.slot);
  }

  async queryJobAccounting(job: JobHandle): Promise<JobAccounting> {
    const live = this.require(job);
    return (await this.helper()).query(live.nativeId);
  }

  async terminateJob(job: JobHandle): Promise<JobAccounting> {
    const live = this.require(job);
    if (live.terminationReason === null) live.terminationReason = "terminated";
    const helper = await this.helper();
    await helper.terminate(live.nativeId);
    const quiescent = await this.pollQuiescent(helper, live.nativeId, QUIESCE_TIMEOUT_MS);
    if (!quiescent) {
      throw new JobObjectError(
        "job_not_quiescent",
        `job ${job.name} still has processes after ${QUIESCE_TIMEOUT_MS}ms`,
      );
    }
    return helper.query(live.nativeId);
  }

  async closeJob(job: JobHandle): Promise<void> {
    const live = this.jobs.get(job.id);
    if (!live || live.closed) return;
    live.closed = true;
    this.clearTimer(live);
    const nativeId = live.nativeId;
    if (nativeId === 0) return;
    live.nativeId = 0;
    const helper = await this.helper();
    let quiescent = false;
    try {
      await helper.terminate(nativeId);
      quiescent = await this.pollQuiescent(helper, nativeId, QUIESCE_TIMEOUT_MS);
    } catch (error) {
      this.logger.warn("job close could not confirm termination before releasing the handle", {
        job: job.name,
        detail: error instanceof Error ? error.message : "unknown",
      });
    }
    if (quiescent) this.deleteRows(live);
    await helper.close(nativeId);
    if (!quiescent) {
      throw new JobObjectError(
        "job_not_quiescent",
        `job ${job.name} still has processes after ${QUIESCE_TIMEOUT_MS}ms`,
      );
    }
  }

  async waitUntilQuiescent(job: JobHandle, timeoutMs = QUIESCE_TIMEOUT_MS): Promise<void> {
    const live = this.require(job);
    const helper = await this.helper();
    const quiescent = await this.pollQuiescent(helper, live.nativeId, timeoutMs);
    if (!quiescent) {
      throw new JobObjectError(
        "job_not_quiescent",
        `job ${job.name} still has processes after ${timeoutMs}ms`,
      );
    }
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
      const helper = await this.helper();
      const live = this.require(job);
      const spawnedNative = await helper.spawn({
        jobId: live.nativeId,
        application: request.file,
        commandLine: windowsCommandLine(request.file, request.args),
        capture: true,
        resume: true,
        ...(request.cwd === undefined ? {} : { cwd: request.cwd }),
      });
      const spawned: SpawnedProcess = {
        slot: spawnedNative.slot,
        pid: spawnedNative.pid,
        startTime: spawnedNative.startTime,
        imagePath: spawnedNative.imagePath,
        commandLine: spawnedNative.commandLine,
      };
      this.remember(live, spawned, request);
      const outcome = await this.waitForCommand(live, spawned.slot, request.timeoutMs, started);
      await delay(OUTPUT_DRAIN_MS);
      const output = await helper.readOutput(spawned.slot);
      const quiescent = await this.pollQuiescent(helper, live.nativeId, QUIESCE_TIMEOUT_MS);
      if (!quiescent) {
        throw new JobObjectError(
          "job_not_quiescent",
          `command job ${job.name} still has processes after ${QUIESCE_TIMEOUT_MS}ms`,
        );
      }
      const accounting = await helper.query(live.nativeId);
      return {
        reason: outcome.reason,
        exitCode: outcome.exitCode,
        stdout: output.stdout,
        stderr: output.stderr,
        stdoutTruncated: output.stdoutTruncated,
        stderrTruncated: output.stderrTruncated,
        accounting,
        pid: spawned.pid,
        startTime: spawned.startTime,
        durationMs: elapsedMs(started),
        job,
      };
    } finally {
      await this.closeJob(job);
    }
  }

  async listJobProcesses(job: JobHandle): Promise<readonly JobProcessInfo[]> {
    const live = this.require(job);
    return (await this.helper()).listProcesses(live.nativeId);
  }

  async nativeHandleCount(): Promise<number> {
    this.assertOpen();
    return (await this.helper()).handleCount();
  }

  async waitForExit(spawned: SpawnedProcess, timeoutMs: number): Promise<number | null> {
    this.assertOpen();
    const status = await (await this.helper()).waitExit(spawned.slot, timeoutMs);
    return status.exited ? status.exitCode : null;
  }

  inspectProcess(pid: number): Promise<ProcessInspection> {
    this.assertOpen();
    return this.helper().then((helper) => helper.inspect(pid));
  }

  reconcileOrphanedProcesses(): Promise<OrphanSweepReport> {
    this.assertOpen();
    return reconcileOrphanedProcesses({
      registry: this.registry,
      logger: this.logger,
      inspect: (pid) => this.helper().then((helper) => helper.inspect(pid)),
      terminate: (pid, startTime) =>
        this.helper().then((helper) => helper.confirmTerminate(pid, startTime)),
    });
  }

  async abandon(): Promise<void> {
    for (const live of this.jobs.values()) this.clearTimer(live);
    this.activeHelper?.killSync();
    this.activeHelper = null;
    this.helperPromise = null;
    this.disposed = true;
    process.off("exit", this.onExit);
    if (this.ownsRegistry) this.registry.close();
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    process.off("exit", this.onExit);
    for (const live of [...this.jobs.values()]) {
      if (!live.closed) await this.closeJob(live.handle);
    }
    await this.activeHelper?.dispose();
    this.activeHelper = null;
    this.helperPromise = null;
    if (this.ownsRegistry) this.registry.close();
  }

  private async waitForCommand(
    live: LiveJob,
    slot: number,
    timeoutMs: number,
    started: bigint,
  ): Promise<{ reason: TerminationReason; exitCode: number | null }> {
    const helper = await this.helper();
    while (true) {
      const accounting = await helper.query(live.nativeId);
      if (accounting.memoryLimitHit || live.terminationReason === "memory_limit_exceeded") {
        live.terminationReason = "memory_limit_exceeded";
        await helper.terminate(live.nativeId);
        const status = await helper.waitExit(slot, 1000);
        return {
          reason: "memory_limit_exceeded",
          exitCode: status.exited ? status.exitCode : null,
        };
      }
      if (live.terminationReason === "timeout" || elapsedMs(started) >= timeoutMs) {
        live.terminationReason = "timeout";
        await helper.terminate(live.nativeId);
        const status = await helper.waitExit(slot, 1000);
        return { reason: "timeout", exitCode: status.exited ? status.exitCode : null };
      }
      const status = await helper.waitExit(slot, 40);
      if (!status.exited) continue;
      const again = await helper.query(live.nativeId);
      if (again.memoryLimitHit) {
        live.terminationReason = "memory_limit_exceeded";
        await helper.terminate(live.nativeId);
        return { reason: "memory_limit_exceeded", exitCode: status.exitCode };
      }
      await helper.terminate(live.nativeId);
      return { reason: "exited", exitCode: status.exitCode };
    }
  }

  private remember(
    live: LiveJob,
    spawned: SpawnedProcess,
    meta: { readonly environment: string; readonly role: string; readonly port?: number },
  ): void {
    const row: EnvProcessRow = {
      pid: spawned.pid,
      startTime: spawned.startTime,
      environment: meta.environment,
      role: meta.role,
      port: meta.port ?? null,
      jobName: live.handle.name,
    };
    try {
      this.registry.insertEnvProcess(row);
    } catch (error) {
      void this.activeHelper?.confirmTerminate(spawned.pid, spawned.startTime);
      throw error;
    }
    live.processes.set(spawned.slot, {
      slot: spawned.slot,
      pid: spawned.pid,
      startTime: spawned.startTime,
      row,
    });
  }

  private deleteRows(live: LiveJob): void {
    for (const tracked of live.processes.values()) {
      this.registry.deleteEnvProcess(tracked.row.pid, tracked.row.startTime);
    }
    live.processes.clear();
  }

  private armTimeout(live: LiveJob, timeoutMs: number): void {
    const start = process.hrtime.bigint();
    const fire = (): void => {
      if (live.closed) return;
      const elapsed = elapsedMs(start);
      if (elapsed + 15 < timeoutMs) {
        live.timer = setTimeout(fire, delayFor(timeoutMs - elapsed));
        return;
      }
      void this.expire(live).catch((error: unknown) => {
        this.logger.error("wall-clock timeout enforcer failed", {
          job: live.handle.name,
          detail: error instanceof Error ? error.message : "unknown",
        });
      });
    };
    live.timer = setTimeout(fire, delayFor(timeoutMs));
  }

  private async expire(live: LiveJob): Promise<void> {
    if (live.closed || live.nativeId === 0) return;
    if (live.terminationReason === null) live.terminationReason = "timeout";
    const helper = this.activeHelper;
    if (!helper) return;
    await helper.terminate(live.nativeId);
  }

  private async pollQuiescent(
    helper: Win32HelperClient,
    nativeId: number,
    timeoutMs: number,
  ): Promise<boolean> {
    const start = process.hrtime.bigint();
    while (true) {
      const accounting = await helper.query(nativeId);
      if (accounting.activeProcesses === 0) return true;
      if (elapsedMs(start) >= timeoutMs) return false;
      await delay(QUIESCE_POLL_MS);
    }
  }

  private clearTimer(live: LiveJob): void {
    if (live.timer) clearTimeout(live.timer);
    live.timer = null;
  }

  private async helper(): Promise<Win32HelperClient> {
    if (process.platform !== "win32") {
      throw new JobObjectError("unsupported_platform", "Windows Job Objects require win32");
    }
    if (this.activeHelper) return this.activeHelper;
    this.assertOpen();
    this.helperPromise ??= Win32HelperClient.start().then(
      (helper) => {
        this.activeHelper = helper;
        return helper;
      },
      (error: unknown) => {
        this.helperPromise = null;
        throw error;
      },
    );
    return this.helperPromise;
  }

  private require(job: JobHandle): LiveJob {
    const live = this.jobs.get(job.id);
    if (!live || live.closed || live.nativeId === 0) {
      throw new JobObjectError("missing_job", `job ${job.name} is not open`);
    }
    return live;
  }

  private assertOpen(): void {
    if (this.disposed) throw new JobObjectError("disposed", "WindowsJobManager is disposed");
  }
}

function assertAppliedLimits(created: NativeJobInfo, effective: JobSpec["limits"]): void {
  if (!created.killOnJobClose || (created.limitFlags & 0x2000) === 0) {
    throw new JobObjectError(
      "missing_kill_on_close",
      "JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE was not applied",
    );
  }
  if (!created.uiHandlesRestricted || (created.uiRestrictions & 0x1) === 0) {
    throw new JobObjectError(
      "missing_ui_restriction",
      "JOB_OBJECT_UILIMIT_HANDLES was not applied",
    );
  }
  if (created.memoryBytes !== effective.memoryBytes || created.activeProcessLimit !== effective.activeProcessLimit) {
    throw new JobObjectError(
      "limit_mismatch",
      `job stored limits ${created.memoryBytes}/${created.activeProcessLimit} but requested ${effective.memoryBytes}/${effective.activeProcessLimit}`,
    );
  }
  if ((effective.cpuRatePercent ?? null) !== created.cpuRatePercent) {
    throw new JobObjectError(
      "limit_mismatch",
      `job stored cpu ${created.cpuRatePercent ?? "unset"} but requested ${effective.cpuRatePercent ?? "unset"}`,
    );
  }
}

function elapsedMs(start: bigint): number {
  return Math.max(0, Math.round(Number(process.hrtime.bigint() - start) / 1e6));
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
