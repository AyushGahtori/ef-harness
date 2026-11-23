import { spawnSync } from "node:child_process";

export interface JobAssignment {
  readonly jobId: string;
}

/**
 * Local port of Task 040 `WindowsJobManager` (Task 041 consumes the same shape).
 * Tracks the spawned ACP child and kills the process tree on cancel.
 */
export interface WindowsJobPort {
  create(sessionId: string): JobAssignment;
  attach(jobId: string, pid: number): void;
  list(jobId: string): readonly number[];
  activeChildCount(jobId: string): number;
  kill(jobId: string, reason: string): readonly number[];
  close(jobId: string): void;
}

export class LocalWindowsJob implements WindowsJobPort {
  private readonly jobs = new Map<string, Set<number>>();

  create(sessionId: string): JobAssignment {
    const jobId = `job-${sessionId}`;
    if (this.jobs.has(jobId)) throw new Error(`Job ${jobId} already exists`);
    this.jobs.set(jobId, new Set());
    return { jobId };
  }

  attach(jobId: string, pid: number): void {
    if (!Number.isInteger(pid) || pid <= 0) throw new Error("Job attach requires a positive pid");
    this.require(jobId).add(pid);
  }

  list(jobId: string): readonly number[] {
    const pids = this.jobs.get(jobId);
    if (!pids) return [];
    return [...pids].filter((pid) => isAlive(pid));
  }

  activeChildCount(jobId: string): number {
    const live = this.list(jobId);
    const set = this.jobs.get(jobId);
    if (!set) return 0;
    set.clear();
    for (const pid of live) set.add(pid);
    return live.length;
  }

  kill(jobId: string, reason: string): readonly number[] {
    void reason;
    const pids = this.jobs.get(jobId);
    if (!pids) return [];
    const killed = [...pids];
    for (const pid of killed) killProcessTree(pid);
    this.jobs.set(jobId, new Set());
    return killed;
  }

  close(jobId: string): void {
    if (!this.jobs.has(jobId)) return;
    this.kill(jobId, "close");
    this.jobs.delete(jobId);
  }

  private require(jobId: string): Set<number> {
    const pids = this.jobs.get(jobId);
    if (!pids) throw new Error(`Unknown job ${jobId}`);
    return pids;
  }
}

export function killProcessTree(pid: number): void {
  if (!Number.isInteger(pid) || pid <= 0) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
    return;
  }
  try {
    process.kill(pid, "SIGKILL");
  } catch (error) {
    if (!isMissing(error)) throw error;
  }
}

export function isAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function isMissing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ESRCH";
}
