export interface JobAssignment {
  readonly jobId: string;
}

/**
 * Task 040 `WindowsJobObjectManager` / Task 041 supervisor shape.
 * Production sessions use `OsWindowsJob`. Callers await every method.
 */
export interface WindowsJobPort {
  create(sessionId: string): JobAssignment | Promise<JobAssignment>;
  attach(jobId: string, pid: number): void | Promise<void>;
  list(jobId: string): readonly number[] | Promise<readonly number[]>;
  activeChildCount(jobId: string): number | Promise<number>;
  kill(jobId: string, reason: string): readonly number[] | Promise<readonly number[]>;
  close(jobId: string): void | Promise<void>;
}

export async function settleJob<T>(value: T | Promise<T>): Promise<T> {
  return await value;
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

export function signalProcess(pid: number): void {
  if (!Number.isInteger(pid) || pid <= 0) return;
  try {
    process.kill(pid, "SIGKILL");
  } catch (error) {
    if (!isMissing(error)) throw error;
  }
}

function isMissing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ESRCH";
}
