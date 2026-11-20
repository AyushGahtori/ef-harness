import { binaryStreamId, framePayloadLength } from "./frame.js";
import type { OutboundLane, StreamOutput } from "./ports.js";

export interface WriteObserver {
  onBinaryTaken?(frame: Buffer): void;
  onBinarySent?(frame: Buffer): void;
  onControlSent?(frame: Buffer): void;
}

/**
 * Drains channel 0 (and other control-lane frames) before any queued channel 1
 * chunk. `pauseBinary` holds bulk chunks without blocking a later control frame.
 */
export class PriorityWriter implements StreamOutput {
  private readonly control: Buffer[] = [];
  private readonly binary: Buffer[] = [];
  private pumping = false;
  private closed = false;
  private binaryPaused = false;
  private waiter: (() => void) | null = null;
  readonly observer: WriteObserver = {};
  private queuedPayload = 0;

  constructor(private readonly writeFrame: (frame: Buffer) => Promise<void>) {}

  get binaryPayloadBytes(): number {
    return this.queuedPayload;
  }

  binaryStreamIds(): number[] {
    const ids: number[] = [];
    for (const frame of this.binary) {
      const id = binaryStreamId(frame);
      if (id !== null) ids.push(id);
    }
    return ids;
  }

  pauseBinary(): void {
    this.binaryPaused = true;
  }

  resumeBinary(): void {
    this.binaryPaused = false;
    this.wake();
    void this.pump();
  }

  enqueue(frame: Uint8Array, lane: OutboundLane): void {
    if (this.closed) return;
    const copy = Buffer.isBuffer(frame) ? frame : Buffer.from(frame);
    if (lane === "control") this.control.push(copy);
    else {
      this.binary.push(copy);
      this.queuedPayload += framePayloadLength(copy);
    }
    this.wake();
    void this.pump();
  }

  dropBinaryStream(streamId: number): number {
    let dropped = 0;
    const kept: Buffer[] = [];
    for (const frame of this.binary) {
      if (binaryStreamId(frame) === streamId) dropped += framePayloadLength(frame);
      else kept.push(frame);
    }
    this.binary.length = 0;
    this.binary.push(...kept);
    this.queuedPayload -= dropped;
    if (this.queuedPayload < 0) this.queuedPayload = 0;
    return dropped;
  }

  close(): void {
    this.closed = true;
    this.control.length = 0;
    this.binary.length = 0;
    this.queuedPayload = 0;
    this.wake();
  }

  private wake(): void {
    const waiter = this.waiter;
    this.waiter = null;
    waiter?.();
  }

  private waitForWake(): Promise<void> {
    return new Promise((resolve) => {
      this.waiter = resolve;
    });
  }

  private async pump(): Promise<void> {
    if (this.pumping) return;
    this.pumping = true;
    try {
      for (;;) {
        if (this.closed) return;
        const control = this.control.shift();
        if (control) {
          await this.writeFrame(control);
          if (this.closed) return;
          this.observer.onControlSent?.(control);
          continue;
        }
        if (this.binary.length === 0) return;
        if (this.binaryPaused) {
          await this.waitForWake();
          continue;
        }
        const frame = this.binary.shift();
        if (!frame) return;
        this.queuedPayload -= framePayloadLength(frame);
        if (this.queuedPayload < 0) this.queuedPayload = 0;
        this.observer.onBinaryTaken?.(frame);
        await this.writeFrame(frame);
        if (this.closed) return;
        this.observer.onBinarySent?.(frame);
      }
    } catch {
      this.closed = true;
      this.control.length = 0;
      this.binary.length = 0;
      this.queuedPayload = 0;
    } finally {
      this.pumping = false;
    }
    if (!this.closed && (this.control.length > 0 || (this.binary.length > 0 && !this.binaryPaused))) {
      void this.pump();
    }
  }
}
