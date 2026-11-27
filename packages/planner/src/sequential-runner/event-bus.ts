import type { KernelEvent } from "./types.js";

interface Waiter {
  match: (event: KernelEvent) => boolean;
  resolve: (event: KernelEvent) => void;
}

/**
 * In-process kernel bus. Waiters sleep on a promise; nothing polls.
 * Events published before a waiter exists are kept until one consumes them.
 */
export class KernelEventBus {
  private waiters: Waiter[] = [];
  private pending: KernelEvent[] = [];
  private listeners: Array<(event: KernelEvent) => void> = [];

  publish(event: KernelEvent): void {
    for (const listener of this.listeners) listener(event);
    const index = this.waiters.findIndex((waiter) => waiter.match(event));
    if (index >= 0) {
      const waiter = this.waiters[index];
      this.waiters.splice(index, 1);
      waiter?.resolve(event);
      return;
    }
    this.pending.push(event);
    if (this.pending.length > 100) this.pending.shift();
  }

  subscribe(listener: (event: KernelEvent) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((item) => item !== listener);
    };
  }

  wait(match: (event: KernelEvent) => boolean): Promise<KernelEvent> {
    const index = this.pending.findIndex(match);
    if (index >= 0) {
      const event = this.pending[index];
      this.pending.splice(index, 1);
      if (event) return Promise.resolve(event);
    }
    return new Promise((resolve) => {
      this.waiters.push({ match, resolve });
    });
  }
}
