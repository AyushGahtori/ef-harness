import { pathOverlapsLease } from "./path-prefix.js";
import type { SweepLeasePort, TaskRuntimePort } from "./ports.js";
import { SweepLeaseCoordinator } from "./sweep-lease-coordinator.js";
import type { DrainProgress, DrainResult } from "./types.js";
import { ACTIVE_OVERLAP_TASK_STATES } from "./types.js";

export type MaintenanceWindowDrainerOptions = {
  readonly leases: SweepLeasePort;
  readonly tasks: TaskRuntimePort;
  readonly pollIntervalMs?: number;
  readonly drainTimeoutMs?: number;
};

export type DrainUntilGrantedInput = {
  readonly leaseId: string;
  readonly sweepTask: string;
  readonly sweepLabel: string;
  readonly leasePrefixes: readonly string[];
  readonly isCancelled: () => boolean;
  readonly onProgress?: (progress: DrainProgress) => void;
};

export class MaintenanceWindowDrainer {
  private readonly coordinator: SweepLeaseCoordinator;
  private readonly tasks: TaskRuntimePort;
  private readonly pollIntervalMs: number;
  private readonly drainTimeoutMs: number;

  constructor(options: MaintenanceWindowDrainerOptions) {
    this.coordinator = new SweepLeaseCoordinator({ leases: options.leases });
    this.tasks = options.tasks;
    this.pollIntervalMs = options.pollIntervalMs ?? 50;
    this.drainTimeoutMs = options.drainTimeoutMs ?? 120_000;
  }

  async drainUntilGranted(input: DrainUntilGrantedInput): Promise<DrainResult> {
    const started = Date.now();
    const overlapping = () => this.overlappingActiveTasks(input.leasePrefixes, input.sweepTask);

    while (true) {
      if (input.isCancelled()) {
        this.coordinator.release(input.leaseId);
        return { ok: false, reason: "cancelled" };
      }
      const active = overlapping();
      const done = this.countDrained(input.leasePrefixes, input.sweepTask);
      input.onProgress?.({
        sweepLabel: input.sweepLabel,
        overlappingActive: active.length,
        overlappingDone: done,
        cancellable: true,
        message: this.formatProgress(input.sweepLabel, active.length, done),
      });
      for (const task of active) {
        await this.tasks.requestDrain(task.taskId);
      }
      const grant = this.coordinator.tryGrant(input.leaseId);
      if (grant.granted) {
        input.onProgress?.({
          sweepLabel: input.sweepLabel,
          overlappingActive: 0,
          overlappingDone: done,
          cancellable: true,
          message: this.formatProgress(input.sweepLabel, 0, done),
        });
        return { ok: true, granted: grant };
      }
      if (Date.now() - started > this.drainTimeoutMs) {
        this.coordinator.release(input.leaseId);
        return { ok: false, reason: "drain_timeout" };
      }
      await sleep(this.pollIntervalMs);
    }
  }

  formatProgress(label: string, activeCount: number, doneCount: number): string {
    if (activeCount === 0) {
      return `Starting '${label}' sweep maintenance window`;
    }
    return `Waiting for ${activeCount} active task${activeCount === 1 ? "" : "s"} to finish before starting '${label}' sweep (${doneCount}/${doneCount + activeCount} done) · Cancel`;
  }

  private overlappingActiveTasks(leasePrefixes: readonly string[], sweepTask: string) {
    return this.tasks.listActiveTasks().filter((task) => {
      if (task.taskId === sweepTask) return false;
      if (!ACTIVE_OVERLAP_TASK_STATES.includes(task.state as (typeof ACTIVE_OVERLAP_TASK_STATES)[number])) {
        return false;
      }
      return task.pathPrefixes.some((prefix) => pathOverlapsLease(prefix, leasePrefixes));
    });
  }

  private countDrained(leasePrefixes: readonly string[], sweepTask: string): number {
    const related = this.tasks.listActiveTasks().filter((task) => {
      if (task.taskId === sweepTask) return false;
      return task.pathPrefixes.some((prefix) => pathOverlapsLease(prefix, leasePrefixes));
    });
    const stillActive = related.filter((task) =>
      ACTIVE_OVERLAP_TASK_STATES.includes(task.state as (typeof ACTIVE_OVERLAP_TASK_STATES)[number]),
    );
    return related.length - stillActive.length;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}