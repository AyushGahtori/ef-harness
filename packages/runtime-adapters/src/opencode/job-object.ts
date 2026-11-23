export interface JobTerminateResult {
  readonly killedPids: readonly number[];
  readonly leakedPids: readonly number[];
}

export interface WindowsJobObjectPort {
  attach(sessionKey: string, pid: number): void;
  terminateTree(sessionKey: string): Promise<JobTerminateResult>;
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

/**
 * Local stand-in for Task 041 Windows Job Object.
 * It kills every pid the adapter attached. The real job object also
 * reaps grandchildren that were never enumerated.
 */
export class InMemoryWindowsJobObject implements WindowsJobObjectPort {
  private readonly members = new Map<string, Set<number>>();

  attach(sessionKey: string, pid: number): void {
    if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) return;
    const set = this.members.get(sessionKey) ?? new Set<number>();
    set.add(pid);
    this.members.set(sessionKey, set);
  }

  async terminateTree(sessionKey: string): Promise<JobTerminateResult> {
    const pids = [...(this.members.get(sessionKey) ?? [])];
    const killedPids: number[] = [];
    const leakedPids: number[] = [];
    for (const pid of pids) {
      try {
        process.kill(pid);
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== "ESRCH") {
          leakedPids.push(pid);
          continue;
        }
      }
      killedPids.push(pid);
    }
    for (const pid of killedPids) {
      const dead = await waitDead(pid, 1_000);
      if (!dead) leakedPids.push(pid);
    }
    this.members.delete(sessionKey);
    return { killedPids, leakedPids };
  }
}
