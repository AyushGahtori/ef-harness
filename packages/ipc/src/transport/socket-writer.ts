import type net from "node:net";
import { ConnectionClosedError, OutboundBufferLimitError } from "./errors.js";

type WriteCallback = (error?: Error | null) => void;

export interface WritableByteChannel {
  readonly destroyed: boolean;
  write(chunk: Buffer, callback?: WriteCallback): boolean;
  once(event: "drain" | "error" | "close", listener: (...args: unknown[]) => void): unknown;
  off(event: "drain" | "error" | "close", listener: (...args: unknown[]) => void): unknown;
}

/**
 * Serializes socket writes, waits for `drain` when the kernel buffer is full,
 * and rejects further frames once the per-connection cap would be exceeded.
 */
export class SocketWriter {
  private buffered = 0;
  private chain: Promise<void> = Promise.resolve();
  private closed = false;

  constructor(
    private readonly socket: WritableByteChannel,
    private readonly maxBytes: number,
  ) {}

  get bufferedBytes(): number {
    return this.buffered;
  }

  write(frame: Buffer): Promise<void> {
    if (this.closed || this.socket.destroyed) return Promise.reject(new ConnectionClosedError());
    const bytes = frame.byteLength;
    if (this.buffered + bytes > this.maxBytes) {
      return Promise.reject(new OutboundBufferLimitError(this.buffered, bytes, this.maxBytes));
    }
    this.buffered += bytes;
    const task = this.chain.then(() => this.flush(frame, bytes));
    this.chain = task.then(
      () => undefined,
      () => undefined,
    );
    return task;
  }

  close(): void {
    this.closed = true;
  }

  private flush(frame: Buffer, bytes: number): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.closed || this.socket.destroyed) {
        this.buffered -= bytes;
        reject(new ConnectionClosedError());
        return;
      }
      let wrote = false;
      let drained = true;
      let settled = false;
      const finish = (error?: Error): void => {
        if (settled || !wrote || !drained) return;
        settled = true;
        this.socket.off("error", onError);
        this.socket.off("close", onClose);
        this.socket.off("drain", onDrain);
        this.buffered -= bytes;
        if (error) reject(error);
        else resolve();
      };
      const onError = (error: unknown): void => {
        wrote = true;
        drained = true;
        finish(error instanceof Error ? error : new ConnectionClosedError());
      };
      const onClose = (): void => {
        wrote = true;
        drained = true;
        finish(new ConnectionClosedError());
      };
      const onDrain = (): void => {
        drained = true;
        finish();
      };
      this.socket.once("error", onError);
      this.socket.once("close", onClose);
      const accepted = this.socket.write(frame, (error) => {
        wrote = true;
        finish(error ?? undefined);
      });
      if (!accepted) {
        drained = false;
        this.socket.once("drain", onDrain);
      }
    });
  }
}

export function asWritable(socket: net.Socket): WritableByteChannel {
  return socket;
}
