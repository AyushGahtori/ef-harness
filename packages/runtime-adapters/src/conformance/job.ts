import { spawn, type ChildProcess } from "node:child_process";
import { ConformanceError } from "./errors.js";

export interface ChildWait {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

export interface SpawnedChild {
  readonly pid: number;
  wait(): Promise<ChildWait>;
  alive(): boolean;
}

export interface SpawnRequest {
  readonly inJob: boolean;
  readonly script: string;
  readonly cwd: string;
  readonly capture: boolean;
}

/**
 * Local port of Task 041 `WindowsJobSupervisor`.
 * Each conformance run gets its own job. `closeAssigned` terminates only the
 * processes that were placed in the job. Processes spawned outside it survive
 * until `reapAll`, which is how P07 observes a leak before cleanup.
 */
export interface JobRun {
  spawn(request: SpawnRequest): SpawnedChild;
  closeAssigned(): Promise<void>;
  alive(pids: readonly number[]): number[];
  reapAll(): Promise<number>;
}

export interface WindowsJobSupervisorPort {
  openRun(label: string): JobRun;
}

interface TrackedChild {
  readonly child: ChildProcess;
  readonly pid: number;
  readonly inJob: boolean;
  readonly exited: Promise<ChildWait>;
}

export class LocalWindowsJobSupervisor implements WindowsJobSupervisorPort {
  openRun(label: string): JobRun {
    return new LocalJobRun(label);
  }
}

class LocalJobRun implements JobRun {
  private readonly tracked: TrackedChild[] = [];

  constructor(private readonly label: string) {}

  spawn(request: SpawnRequest): SpawnedChild {
    const child = spawn(process.execPath, ["-e", request.script], {
      cwd: request.cwd,
      windowsHide: true,
      stdio: request.capture ? ["ignore", "pipe", "pipe"] : "ignore",
    });
    const exited = watchChild(child);
    if (child.pid === undefined) {
      throw new ConformanceError("job", `Job ${this.label} did not receive a process id`);
    }
    const tracked: TrackedChild = { child, pid: child.pid, inJob: request.inJob, exited };
    this.tracked.push(tracked);
    return {
      pid: tracked.pid,
      alive: () => isAlive(tracked.child),
      wait: () => tracked.exited,
    };
  }

  async closeAssigned(): Promise<void> {
    const assigned = this.tracked.filter((entry) => entry.inJob && isAlive(entry.child));
    for (const entry of assigned) entry.child.kill("SIGKILL");
    await Promise.all(assigned.map((entry) => settleSoon(entry.exited, entry.child)));
  }

  alive(pids: readonly number[]): number[] {
    const wanted = new Set(pids);
    return this.tracked
      .filter((entry) => wanted.has(entry.pid) && isAlive(entry.child))
      .map((entry) => entry.pid);
  }

  async reapAll(): Promise<number> {
    const living = this.tracked.filter((entry) => isAlive(entry.child));
    for (const entry of living) entry.child.kill("SIGKILL");
    await Promise.all(living.map((entry) => settleSoon(entry.exited, entry.child)));
    return this.tracked.filter((entry) => isAlive(entry.child)).length;
  }
}

function isAlive(child: ChildProcess): boolean {
  return child.exitCode === null && child.signalCode === null;
}

function settleSoon(exited: Promise<ChildWait>, child: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (isAlive(child)) child.kill("SIGKILL");
      resolve();
    }, 10_000);
    void exited.then(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}

function watchChild(child: ChildProcess): Promise<ChildWait> {
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  child.stdout?.on("data", (chunk: Buffer) => {
    stdout.push(chunk);
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    stderr.push(chunk);
  });
  return new Promise((resolve) => {
    let settled = false;
    const finish = (code: number | null): void => {
      if (settled) return;
      settled = true;
      resolve({
        code,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      });
    };
    child.once("error", () => {
      finish(null);
    });
    child.once("exit", (code) => {
      finish(code);
    });
    if (!isAlive(child)) finish(child.exitCode);
  });
}
