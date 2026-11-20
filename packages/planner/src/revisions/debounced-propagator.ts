import { DEFAULT_DEBOUNCE_MS, type FlushReason, type RevisionBatchRecord, type RevisionCommitter, type RevisionEdit } from "./types.js";

export interface Scheduler {
  now(): number;
  schedule(callback: () => void, delayMs: number): { cancel(): void };
}

interface ManualTimer {
  readonly id: number;
  readonly at: number;
  readonly callback: () => void;
  cancelled: boolean;
}

export function systemScheduler(): Scheduler {
  return {
    now: () => Date.now(),
    schedule(callback, delayMs) {
      const handle = setTimeout(callback, delayMs);
      return { cancel: () => clearTimeout(handle) };
    },
  };
}

export class ManualScheduler implements Scheduler {
  private time = 0;
  private nextId = 1;
  private readonly timers: ManualTimer[] = [];

  now(): number {
    return this.time;
  }

  schedule(callback: () => void, delayMs: number): { cancel(): void } {
    const timer: ManualTimer = {
      id: this.nextId,
      at: this.time + delayMs,
      callback,
      cancelled: false,
    };
    this.nextId += 1;
    this.timers.push(timer);
    return {
      cancel: () => {
        timer.cancelled = true;
      },
    };
  }

  advance(ms: number): void {
    const target = this.time + ms;
    for (;;) {
      const due = this.timers
        .filter((timer) => !timer.cancelled && timer.at <= target)
        .sort((left, right) => left.at - right.at || left.id - right.id);
      const next = due[0];
      if (!next) break;
      this.time = next.at;
      next.cancelled = true;
      next.callback();
    }
    this.time = target;
  }
}

export class DebouncedRevisionPropagator {
  private readonly pending: RevisionEdit[] = [];
  private timer: { cancel(): void } | null = null;
  readonly batches: RevisionBatchRecord[] = [];

  constructor(
    private readonly committer: RevisionCommitter,
    private readonly scheduler: Scheduler = systemScheduler(),
    private readonly debounceMs = DEFAULT_DEBOUNCE_MS,
  ) {}

  submit(edit: RevisionEdit): void {
    this.pending.push(edit);
    this.timer?.cancel();
    this.timer = this.scheduler.schedule(() => {
      this.timer = null;
      this.flush("debounce");
    }, this.debounceMs);
  }

  apply(): RevisionBatchRecord | null {
    return this.flush("apply");
  }

  start(): RevisionBatchRecord | null {
    return this.flush("start");
  }

  flush(reason: FlushReason): RevisionBatchRecord | null {
    this.timer?.cancel();
    this.timer = null;
    if (this.pending.length === 0) return null;
    const edits = this.pending.splice(0, this.pending.length);
    const triggerSource = reason === "debounce" ? sharedSource(edits) : reason;
    const batch = this.committer.commitBatch({ edits, triggerSource, flushReason: reason });
    this.batches.push(batch);
    return batch;
  }
}

function sharedSource(edits: readonly RevisionEdit[]): string {
  const first = edits[0]?.triggerSource ?? "mixed";
  return edits.every((edit) => edit.triggerSource === first) ? first : "mixed";
}
