import type { Readable, Writable } from "node:stream";
import {
  AcpProtocolError,
  AcpRpcError,
  DEFAULT_MAX_FRAME_BYTES,
  DEFAULT_UNKNOWN_METHOD_FLOOD,
  JSON_RPC_INTERNAL_ERROR,
  JSON_RPC_INVALID_REQUEST,
  JSON_RPC_METHOD_NOT_FOUND,
} from "./errors.js";
import { AcpFrameParser } from "./framing.js";
import { ByteBoundedRing, type PacketSecurityRedactorPort } from "./redaction.js";
import type { JsonRpcFailure, JsonRpcRequest, JsonRpcSuccess } from "./types.js";
import { isRecord } from "./types.js";

export interface AcpTransportStreams {
  readonly stdin: Writable;
  readonly stdout: Readable;
  readonly stderr: Readable;
}

export interface AcpTransportOptions {
  readonly maxFrameBytes?: number;
  readonly unknownMethodFlood?: number;
  readonly redactor: PacketSecurityRedactorPort;
  readonly onWire?: (summary: string) => void;
  readonly onFatal?: (error: Error) => void;
}

type Pending = {
  readonly method: string;
  readonly reject: (error: Error) => void;
  readonly resolve: (value: unknown) => void;
  readonly timer: NodeJS.Timeout;
};

export type InboundHandler = (request: JsonRpcRequest) => Promise<unknown> | unknown;

/**
 * Newline-delimited JSON-RPC 2.0 over stdio.
 * stderr is diagnostic-only and never enters the frame parser.
 */
export class AcpJsonRpcTransport {
  private readonly parser: AcpFrameParser;
  private readonly pending = new Map<number, Pending>();
  private readonly redactor: PacketSecurityRedactorPort;
  private nextId = 0;
  private unknownMethods = 0;
  private fatal: Error | null = null;
  private started = false;
  readonly ring: ByteBoundedRing;
  readonly stderrLines: string[] = [];
  readonly startupBanners: readonly string[];

  constructor(
    private readonly streams: AcpTransportStreams,
    private readonly options: AcpTransportOptions,
  ) {
    this.parser = new AcpFrameParser(options.maxFrameBytes ?? DEFAULT_MAX_FRAME_BYTES);
    this.startupBanners = this.parser.startupBanners;
    this.redactor = options.redactor;
    this.ring = new ByteBoundedRing(64 * 1024);
    this.inbound = async () => {
      throw new AcpRpcError(JSON_RPC_METHOD_NOT_FOUND, "no inbound handler");
    };
  }

  inbound: InboundHandler;

  start(): void {
    if (this.started) return;
    this.started = true;
    this.streams.stdout.on("data", (chunk: Buffer) => this.onStdout(chunk));
    this.streams.stderr.on("data", (chunk: Buffer) => this.onStderr(chunk));
    this.streams.stdout.on("end", () => this.fail(new AcpProtocolError("transport_closed", "stdout closed")));
    this.streams.stdout.on("error", (error) => this.fail(error));
    this.streams.stdin.on("error", (error) => this.fail(error));
  }

