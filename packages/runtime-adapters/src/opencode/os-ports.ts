import { OsWindowsJob } from "../acp/os-boundary.js";
import type { JobTerminateResult, WindowsJobObjectPort } from "./job-object.js";

/**
 * Real OS job. Windows uses `WindowsJobObjectManager` (`KILL_ON_JOB_CLOSE`).
 * Other platforms use `PosixProcessGroupSupervisor`, then signal each attached pid.
 */
export class OsOpenCodeJob implements WindowsJobObjectPort {
  private readonly inner = new OsWindowsJob();
  private readonly jobs = new Map<string, Promise<string>>();
  private readonly pids = new Map<string, number[]>();

  attach(sessionKey: string, pid: number): void {
    if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) return;
    const tracked = this.pids.get(sessionKey) ?? [];
    tracked.push(pid);
    this.pids.set(sessionKey, tracked);
    const created = this.jobs.get(sessionKey) ?? this.inner.create(sessionKey).then((job) => job.jobId);
    const next = created.then(async (jobId) => {
      await this.inner.attach(jobId, pid);
      return jobId;
    });
    this.jobs.set(sessionKey, next);
  }

  async terminateTree(sessionKey: string): Promise<JobTerminateResult> {
    const pending = this.jobs.get(sessionKey);
    if (pending) {
      try {
        const jobId = await pending;
        await this.inner.kill(jobId, "terminate");
      } catch {
        /* the pid set below still reaps every process this session attached */
      }
    }
    const killedPids: number[] = [];
    const leakedPids: number[] = [];
    for (const pid of this.pids.get(sessionKey) ?? []) {
      try {
        process.kill(pid, "SIGKILL");
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === "ESRCH") {
          killedPids.push(pid);
          continue;
        }
      }
      const dead = await waitDead(pid, 1_000);
      if (dead) killedPids.push(pid);
      else leakedPids.push(pid);
    }
    this.pids.delete(sessionKey);
    this.jobs.delete(sessionKey);
    return { killedPids, leakedPids };
  }
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitDead(pid: number, timeoutMs: number): Promise<boolean> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (!alive(pid)) return true;
    await new Promise((resolve) => {
      setTimeout(resolve, 20);
    });
  }
  return !alive(pid);
}
