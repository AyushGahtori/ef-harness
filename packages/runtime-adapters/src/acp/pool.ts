export const WAITING_FOR_RUN_SLOT = "Waiting for run slot" as const;

export interface ExecutionLease {
  readonly leaseId: string;
  readonly taskId: string;
  readonly command: string;
}

export interface PoolWaitNotice {
  readonly taskId: string;
  readonly command: string;
  readonly status: typeof WAITING_FOR_RUN_SLOT;
  readonly running: number;
  readonly capacity: number;
}

/**
 * Local port of Task 119 `WarmExecutionSlotPool`.
 * Capacity defaults to the laptop floor of 2 warm slots.
 */
export interface WarmExecutionPoolPort {
  readonly capacity: number;
  runningCount(): number;
  acquire(request: { readonly taskId: string; readonly command: string }): Promise<ExecutionLease>;
  release(leaseId: string): void;
}

export class LocalWarmExecutionPool implements WarmExecutionPoolPort {
  private active = 0;
  private nextId = 1;
  private readonly leases = new Set<string>();
  private readonly waiters: Array<{
    readonly taskId: string;
    readonly command: string;
    readonly resolve: (lease: ExecutionLease) => void;
  }> = [];

  constructor(
    readonly capacity = 2,
    private readonly onWaiting: (notice: PoolWaitNotice) => void = () => undefined,
  ) {
    if (!Number.isInteger(capacity) || capacity < 1) throw new Error("Pool capacity must be a positive integer");
  }

  runningCount(): number {
    return this.active;
  }

  acquire(request: { readonly taskId: string; readonly command: string }): Promise<ExecutionLease> {
    if (this.active < this.capacity) return Promise.resolve(this.grant(request.taskId, request.command));
    return new Promise((resolve) => {
      this.waiters.push({ taskId: request.taskId, command: request.command, resolve });
      this.onWaiting({
        taskId: request.taskId,
        command: request.command,
        status: WAITING_FOR_RUN_SLOT,
        running: this.active,
        capacity: this.capacity,
      });
    });
  }

  release(leaseId: string): void {
    if (!this.leases.delete(leaseId)) return;
    this.active -= 1;
    const next = this.waiters.shift();
    if (!next) return;
    next.resolve(this.grant(next.taskId, next.command));
  }

  private grant(taskId: string, command: string): ExecutionLease {
    const leaseId = `pool-${this.nextId}`;
    this.nextId += 1;
    this.active += 1;
    this.leases.add(leaseId);
    return { leaseId, taskId, command };
  }
}
