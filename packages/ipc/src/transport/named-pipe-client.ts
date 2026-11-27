import { EventEmitter } from "node:events";
import fs from "node:fs";
import net from "node:net";
import {
  BINARY_STREAM_CHANNEL,
  CURRENT_PROTOCOL,
  DEFAULT_BACKOFF_BASE_MS,
  DEFAULT_BACKOFF_MAX_MS,
  DEFAULT_HEARTBEAT_MS,
  DEFAULT_MAX_OUTBOUND_BYTES,
  RPC_PROTOCOL_MISMATCH,
  type ProtocolVersion,
} from "./constants.js";
import { ConnectionClosedError, ProtocolVersionMismatchError } from "./errors.js";
import { FrameCodec } from "./frame-codec.js";
import {
  decodeJsonPayload,
  encodeJsonRpc,
  isFailure,
  readHelloResult,
  readResponse,
  type SessionHelloResult,
} from "./json-rpc.js";
import type { MessagePortBridge } from "./message-port-bridge.js";
import type { StructuredLogger } from "./redaction.js";
import { asWritable, SocketWriter } from "./socket-writer.js";

export interface NamedPipeClientOptions {
  readonly pipePath: string;
  readonly tokenPath?: string;
  readonly token?: string;
  readonly logger?: StructuredLogger;
  readonly clientName?: string;
  readonly clientVersion?: string;
  readonly protocol?: ProtocolVersion;
  readonly heartbeatMs?: number;
  readonly requestTimeoutMs?: number;
  readonly backoffBaseMs?: number;
  readonly backoffMaxMs?: number;
  readonly maxRetries?: number;
  readonly bridge?: MessagePortBridge;
  readonly maxOutboundBytes?: number;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

function delayFor(attempt: number, baseMs: number, maxMs: number): number {
  const exponential = Math.min(maxMs, baseMs * 2 ** attempt);
  return exponential + Math.floor(Math.random() * Math.min(25, exponential));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const silentLogger: StructuredLogger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

export class NamedPipeClient extends EventEmitter {
  private readonly pipePath: string;
  private readonly tokenPath: string | undefined;
  private readonly staticToken: string | undefined;
  private readonly logger: StructuredLogger;
  private readonly clientName: string;
  private readonly clientVersion: string;
  private readonly protocol: ProtocolVersion;
  private readonly heartbeatMs: number;
  private readonly requestTimeoutMs: number;
  private readonly backoffBaseMs: number;
  private readonly backoffMaxMs: number;
  private readonly maxRetries: number;
  private readonly bridge: MessagePortBridge | undefined;
  private readonly maxOutboundBytes: number;
  private socket: net.Socket | undefined;
  private writer: SocketWriter | undefined;
  private codec = new FrameCodec();
  private readonly pending = new Map<number, PendingRequest>();
  private nextId = 1;
  private authed = false;
  private stopped = false;
  private heartbeat: NodeJS.Timeout | undefined;
  private loop: Promise<void> | undefined;
  private firstResolve: (() => void) | undefined;
  private firstReject: ((error: Error) => void) | undefined;
  private readonly firstConnected: Promise<void>;
  private closedNotice: (() => void) | undefined;
  hello: SessionHelloResult | undefined;

  constructor(options: NamedPipeClientOptions) {
    super();
    if (options.token === undefined && options.tokenPath === undefined) {
      throw new Error("named pipe client requires a session token or tokenPath");
    }
    this.pipePath = options.pipePath;
    this.tokenPath = options.tokenPath;
    this.staticToken = options.token;
    this.logger = options.logger ?? silentLogger;
    this.clientName = options.clientName ?? "ef-harness";
    this.clientVersion = options.clientVersion ?? "0.0.0";
    this.protocol = options.protocol ?? CURRENT_PROTOCOL;
    this.heartbeatMs = options.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 10_000;
    this.backoffBaseMs = options.backoffBaseMs ?? DEFAULT_BACKOFF_BASE_MS;
    this.backoffMaxMs = options.backoffMaxMs ?? DEFAULT_BACKOFF_MAX_MS;
    this.maxRetries = options.maxRetries ?? Number.POSITIVE_INFINITY;
    this.bridge = options.bridge;
    this.maxOutboundBytes = options.maxOutboundBytes ?? DEFAULT_MAX_OUTBOUND_BYTES;
    this.firstConnected = new Promise((resolve, reject) => {
      this.firstResolve = resolve;
      this.firstReject = reject;
    });
  }

  get connected(): boolean {
    return this.authed;
  }

  start(): Promise<void> {
    if (!this.loop) this.loop = this.run();
    return this.firstConnected;
  }

  async request(method: string, params: unknown = {}, opId?: string): Promise<unknown> {
    const writer = this.writer;
    if (!this.authed || !writer) throw new ConnectionClosedError("not connected");
    const id = this.nextId;
    this.nextId += 1;
    const message: {
      jsonrpc: "2.0";
      id: number;
      method: string;
      params: unknown;
      op_id?: string;
    } = { jsonrpc: "2.0", id, method, params };
    if (opId !== undefined) message.op_id = opId;
    const frame = encodeJsonRpc(message);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`request ${method} timed out`));
      }, this.requestTimeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      writer.write(frame).catch((error: unknown) => {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error instanceof Error ? error : new ConnectionClosedError());
      });
    });
  }

  sendBinary(streamId: number, payload: Uint8Array): Promise<void> {
    if (!this.authed || !this.writer) return Promise.reject(new ConnectionClosedError("not connected"));
    return this.writer.write(FrameCodec.encode({ channel: BINARY_STREAM_CHANNEL, streamId, payload }));
  }

  async close(): Promise<void> {
    this.stopped = true;
    this.stopHeartbeat();
    this.failPending(new ConnectionClosedError("client closed"));
    this.failFirst(new ConnectionClosedError("client closed"));
    this.socket?.destroy();
    this.closedNotice?.();
    await this.loop;
  }

  private async run(): Promise<void> {
    let attempt = 0;
    while (!this.stopped) {
      let settled = false;
      const disconnected = new Promise<void>((resolve) => {
        this.closedNotice = () => {
          if (settled) return;
          settled = true;
          resolve();
        };
      });
      try {
        await this.connectOnce();
        attempt = 0;
        await disconnected;
        if (this.stopped) break;
        this.emit("disconnected");
      } catch (error) {
        this.detachSocket();
        if (this.stopped) break;
        if (error instanceof ProtocolVersionMismatchError) {
          this.failFirst(error);
          this.emit("disconnected", error);
          break;
        }
        this.emit("disconnected", error);
      }
      if (this.stopped) break;
      if (attempt >= this.maxRetries) {
        this.failFirst(new ConnectionClosedError("reconnect attempts exhausted"));
        break;
      }
      const delayMs = delayFor(attempt, this.backoffBaseMs, this.backoffMaxMs);
      attempt += 1;
      this.emit("reconnecting", { attempt, delayMs });
      await sleep(delayMs);
    }
  }

  private async connectOnce(): Promise<void> {
    const token = (await this.loadToken()).trim().toLowerCase();
    const socket = await openSocket(this.pipePath);
    this.socket = socket;
    this.writer = new SocketWriter(asWritable(socket), this.maxOutboundBytes);
    this.codec = new FrameCodec();
    this.authed = false;
    socket.on("data", (chunk: Buffer) => this.onData(chunk));
    socket.on("error", () => this.detachSocket());
    socket.on("close", () => this.detachSocket());
    const id = this.nextId;
    this.nextId += 1;
    const hello = new Promise<SessionHelloResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("session.hello timed out"));
      }, this.requestTimeoutMs);
      this.pending.set(id, {
        resolve: (value) => {
          const result = readHelloResult(value);
          if (!result) {
            reject(new Error("session.hello result is invalid"));
            return;
          }
          resolve(result);
        },
        reject,
        timer,
      });
    });
    const writer = this.writer;
    if (!writer) throw new ConnectionClosedError("not connected");
    await writer.write(
      encodeJsonRpc({
        jsonrpc: "2.0",
        id,
        method: "session.hello",
        params: {
          token,
          protocol: this.protocol,
          client: { name: this.clientName, version: this.clientVersion },
        },
      }),
    );
    this.hello = await hello;
    this.authed = true;
    this.startHeartbeat();
    this.firstResolve?.();
    this.firstResolve = undefined;
    this.firstReject = undefined;
    this.emit("connected", this.hello);
    this.logger.info("named pipe client connected", { protocol: this.hello.protocol });
  }

  private onData(chunk: Buffer): void {
    let frames;
    try {
      frames = this.codec.push(chunk);
    } catch (error) {
      this.logger.warn("client frame rejected", { name: error instanceof Error ? error.name : "Error" });
      this.socket?.destroy();
      return;
    }
    for (const frame of frames) {
      if (frame.channel === BINARY_STREAM_CHANNEL) {
        this.bridge?.forwardFrame(frame);
        this.emit("binary", { streamId: frame.streamId, payload: frame.payload });
        continue;
      }
      let parsed: unknown;
      try {
        parsed = decodeJsonPayload(frame);
      } catch {
        continue;
      }
      const response = readResponse(parsed);
      if (!response || response.id === null || typeof response.id !== "number") continue;
      const waiter = this.pending.get(response.id);
      if (!waiter) continue;
      clearTimeout(waiter.timer);
      this.pending.delete(response.id);
      if (isFailure(response)) {
        if (response.error.code === RPC_PROTOCOL_MISMATCH) {
          const protocol = protocolFrom(response.error.data);
          waiter.reject(new ProtocolVersionMismatchError(protocol, ["1.0", "1.1"]));
        } else {
          waiter.reject(new Error(response.error.message));
        }
      } else {
        waiter.resolve(response.result);
      }
    }
  }

  private async loadToken(): Promise<string> {
    if (this.tokenPath) {
      try {
        const text = await fs.promises.readFile(this.tokenPath, "utf8");
        const token = text.trim();
        if (token.length === 0) throw new Error("unable to read session token");
        return token;
      } catch (error) {
        if (error instanceof Error && error.message === "unable to read session token") throw error;
        throw new Error("unable to read session token");
      }
    }
    if (this.staticToken !== undefined) return this.staticToken;
    throw new Error("unable to read session token");
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    if (this.heartbeatMs <= 0) return;
    this.heartbeat = setInterval(() => {
      this.request("session.ping", {})
        .then(() => undefined)
        .catch(() => {
          this.socket?.destroy();
        });
    }, this.heartbeatMs);
  }

  private stopHeartbeat(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = undefined;
  }

  private detachSocket(): void {
    if (!this.socket && !this.authed) return;
    this.authed = false;
    this.stopHeartbeat();
    this.writer?.close();
    this.writer = undefined;
    const socket = this.socket;
    this.socket = undefined;
    if (socket && !socket.destroyed) socket.destroy();
    this.failPending(new ConnectionClosedError());
    this.closedNotice?.();
    this.closedNotice = undefined;
  }

  private failPending(error: Error): void {
    for (const waiter of this.pending.values()) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
    this.pending.clear();
  }

  private failFirst(error: Error): void {
    this.firstReject?.(error);
    this.firstResolve = undefined;
    this.firstReject = undefined;
  }
}

function protocolFrom(data: unknown): string {
  if (data && typeof data === "object" && "protocol" in data && typeof data.protocol === "string") {
    return data.protocol;
  }
  return "unknown";
}

function openSocket(pipePath: string): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(pipePath);
    const onError = (error: Error): void => {
      socket.off("connect", onConnect);
      reject(error);
    };
    const onConnect = (): void => {
      socket.off("error", onError);
      resolve(socket);
    };
    socket.once("error", onError);
    socket.once("connect", onConnect);
  });
}
