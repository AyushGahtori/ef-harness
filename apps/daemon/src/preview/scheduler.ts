import type { PreviewScheduler } from "./ports.js";

export const systemPreviewScheduler: PreviewScheduler = {
  schedule(delayMs, fn) {
    const timer = setTimeout(() => {
      void fn();
    }, delayMs);
    return {
      cancel() {
        clearTimeout(timer);
      },
    };
  },
};

interface ScheduledTask {
  at: number;
  fn: () => void | Promise<void>;
  cancelled: boolean;
}

/** Virtual clock for the 15-minute hidden suspend without waiting on wall time. */
export class ManualPreviewScheduler implements PreviewScheduler {
  nowMs = 0;
  private readonly tasks: ScheduledTask[] = [];

  schedule(delayMs: number, fn: () => void | Promise<void>): { cancel(): void } {
    const task: ScheduledTask = { at: this.nowMs + delayMs, fn, cancelled: false };
    this.tasks.push(task);
    return {
      cancel() {
        task.cancelled = true;
      },
    };
  }

  async advance(ms: number): Promise<void> {
    this.nowMs += ms;
    const due = this.tasks
      .filter((task) => !task.cancelled && task.at <= this.nowMs)
      .sort((left, right) => left.at - right.at);
    for (const task of due) {
      task.cancelled = true;
      await task.fn();
    }
  }
}
