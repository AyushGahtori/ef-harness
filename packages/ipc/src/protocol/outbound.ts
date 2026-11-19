import type { JsonRpcNotification, ProtocolConnection } from "./ports.js";

/**
 * Domain batches and telemetry never share one FIFO. A slow socket sheds the
 * oldest telemetry notices and always flushes events.batch first.
 */
export class ClientOutbound {
  private readonly domain: JsonRpcNotification[] = [];
  private readonly telemetry: JsonRpcNotification[] = [];
  private flushing = false;
  private stopped = false;
  droppedTelemetry = 0;
  private readonly stopWritable: () => void;

  constructor(
    private readonly connection: ProtocolConnection,
    private readonly maxTelemetry: number,
    private readonly onDropped: (count: number) => void,
    private readonly onSent: (message: JsonRpcNotification) => void,
  ) {
    this.stopWritable = this.connection.onWritable(() => {
      this.kick();
    });
  }

  /** Drop unsent notices when the subscription is aborted or the socket closes. */
  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.domain.length = 0;
    const leftover = this.telemetry.length;
    this.telemetry.length = 0;
    this.noteDropped(leftover);
    this.stopWritable();
  }

  get pendingDomain(): number {
    return this.domain.length;
  }

  enqueueDomain(message: JsonRpcNotification): void {
    if (this.stopped || this.connection.isClosed()) return;
    this.domain.push(message);
    this.kick();
  }

  enqueueTelemetry(message: JsonRpcNotification): void {
    if (this.stopped || this.connection.isClosed()) return;
    this.telemetry.push(message);
    this.shedToCap();
    this.kick();
  }

  private shedToCap(): void {
    let dropped = 0;
    while (this.telemetry.length > this.maxTelemetry) {
      this.telemetry.shift();
      dropped += 1;
    }
    this.noteDropped(dropped);
  }

  private noteDropped(count: number): void {
    if (count <= 0) return;
    this.droppedTelemetry += count;
    this.onDropped(count);
  }

  private kick(): void {
    if (this.flushing) return;
    this.flushing = true;
    try {
      for (;;) {
        if (this.stopped) break;
        if (this.connection.isClosed()) {
          this.domain.length = 0;
          const leftover = this.telemetry.length;
          this.telemetry.length = 0;
          this.noteDropped(leftover);
          break;
        }
        if (!this.connection.isWritable()) break;
        const next = this.domain.length > 0 ? this.domain.shift() : this.telemetry.shift();
        if (!next) break;
        this.connection.send(next);
        this.onSent(next);
      }
    } finally {
      this.flushing = false;
    }
    if (
      !this.stopped &&
      !this.connection.isClosed() &&
      this.connection.isWritable() &&
      (this.domain.length > 0 || this.telemetry.length > 0)
    ) {
      this.kick();
    }
  }
}
