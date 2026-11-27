import type { JsonRpcNotification, ProtocolConnection } from "../../src/protocol/ports.js";

export class MemoryConnection implements ProtocolConnection {
  readonly sent: JsonRpcNotification[] = [];
  closeOnSend = false;
  onSend: ((message: JsonRpcNotification) => void) | null = null;
  private closed = false;
  private writable = true;
  private readonly closeListeners: Array<() => void> = [];
  private readonly writableListeners: Array<() => void> = [];

  constructor(readonly connectionId: string) {}

  send(message: JsonRpcNotification): void {
    if (this.closed) return;
    this.sent.push(message);
    this.onSend?.(message);
    if (this.closeOnSend) this.close();
  }

  onClose(listener: () => void): () => void {
    this.closeListeners.push(listener);
    return () => {
      const index = this.closeListeners.indexOf(listener);
      if (index >= 0) this.closeListeners.splice(index, 1);
    };
  }

  isClosed(): boolean {
    return this.closed;
  }

  isWritable(): boolean {
    return this.writable && !this.closed;
  }

  onWritable(listener: () => void): () => void {
    this.writableListeners.push(listener);
    return () => {
      const index = this.writableListeners.indexOf(listener);
      if (index >= 0) this.writableListeners.splice(index, 1);
    };
  }

  setWritable(value: boolean): void {
    this.writable = value;
    if (value && !this.closed) {
      for (const listener of [...this.writableListeners]) listener();
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.writable = false;
    for (const listener of [...this.closeListeners]) listener();
  }
}

export function rpc(
  method: string,
  params: Record<string, unknown>,
  id: number,
  opId?: string,
): {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params: Record<string, unknown>;
  op_id?: string;
} {
  const message = { jsonrpc: "2.0" as const, id, method, params };
  if (opId === undefined) return message;
  return { ...message, op_id: opId };
}
