import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import type { SpawnRequest, SupervisedExit, SupervisedProcess, WindowsJobSupervisor } from "./ports.js";

const OUTPUT_CAP = 256 * 1024;

export function pidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function killTree(pid: number): void {
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true });
    return;
  }
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    return;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

class TrackedJob implements SupervisedProcess {
  readonly killOnClose = true as const;
  readonly exited: Promise<SupervisedExit>;
  private exitValue: SupervisedExit | null = null;
  private stdoutText = "";
  private stderrText = "";
  private resolveExit: (value: SupervisedExit) => void = () => undefined;

  constructor(
    readonly jobId: string,
    readonly pid: number,
    private readonly child: ChildProcess,
  ) {
    this.exited = new Promise((resolve) => {
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

  kill(): void {
    try {
      this.child.kill("SIGKILL");
    } catch {
      return;
    }
    if (process.platform === "win32") {
      spawnSync("taskkill.exe", ["/PID", String(this.pid), "/T", "/F"], { windowsHide: true });
    }
  }

  poll(): SupervisedExit | null {
    return this.exitValue;
  }

  stdout(): string {
    return this.exitValue?.stdout ?? this.stdoutText;
  }

  stderr(): string {
    return this.exitValue?.stderr ?? this.stderrText;
  }
}

/**
 * Process-tree supervisor with kill-on-close semantics.
 * Swap for Task 040 `WindowsJobManager` when that package is on the integration base.
 */
export class LocalWindowsJobSupervisor implements WindowsJobSupervisor {
  readonly killOnJobClose = true as const;
  private readonly jobs = new Map<string, TrackedJob>();
  private readonly retired: number[] = [];
  private sequence = 0;
  private recent: { command: string; args: readonly string[]; cwd: string } | null = null;

  spawn(input: SpawnRequest): SupervisedProcess {
    const child = spawn(input.command, [...input.args], {
      cwd: input.cwd,
      env: { ...input.env },
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (child.pid === undefined) {
      throw new Error("preview job did not receive a pid");
    }
    this.sequence += 1;
    const job = new TrackedJob(`preview-job-${this.sequence}`, child.pid, child);
    this.jobs.set(job.jobId, job);
    this.recent = { command: input.command, args: input.args, cwd: input.cwd };
    return job;
  }

  async terminate(jobId: string): Promise<void> {
    const job = this.jobs.get(jobId);
    if (!job) return;
    job.kill();
    if (pidAlive(job.pid)) killTree(job.pid);
    await Promise.race([job.exited, delay(3_000)]);
    if (pidAlive(job.pid)) {
      killTree(job.pid);
      await delay(50);
    }
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
    const ids = [...this.jobs.keys()];
    for (const id of ids) {
      await this.terminate(id);
    }
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
}
