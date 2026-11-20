export interface TimeoutHandle {
  cancel(): void;
}

export interface Clock {
  setTimeout(fn: () => void | Promise<void>, ms: number): TimeoutHandle;
}

interface ManualTask {
  at: number;
  fn: () => void | Promise<void>;
  cancelled: boolean;
}

export class ManualClock implements Clock {
  private now = 0;
  private tasks: ManualTask[] = [];

  setTimeout(fn: () => void | Promise<void>, ms: number): TimeoutHandle {
    const task: ManualTask = { at: this.now + ms, fn, cancelled: false };
    this.tasks.push(task);
    return {
      cancel() {
        task.cancelled = true;
      },
    };
  }

  async advance(ms: number): Promise<void> {
    this.now += ms;
    const due = this.tasks.filter((task) => !task.cancelled && task.at <= this.now);
    this.tasks = this.tasks.filter((task) => !task.cancelled && task.at > this.now);
    for (const task of due) {
      await task.fn();
    }
  }
}

export function systemClock(): Clock {
  return {
    setTimeout(fn, ms) {
      const handle = setTimeout(() => {
        void fn();
      }, ms);
      handle.unref();
      return {
        cancel() {
          clearTimeout(handle);
        },
      };
    },
  };
}
