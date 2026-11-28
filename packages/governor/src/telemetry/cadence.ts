import { ACTIVE_POLL_MS, IDLE_POLL_MS, type CollectorCadence } from "./types.js";

export function pollIntervalMs(cadence: CollectorCadence): number | null {
  if (cadence === "suspended") return null;
  if (cadence === "active") return ACTIVE_POLL_MS;
  return IDLE_POLL_MS;
}

export interface Scheduler {
  set(delayMs: number, fn: () => void): void;
  clear(): void;
}

export class TimeoutScheduler implements Scheduler {
  private timer: ReturnType<typeof setTimeout> | null = null;

  set(delayMs: number, fn: () => void): void {
    this.clear();
    this.timer = setTimeout(fn, delayMs);
  }

  clear(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }
}

export class ManualScheduler implements Scheduler {
  private queued: { readonly delayMs: number; readonly fn: () => void } | null = null;

  set(delayMs: number, fn: () => void): void {
    this.queued = { delayMs, fn };
  }

  clear(): void {
    this.queued = null;
  }

  pendingDelay(): number | null {
    return this.queued?.delayMs ?? null;
  }

  fire(): void {
    const queued = this.queued;
    this.queued = null;
    queued?.fn();
  }
}
