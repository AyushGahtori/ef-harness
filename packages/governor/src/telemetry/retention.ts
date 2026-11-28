import { estimateJsonBytes } from "./ports.js";
import type { HardwareSnapshot, TelemetryEventInput } from "./types.js";
import { DEFAULT_FLUSH_CAP, DEFAULT_RING_CAPACITY, MAX_COLLECTOR_RAM_BYTES } from "./types.js";
import type { TelemetryDbRepo } from "./ports.js";

interface RetainedSnapshot {
  readonly snapshot: HardwareSnapshot;
  readonly bytes: number;
}

export class TelemetryRingBuffer {
  private readonly items: RetainedSnapshot[] = [];
  private bytes = 0;

  constructor(
    private readonly capacity = DEFAULT_RING_CAPACITY,
    private readonly maxBytes = MAX_COLLECTOR_RAM_BYTES,
  ) {}

  push(snapshot: HardwareSnapshot): void {
    const retained = { snapshot, bytes: estimateJsonBytes(snapshot) };
    this.items.push(retained);
    this.bytes += retained.bytes;
    this.shrink();
  }

  latest(): HardwareSnapshot | null {
    return this.items.at(-1)?.snapshot ?? null;
  }

  get length(): number {
    return this.items.length;
  }

  estimatedBytes(): number {
    return this.bytes;
  }

  private shrink(): void {
    while (this.items.length > this.capacity || (this.bytes > this.maxBytes && this.items.length > 0)) {
      const removed = this.items.shift();
      if (!removed) return;
      this.bytes -= removed.bytes;
    }
  }
}

export class TelemetryFlushBuffer {
  private pending: TelemetryEventInput[] = [];
  private bytes = 0;

  constructor(private readonly cap = DEFAULT_FLUSH_CAP) {}

  push(event: TelemetryEventInput): void {
    this.pending.push(event);
    this.bytes += estimateJsonBytes(event.data) + 64;
    while (this.pending.length > this.cap) {
      const removed = this.pending.shift();
      if (!removed) break;
      this.bytes -= estimateJsonBytes(removed.data) + 64;
    }
  }

  flush(repo: TelemetryDbRepo): void {
    for (const event of this.pending) repo.enqueue(event);
    repo.flush();
    this.pending = [];
    this.bytes = 0;
  }

  get length(): number {
    return this.pending.length;
  }

  estimatedBytes(): number {
    return this.bytes;
  }
}
