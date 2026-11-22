import type { DaemonSnapshot, HarnessdEvent } from "./types.js";

/**
 * One harnessd stream for the main window and every pop-out. Windows subscribe;
 * they do not keep a private copy of daemon events.
 */
export class SharedHarnessdStream {
  private readonly events: HarnessdEvent[] = [];
  private readonly listeners = new Set<(event: HarnessdEvent) => void>();

  subscribe(listener: (event: HarnessdEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  publish(event: HarnessdEvent): void {
    const last = this.events.at(-1)?.seq ?? 0;
    if (event.seq <= last) {
      throw new Error(`harnessd seq ${event.seq.toString()} does not advance ${last.toString()}`);
    }
    this.events.push(event);
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  snapshot(): DaemonSnapshot {
    return {
      lastSeq: this.events.at(-1)?.seq ?? 0,
      events: this.events,
    };
  }

  subscriberCount(): number {
    return this.listeners.size;
  }
}
