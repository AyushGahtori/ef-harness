import type { NormalizedRuntimeEvent } from "./types.js";

export class SessionEventQueue implements AsyncIterable<NormalizedRuntimeEvent> {
  private readonly items: NormalizedRuntimeEvent[] = [];
  private readonly history: NormalizedRuntimeEvent[] = [];
  private waiting: ((value: NormalizedRuntimeEvent | null) => void) | null = null;
  private closed = false;

  push(event: NormalizedRuntimeEvent): void {
    if (this.closed) return;
    this.history.push(event);
    const waiter = this.waiting;
    if (waiter) {
      this.waiting = null;
      waiter(event);
      return;
    }
    this.items.push(event);
  }

  snapshot(): readonly NormalizedRuntimeEvent[] {
    return this.history;
  }

  get isClosed(): boolean {
    return this.closed;
  }

  close(): void {
    this.closed = true;
    const waiter = this.waiting;
    if (waiter) {
      this.waiting = null;
      waiter(null);
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<NormalizedRuntimeEvent> {
    return {
      next: async (): Promise<IteratorResult<NormalizedRuntimeEvent>> => {
        const queued = this.items.shift();
        if (queued) return { value: queued, done: false };
        if (this.closed) return { value: undefined as never, done: true };
        const value = await new Promise<NormalizedRuntimeEvent | null>((resolve) => {
          this.waiting = resolve;
        });
        if (value === null) return { value: undefined as never, done: true };
        return { value, done: false };
      },
    };
  }
}
