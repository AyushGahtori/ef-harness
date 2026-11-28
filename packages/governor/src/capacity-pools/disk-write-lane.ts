import { CapacityError } from "./errors.js";
import {
  DISK_ACTIVE_PAUSE_MS,
  DISK_ACTIVE_PAUSE_PERCENT,
  isDiskWriteKind,
  type DiskWriteKind,
} from "./types.js";

/**
 * One async lane for git worktree, pnpm unpack, SQLite maintenance, and CAS sweeps.
 * Parallel callers never overlap, so NTFS EBUSY / EPERM storms do not start.
 */
export class SingleDiskWriteLane {
  private tail: Promise<void> = Promise.resolve();
  private active = 0;
  private peak = 0;
  private paused = false;
  private highSince: number | null = null;
  private readonly resumeWaiters: Array<() => void> = [];
  private completed = 0;

  get activeCount(): number {
    return this.active;
  }

  get peakConcurrent(): number {
    return this.peak;
  }

  get isPaused(): boolean {
    return this.paused;
  }

  get completedCount(): number {
    return this.completed;
  }

  /**
   * Telemetry feed. Active time at or above 80% for 10s pauses new lane entries.
   * The operation already inside the lane is left alone.
   */
  reportDiskActivity(activePercent: number, atMs: number): void {
    if (!Number.isFinite(activePercent) || activePercent < 0) {
      throw new CapacityError("disk", "Disk active percent must be a non-negative finite number");
    }
    if (!Number.isFinite(atMs)) {
      throw new CapacityError("disk", "Disk activity timestamp must be finite");
    }
    if (activePercent >= DISK_ACTIVE_PAUSE_PERCENT) {
      if (this.highSince === null || atMs < this.highSince) this.highSince = atMs;
      if (atMs - this.highSince >= DISK_ACTIVE_PAUSE_MS) this.paused = true;
      return;
    }
    this.highSince = null;
    if (!this.paused) return;
    this.paused = false;
    const pending = this.resumeWaiters.splice(0, this.resumeWaiters.length);
    for (const resume of pending) resume();
  }

  run<T>(kind: DiskWriteKind, operation: () => Promise<T>): Promise<T> {
    if (!isDiskWriteKind(kind)) {
      throw new CapacityError("disk", `Unsupported disk write kind ${String(kind)}`);
    }
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const previous = this.tail;
    this.tail = previous.then(() => gate);
    return previous.then(async () => {
      try {
        await this.waitWhilePaused();
        this.active += 1;
        if (this.active > this.peak) this.peak = this.active;
        return await operation();
      } finally {
        if (this.active > 0) this.active -= 1;
        this.completed += 1;
        release();
      }
    });
  }

  private waitWhilePaused(): Promise<void> {
    if (!this.paused) return Promise.resolve();
    return new Promise((resolve) => {
      this.resumeWaiters.push(resolve);
    });
  }
}
