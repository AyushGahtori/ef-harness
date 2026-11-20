export interface TimeoutScheduler {
  schedule(callback: () => void, ms: number): number;
  clear(handle: number): void;
}

export function systemScheduler(): TimeoutScheduler {
  const handles = new Map<number, ReturnType<typeof setTimeout>>();
  let nextId = 1;
  return {
    schedule(callback, ms) {
      const id = nextId;
      nextId += 1;
      const timer = setTimeout(() => {
        handles.delete(id);
        callback();
      }, ms);
      handles.set(id, timer);
      return id;
    },
    clear(handle) {
      const timer = handles.get(handle);
      if (timer === undefined) return;
      clearTimeout(timer);
      handles.delete(handle);
    },
  };
}

export interface FakeScheduler extends TimeoutScheduler {
  readonly now: () => number;
  readonly pending: () => number;
  readonly advance: (ms: number) => void;
}

export function createFakeScheduler(): FakeScheduler {
  let now = 0;
  let nextId = 1;
  const timers = new Map<number, { at: number; callback: () => void }>();
  return {
    now: () => now,
    pending: () => timers.size,
    schedule(callback, ms) {
      const id = nextId;
      nextId += 1;
      timers.set(id, { at: now + ms, callback });
      return id;
    },
    clear(handle) {
      timers.delete(handle);
    },
    advance(ms) {
      const target = now + ms;
      for (;;) {
        let dueId: number | null = null;
        let dueAt = target + 1;
        for (const [id, timer] of timers) {
          if (timer.at <= target && timer.at < dueAt) {
            dueId = id;
            dueAt = timer.at;
          }
        }
        if (dueId === null) break;
        const timer = timers.get(dueId);
        timers.delete(dueId);
        now = dueAt;
        timer?.callback();
      }
      now = target;
    },
  };
}
