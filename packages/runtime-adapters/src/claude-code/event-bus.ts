import type { NormalizedRuntimeEvent } from "./types.js";

/**
 * Local stand-in for Task 142 `NormalizedRuntimeEventBus`.
 */
export class NormalizedRuntimeEventBus {
  private readonly history = new Map<string, NormalizedRuntimeEvent[]>();
  private readonly listeners = new Map<string, Set<(event: NormalizedRuntimeEvent) => void>>();

  publish(event: NormalizedRuntimeEvent): void {
    const list = this.history.get(event.sessionId) ?? [];
    list.push(event);
    this.history.set(event.sessionId, list);
    for (const listener of this.listeners.get(event.sessionId) ?? []) listener(event);
  }

  historyOf(sessionId: string): readonly NormalizedRuntimeEvent[] {
    return [...(this.history.get(sessionId) ?? [])];
  }

  async *stream(sessionId: string): AsyncGenerator<NormalizedRuntimeEvent> {
    const queue: NormalizedRuntimeEvent[] = [];
    const seen = new Set<NormalizedRuntimeEvent>();
    let wake: (() => void) | undefined;
    const listener = (event: NormalizedRuntimeEvent) => {
      queue.push(event);
      const notify = wake;
      wake = undefined;
      notify?.();
    };
    this.addListener(sessionId, listener);
    try {
      for (const event of this.historyOf(sessionId)) {
        seen.add(event);
        yield event;
      }
      for (;;) {
        const next = await this.pull(queue, () => {
          wake = undefined;
        }, (resolve) => {
          if (queue.length > 0) {
            resolve();
            return;
          }
          wake = resolve;
        });
        if (!next) continue;
        if (seen.has(next)) continue;
        seen.add(next);
        yield next;
      }
    } finally {
      this.removeListener(sessionId, listener);
    }
  }

  private async pull(
    queue: NormalizedRuntimeEvent[],
    clearWake: () => void,
    arm: (resolve: () => void) => void,
  ): Promise<NormalizedRuntimeEvent | undefined> {
    const existing = queue.shift();
    if (existing) return existing;
    await new Promise<void>((resolve) => {
      arm(resolve);
    });
    clearWake();
    return queue.shift();
  }

  private addListener(sessionId: string, listener: (event: NormalizedRuntimeEvent) => void): void {
    const set = this.listeners.get(sessionId) ?? new Set();
    set.add(listener);
    this.listeners.set(sessionId, set);
  }

  private removeListener(sessionId: string, listener: (event: NormalizedRuntimeEvent) => void): void {
    this.listeners.get(sessionId)?.delete(listener);
  }
}
