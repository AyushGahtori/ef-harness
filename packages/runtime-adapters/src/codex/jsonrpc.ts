import { StringDecoder } from "node:string_decoder";
import { CodexRuntimeError } from "./errors.js";
import type { SpawnedProcess } from "./process.js";

export type JsonRpcId = number | string;

export interface JsonRpcRequest {
  readonly jsonrpc: "2.0";
  readonly id: JsonRpcId;
  readonly method: string;
  readonly params?: unknown;
}

export interface JsonRpcNotification {
  readonly jsonrpc: "2.0";
  readonly method: string;
  readonly params?: unknown;
}

interface PendingCall {
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: Error) => void;
  readonly timer: NodeJS.Timeout;
}

export interface JsonRpcSink {
  onRequest(request: JsonRpcRequest): void;
  onNotification(notification: JsonRpcNotification): void;
  onProtocolError(error: CodexRuntimeError): void;
}

const MAX_BUFFER = 8 * 1024 * 1024;

export class StdioJsonRpcPeer {
  private buffer = "";
  private nextId = 1;
  private readonly pending = new Map<string, PendingCall>();
  private closed = false;
  private readonly decoder = new StringDecoder("utf8");

  constructor(
    private readonly proc: SpawnedProcess,
    private readonly sink: JsonRpcSink,
    private readonly requestTimeoutMs = 15_000,
  ) {
    this.proc.stdout.on("data", (chunk: Buffer | string) => {
      this.onStdout(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    });
    this.proc.onExit(() => {
      this.closed = true;
      const error = new CodexRuntimeError("process_exit", "codex process exited");
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timer);
        pending.reject(error);
      }
      this.pending.clear();
    });
  }

  request(method: string, params: unknown, timeoutMs = this.requestTimeoutMs): Promise<unknown> {
    if (this.closed) {
      return Promise.reject(new CodexRuntimeError("closed", "codex process is closed"));
    }
    const id = this.nextId;
    this.nextId += 1;
    const key = String(id);
    const promise = new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!this.pending.has(key)) return;
        this.pending.delete(key);
        reject(new CodexRuntimeError("timeout", `${method} timed out`));
      }, timeoutMs);
      this.pending.set(key, { resolve, reject, timer });
    });
    this.write({ jsonrpc: "2.0", id, method, params });
    return promise;
  }

  respond(id: JsonRpcId, result: unknown): void {
    this.write({ jsonrpc: "2.0", id, result });
  }

  get isClosed(): boolean {
    return this.closed;
  }

  private write(message: unknown): void {
    this.proc.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private onStdout(chunk: Buffer): void {
    this.buffer += this.decoder.write(chunk);
    if (this.buffer.length > MAX_BUFFER) {
      this.buffer = "";
      this.sink.onProtocolError(new CodexRuntimeError("frame_too_large", "stdout frame exceeded 8 MB"));
      return;
    }
    let newline = this.buffer.indexOf("\n");
    while (newline >= 0) {
      const line = this.buffer.slice(0, newline).replace(/\r$/, "");
      this.buffer = this.buffer.slice(newline + 1);
      if (line.trim()) this.dispatch(line);
      newline = this.buffer.indexOf("\n");
    }
  }

  private dispatch(line: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      this.sink.onProtocolError(new CodexRuntimeError("bad_frame", "stdout line is not JSON"));
      return;
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      this.sink.onProtocolError(new CodexRuntimeError("bad_frame", "stdout JSON is not an object"));
      return;
    }
    const message = parsed as Record<string, unknown>;
    if (isRpcId(message.id) && typeof message.method === "string") {
      this.sink.onRequest({
        jsonrpc: "2.0",
        id: message.id,
        method: message.method,
        ...(message.params !== undefined ? { params: message.params } : {}),
      });
      return;
    }
    if (isRpcId(message.id) && (Object.prototype.hasOwnProperty.call(message, "result") || message.error !== undefined)) {
      const pending = this.pending.get(String(message.id));
      if (!pending) return;
      this.pending.delete(String(message.id));
      clearTimeout(pending.timer);
      if (message.error !== undefined) {
        const errorRecord = asRecord(message.error);
        const text = typeof errorRecord?.message === "string" ? errorRecord.message : "json-rpc error";
        pending.reject(new CodexRuntimeError("rpc_error", text));
        return;
      }
      pending.resolve(message.result);
      return;
    }
    if (typeof message.method === "string") {
      this.sink.onNotification({
        jsonrpc: "2.0",
        method: message.method,
        ...(message.params !== undefined ? { params: message.params } : {}),
      });
    }
  }
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

export function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isRpcId(value: unknown): value is JsonRpcId {
  return typeof value === "number" || typeof value === "string";
}
