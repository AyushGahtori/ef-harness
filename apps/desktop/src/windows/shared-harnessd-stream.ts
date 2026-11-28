import type { DaemonSnapshot, HarnessdEvent } from "./types.js";

/**
 * One harnessd stream for the main window and every pop-out. Windows subscribe;
 * they do not keep a private copy of daemon events.
 */
const EVENT_RING_LIMIT = 256;

export class SharedHarnessdStream {
  private events: HarnessdEvent[] = [];
  private readonly listeners = new Set<(event: HarnessdEvent) => void>();
  private streamEpoch = "";
  private lastSeq = 0;

  subscribe(listener: (event: HarnessdEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  publish(event: HarnessdEvent): void {
    const epoch = event.streamEpoch ?? this.streamEpoch;
    if (epoch !== this.streamEpoch) {
      this.streamEpoch = epoch;
      this.lastSeq = 0;
      this.events = [];
    }
    if (event.seq <= this.lastSeq) return;
    this.lastSeq = event.seq;
    this.events.push(event);
    if (this.events.length > EVENT_RING_LIMIT) {
      this.events.splice(0, this.events.length - EVENT_RING_LIMIT);
    }
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  snapshot(): DaemonSnapshot {
    return {
      lastSeq: this.lastSeq,
      streamEpoch: this.streamEpoch,
      events: this.events,
    };
  }

  subscriberCount(): number {
    return this.listeners.size;
  }
}
