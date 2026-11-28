import { spawn, type ChildProcess } from "node:child_process";
import {
  PosixProcessGroupSupervisor,
  SqliteProjectStateDb,
  WindowsJobObjectManager,
  nodePosixHost,
  type JobHandle,
  type PosixChild,
  type PosixHost,
  type ProjectStateDb,
} from "@ef-harness/sandbox";
import type { SpawnRequest, SupervisedExit, SupervisedProcess, WindowsJobSupervisor } from "./ports.js";

const OUTPUT_CAP = 256 * 1024;
const JOB_LIMITS = { memoryBytes: 512 * 1024 * 1024, activeProcessLimit: 16 } as const;

export function pidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

class CapturedChild implements PosixChild {
  readonly pid: number;
  private stdoutText = "";
  private stderrText = "";
  private exitValue: SupervisedExit | null = null;
  private readonly exitPromise: Promise<SupervisedExit>;
  private resolveExit: (value: SupervisedExit) => void = () => undefined;

  constructor(private readonly child: ChildProcess) {
    if (child.pid === undefined) throw new Error("preview job did not receive a pid");
    this.pid = child.pid;
    this.exitPromise = new Promise((resolve) => {
      this.resolveExit = resolve;
    });
    child.stdout?.on("data", (chunk: Buffer) => {
      this.stdoutText = (this.stdoutText + chunk.toString("utf8")).slice(-OUTPUT_CAP);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      this.stderrText = (this.stderrText + chunk.toString("utf8")).slice(-OUTPUT_CAP);
    });
    const finish = (code: number | null): void => {
      if (this.exitValue) return;
      this.exitValue = { code, stdout: this.stdoutText, stderr: this.stderrText };
      this.resolveExit(this.exitValue);
    };
    child.once("error", (error) => {
      this.stderrText = (this.stderrText + error.message).slice(-OUTPUT_CAP);
      finish(null);
    });
    child.once("exit", (code) => {
      finish(code);
    });
  }

  stdout(): string {
    return this.exitValue?.stdout ?? this.stdoutText;
  }

  stderr(): string {
    return this.exitValue?.stderr ?? this.stderrText;
  }

  poll(): SupervisedExit | null {
    return this.exitValue;
  }

  exited(): Promise<SupervisedExit> {
    return this.exitPromise;
  }

  wait(timeoutMs: number): Promise<{
    readonly exited: boolean;
    readonly exitCode: number | null;
    readonly stdout: string;
    readonly stderr: string;
  }> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        resolve({
          exited: this.exitValue !== null,
          exitCode: this.exitValue?.code ?? null,
          stdout: this.stdout(),
          stderr: this.stderr(),
        });
      }, timeoutMs);
      void this.exitPromise.then((value) => {
        clearTimeout(timer);
        resolve({
          exited: true,
          exitCode: value.code,
          stdout: value.stdout,
          stderr: value.stderr,
        });
      });
    });
  }
}

class EnvPosixHost implements PosixHost {
  readonly children = new Map<number, CapturedChild>();
  nextEnv: Readonly<Record<string, string>> | null = null;

  constructor(private readonly inner: PosixHost = nodePosixHost()) {}

  spawn(spec: {
    readonly file: string;
    readonly args: readonly string[];
    readonly detached: true;
    readonly cwd?: string;
  }): PosixChild {
    const env = this.nextEnv;
    this.nextEnv = null;
    const child = spawn(spec.file, [...spec.args], {
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      ...(env === null ? {} : { env: { ...env } }),
      ...(spec.cwd === undefined ? {} : { cwd: spec.cwd }),
    });
    const captured = new CapturedChild(child);
    this.children.set(captured.pid, captured);
    return captured;
  }

  killGroup(pid: number, signal: NodeJS.Signals): void {
    try {
      this.inner.killGroup(pid, signal);
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ESRCH") return;
      throw error;
    }
  }

  inspect(pid: number): ReturnType<PosixHost["inspect"]> {
    return this.inner.inspect(pid);
  }

  terminate(pid: number, startTime: number): ReturnType<PosixHost["terminate"]> {
    return this.inner.terminate(pid, startTime);
  }
}

class TrackedPreview implements SupervisedProcess {
  readonly killOnClose = true as const;

  constructor(
    readonly jobId: string,
    readonly pid: number,
    private readonly captured: CapturedChild,
    private readonly handle: JobHandle,
  ) {}

  get exited(): Promise<SupervisedExit> {
    return this.captured.exited();
  }

  poll(): SupervisedExit | null {
    return this.captured.poll();
  }

  stdout(): string {
    return this.captured.stdout();
  }

  stderr(): string {
    return this.captured.stderr();
  }

  jobHandle(): JobHandle {
    return this.handle;
  }
}

