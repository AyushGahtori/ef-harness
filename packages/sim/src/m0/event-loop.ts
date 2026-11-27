import type { FakeDualClock } from "./clock.js";
import { CrashSignal } from "./faults.js";
import type { SimTrace } from "./trace.js";

interface Scheduled {
  mono: number;
  seq: number;
  kind: string;
  run: () => void | Promise<void>;
}

/**
 * Single-threaded deterministic event loop. Events run in (monotonic time, sequence) order.
 * A crash signal is recovered by the caller and the rest of the schedule continues.
 */
export class SimEventLoop {
  private seq = 0;
  private ran = 0;
  private readonly queue: Scheduled[] = [];

  constructor(
    private readonly clock: FakeDualClock,
    private readonly trace: SimTrace,
    private readonly maxEvents: number | undefined,
  ) {}

  get eventsRun(): number {
    return this.ran;
  }

  schedule(delayMs: number, kind: string, run: () => void | Promise<void>): void {
    if (!Number.isFinite(delayMs) || delayMs < 0) {
      throw new Error("schedule delay must be a non-negative finite number");
    }
    this.queue.push({
      mono: this.clock.monoMs() + delayMs,
      seq: this.seq,
      kind,
      run,
    });
    this.seq += 1;
  }

  async run(onCrash: (signal: CrashSignal) => void | Promise<void>): Promise<void> {
    while (this.queue.length > 0) {
      if (this.maxEvents !== undefined && this.ran >= this.maxEvents) return;
      this.queue.sort((left, right) => left.mono - right.mono || left.seq - right.seq);
      const next = this.queue.shift();
      if (!next) return;
      const delta = next.mono - this.clock.monoMs();
      if (delta > 0) this.clock.advance(delta);
      this.ran += 1;
      this.trace.add(this.clock, next.kind, "start");
      try {
        const outcome = next.run();
        if (outcome instanceof Promise) await outcome;
        this.trace.add(this.clock, next.kind, "ok");
      } catch (error) {
        if (error instanceof CrashSignal) {
          this.trace.add(this.clock, "crash", error.point);
          const recovered = onCrash(error);
          if (recovered instanceof Promise) await recovered;
          this.trace.add(this.clock, next.kind, "recovered");
          continue;
        }
        throw error;
      }
    }
  }
}