  request(method: string, params: unknown, timeoutMs: number): Promise<unknown> {
    if (this.fatal) return Promise.reject(this.fatal);
    const id = this.nextId + 1;
    this.nextId = id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        const code = method === "initialize" ? "initialize_timeout" : "request_timeout";
        reject(new AcpProtocolError(code, `${method} exceeded ${timeoutMs} ms`));
      }, timeoutMs);
      this.pending.set(id, { method, resolve, reject, timer });
      try {
        this.write(params === undefined ? { jsonrpc: "2.0", id, method } : { jsonrpc: "2.0", id, method, params });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error instanceof Error ? error : new AcpProtocolError("transport_closed", "write failed"));
      }
    });
  }

  notify(method: string, params: unknown): void {
    if (this.fatal) throw this.fatal;
    this.write(params === undefined ? { jsonrpc: "2.0", method } : { jsonrpc: "2.0", method, params });
  }

  close(): void {
    this.fail(new AcpProtocolError("transport_closed", "transport closed"));
    if (!this.streams.stdin.destroyed) this.streams.stdin.end();
  }

  noteUnknownMethod(method: string): void {
    this.countUnknown(method);
  }

  private onStdout(chunk: Buffer): void {
    const parsed = this.parser.push(chunk);
    for (const message of parsed.messages) this.dispatch(message);
    if (parsed.error) this.fail(parsed.error);
  }

  private onStderr(chunk: Buffer): void {
    const text = this.redactor.redact(chunk.toString("utf8"));
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue;
      this.stderrLines.push(line);
      this.note("err", line);
    }
  }

  private dispatch(message: JsonRpcMessageLike): void {
    this.note("in", this.redactor.redact(JSON.stringify(message)));
    if ("method" in message && typeof message.method === "string" && "id" in message) {
      void this.dispatchRequest(message as JsonRpcRequest);
      return;
    }
    if ("method" in message && typeof message.method === "string") {
      void this.dispatchRequest({ ...message, id: "" } as JsonRpcRequest, true);
      return;
    }
    if ("id" in message && (typeof message.id === "number" || typeof message.id === "string")) {
      this.dispatchResponse(message as JsonRpcSuccess | JsonRpcFailure);
    }
  }

  private async dispatchRequest(request: JsonRpcRequest, notification = false): Promise<void> {
    if (notification && request.method === "session/update") {
      try {
        await this.inbound(request);
      } catch (error) {
        this.fail(error instanceof Error ? error : new AcpProtocolError("malformed_frame", "update failed"));
      }
      return;
    }
    if (notification) {
      try {
        this.countUnknown(request.method);
      } catch (error) {
        this.fail(error instanceof Error ? error : new AcpProtocolError("unknown_method_flood", request.method));
      }
      return;
    }
    try {
      const result = await this.inbound(request);
      if (request.id !== "") this.respond(request.id, result);
    } catch (error) {
      if (error instanceof AcpProtocolError && error.code === "unknown_method_flood") {
        if (request.id !== "") this.respondError(request.id, JSON_RPC_METHOD_NOT_FOUND, error.message);
        this.fail(error);
        return;
      }
      if (error instanceof AcpRpcError) {
        if (request.id !== "") this.respondError(request.id, error.rpcCode, error.rpcMessage, error.data);
        return;
      }
      if (request.id !== "") {
        const message = error instanceof Error ? error.message : "internal error";
        this.respondError(request.id, JSON_RPC_INTERNAL_ERROR, message);
      }
    }
  }

  private dispatchResponse(message: JsonRpcSuccess | JsonRpcFailure): void {
    if (typeof message.id !== "number") return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(message.id);
    if ("error" in message) {
      pending.reject(new AcpRpcError(message.error.code, message.error.message, message.error.data));
      return;
    }
    pending.resolve(message.result);
  }

  private respond(id: number | string, result: unknown): void {
    this.write({ jsonrpc: "2.0", id, result: result === undefined ? null : result });
  }

  private respondError(id: number | string, code: number, message: string, data?: unknown): void {
    this.write({
      jsonrpc: "2.0",
      id,
      error: {
        code,
        message: this.redactor.redact(message),
        ...(data !== undefined ? { data: this.redactor.redactValue(data) } : {}),
      },
    });
  }

  private countUnknown(method: string): void {
    if (method === "session/update" || method === "session/cancel") return;
    this.unknownMethods += 1;
    const limit = this.options.unknownMethodFlood ?? DEFAULT_UNKNOWN_METHOD_FLOOD;
    if (this.unknownMethods >= limit) {
      throw new AcpProtocolError("unknown_method_flood", `${this.unknownMethods} unknown methods`);
    }
  }

  private write(message: unknown): void {
    const encoded = JSON.stringify(message);
    this.note("out", this.redactor.redact(encoded));
    this.streams.stdin.write(`${encoded}\n`);
  }

  private note(direction: string, text: string): void {
    const summary = `${direction} ${text}`;
    this.ring.push(summary);
    this.options.onWire?.(summary);
  }

  private fail(error: Error): void {
    if (this.fatal) return;
    if (error instanceof AcpProtocolError && error.code === "transport_closed" && this.pending.size === 0) {
      this.fatal = error;
      return;
    }
    this.fatal = error;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
    this.options.onFatal?.(error);
  }
}

type JsonRpcMessageLike = JsonRpcRequest | JsonRpcSuccess | JsonRpcFailure | { method: string; params?: unknown };

export function readParams(request: JsonRpcRequest): Record<string, unknown> {
  if (request.params === undefined) return {};
  if (!isRecord(request.params)) throw new AcpRpcError(JSON_RPC_INVALID_REQUEST, "params must be an object");
  return request.params;
}