/**
 * Preview process tree owned by Task 040.
 * Windows uses `WindowsJobObjectManager` (kill on job close).
 * Other hosts use `PosixProcessGroupSupervisor` from the same package,
 * because `WindowsJobObjectManager` refuses to create a job off win32.
 */
export class PreviewJobSupervisor implements WindowsJobSupervisor {
  readonly killOnJobClose = true as const;
  private readonly registry: ProjectStateDb;
  private readonly windows: WindowsJobObjectManager | null;
  private readonly posix: PosixProcessGroupSupervisor | null;
  private readonly host: EnvPosixHost | null;
  private readonly jobs = new Map<string, TrackedPreview>();
  private readonly retired: number[] = [];
  private sequence = 0;
  private recent: { command: string; args: readonly string[]; cwd: string } | null = null;
  private closed = false;

  constructor(stateDbPath: string) {
    this.registry = new SqliteProjectStateDb(stateDbPath);
    if (process.platform === "win32") {
      this.windows = new WindowsJobObjectManager({ registry: this.registry });
      this.posix = null;
      this.host = null;
      return;
    }
    this.windows = null;
    this.host = new EnvPosixHost();
    this.posix = new PosixProcessGroupSupervisor(this.registry, this.host);
  }

  async spawn(input: SpawnRequest): Promise<SupervisedProcess> {
    if (this.closed) throw new Error("preview job supervisor is closed");
    this.recent = { command: input.command, args: input.args, cwd: input.cwd };
    this.sequence += 1;
    const name = `preview-${this.sequence}`;
    if (this.windows) return this.spawnWindows(name, input);
    return this.spawnPosix(name, input);
  }

  async terminate(jobId: string): Promise<void> {
    const job = this.jobs.get(jobId);
    if (!job) return;
    if (this.windows) {
      await this.windows.terminateJob(job.jobHandle());
      await this.windows.closeJob(job.jobHandle());
    } else if (this.posix) {
      await this.posix.terminateJob(job.jobHandle());
      await this.posix.closeJob(job.jobHandle());
    }
    await Promise.race([job.exited, delay(3_000)]);
    if (pidAlive(job.pid)) this.retired.push(job.pid);
    this.jobs.delete(jobId);
  }

  activePids(): readonly number[] {
    return [...this.jobs.values()].map((job) => job.pid);
  }

  leakedPids(): readonly number[] {
    const live = new Set<number>();
    for (const pid of this.activePids()) {
      if (pidAlive(pid)) live.add(pid);
    }
    for (const pid of this.retired) {
      if (pidAlive(pid)) live.add(pid);
    }
    return [...live];
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    const ids = [...this.jobs.keys()];
    for (const id of ids) await this.terminate(id);
    if (this.windows) await this.windows.abandon();
    if (this.posix) await this.posix.dispose();
    this.registry.close();
  }

  spawnContainedSecret(secret: string): boolean {
    if (!this.recent || secret.length < 8) return false;
    return [this.recent.command, ...this.recent.args].some((part) => part.includes(secret));
  }

  lastCwd(): string | null {
    return this.recent?.cwd ?? null;
  }

  lastArgs(): readonly string[] {
    return this.recent?.args ?? [];
  }

  private async spawnPosix(name: string, input: SpawnRequest): Promise<SupervisedProcess> {
    const posix = this.posix;
    const host = this.host;
    if (!posix || !host) throw new Error("posix preview supervisor is unavailable");
    host.nextEnv = input.env;
    const handle = await posix.createJob({
      name,
      kind: "environment",
      limits: JOB_LIMITS,
    });
    const spawned = await posix.spawnInJob(handle, {
      file: input.command,
      args: input.args,
      cwd: input.cwd,
      environment: "preview",
      role: "live-preview",
    });
    const captured = host.children.get(spawned.pid);
    if (!captured) throw new Error("preview job did not capture the child process");
    const tracked = new TrackedPreview(handle.id, spawned.pid, captured, handle);
    this.jobs.set(tracked.jobId, tracked);
    return tracked;
  }

  private async spawnWindows(name: string, input: SpawnRequest): Promise<SupervisedProcess> {
    const windows = this.windows;
    if (!windows) throw new Error("Windows job supervisor is unavailable");
    const handle = await windows.createJob({
      name,
      kind: "environment",
      limits: JOB_LIMITS,
    });
    const child = spawn(input.command, [...input.args], {
      cwd: input.cwd,
      env: { ...input.env },
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const captured = new CapturedChild(child);
    await windows.assignProcess(handle, captured.pid, {
      environment: "preview",
      role: "live-preview",
    });
    const tracked = new TrackedPreview(handle.id, captured.pid, captured, handle);
    this.jobs.set(tracked.jobId, tracked);
    return tracked;
  }
}
