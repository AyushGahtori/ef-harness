import { EventEmitter } from "node:events";
import fs from "node:fs";
import net from "node:net";
import {
  BINARY_CHUNK_BYTES,
  BINARY_STREAM_CHANNEL,
  CURRENT_PROTOCOL,
  DEFAULT_HANDSHAKE_TIMEOUT_MS,
  DEFAULT_MAX_OUTBOUND_BYTES,
  JSON_IPC_MAX_BYTES,
  JSON_RPC_CHANNEL,
  RPC_AUTH_FAILED,
  RPC_INTERNAL_ERROR,
  RPC_INVALID_REQUEST,
  RPC_METHOD_NOT_FOUND,
  RPC_PARSE_ERROR,
  RPC_PROTOCOL_MISMATCH,
  SUPPORTED_PROTOCOLS,
  type ProtocolVersion,
} from "./constants.js";
import { ConnectionClosedError, PipeInUseError } from "./errors.js";
import { FrameCodec } from "./frame-codec.js";
import {
  encodeJsonRpc,
  inspectSessionHello,
  isRecord,
  isSessionHello,
  jsonRpcId,
  readRequest,
  type JsonRpcErrorBody,
  type JsonRpcRequest,
  type SessionHelloResult,
} from "./json-rpc.js";
import { assertNoNewNetworkListeners, listTcpUdpListeners } from "./network.js";
import { pipeLeafFromPath } from "./paths.js";
import type { StructuredLogger } from "./redaction.js";
import { SessionTokenStore } from "./session-token-store.js";
import { asWritable, SocketWriter } from "./socket-writer.js";
import { restrictNamedPipeToCurrentUser, tightenNamedPipe } from "./windows-security.js";

export interface PipeSession {
  readonly id: number;
  readonly authenticated: boolean;
  sendResult(id: string | number | null, result: unknown): Promise<void>;
  sendError(id: string | number | null, error: JsonRpcErrorBody): Promise<void>;
  sendBinary(streamId: number, payload: Uint8Array): Promise<void>;
  close(): void;
}

export type RequestHandler = (request: JsonRpcRequest, session: PipeSession) => Promise<unknown> | unknown;

export interface NamedPipeServerOptions {
  readonly pipePath: string;
  readonly tokenStore: SessionTokenStore;
  readonly logger?: StructuredLogger;
  readonly daemonVersion?: string;
  readonly handshakeTimeoutMs?: number;
  readonly maxOutboundBytes?: number;
  readonly onRequest?: RequestHandler;
}

function isDelegatedRpcError(value: unknown): value is { readonly error: JsonRpcErrorBody } {
  if (!isRecord(value) || !isRecord(value.error)) return false;
  const keys = Object.keys(value);
  if (keys.length !== 1 || keys[0] !== "error") return false;
  return typeof value.error.code === "number" && typeof value.error.message === "string";
}

function authError(id: string | number | null): unknown {
  return {
    jsonrpc: "2.0",
    id,
    error: { code: RPC_AUTH_FAILED, message: "session authentication failed" },
  };
}

function versionError(id: string | number | null, protocol: string): unknown {
  return {
    jsonrpc: "2.0",
    id,
    error: {
      code: RPC_PROTOCOL_MISMATCH,
      message: "protocol version mismatch",
      data: {
        name: "ProtocolVersionMismatchError",
        protocol,
        supported: SUPPORTED_PROTOCOLS,
      },
    },
  };
}

class ServerSession implements PipeSession {
  readonly id: number;
  authenticated = false;
  private readonly codec = new FrameCodec();
  private readonly writer: SocketWriter;
  private readonly timer: NodeJS.Timeout;
  private inbound: Promise<void> = Promise.resolve();
  private closed = false;

  constructor(
    private readonly server: NamedPipeServer,
    private readonly socket: net.Socket,
    private readonly handshakeTimeoutMs: number,
    maxOutboundBytes: number,
    private readonly logger: StructuredLogger,
    private readonly daemonVersion: string,
  ) {
    this.id = server.takeSessionId();
    this.writer = new SocketWriter(asWritable(socket), maxOutboundBytes);
    this.timer = setTimeout(() => {
      if (!this.authenticated) {
        this.logger.warn("handshake timeout", { sessionId: this.id });
        this.destroy();
      }
    }, handshakeTimeoutMs);
    this.socket.pause();
    this.socket.on("data", (chunk: Buffer) => this.onData(chunk));
    this.socket.on("error", () => this.destroy());
    this.socket.on("close", () => this.destroy());
  }

  async secureAndResume(leaf: string | undefined): Promise<void> {
    if (leaf) await tightenNamedPipe(leaf);
    if (!this.socket.destroyed) this.socket.resume();
  }

  sendResult(id: string | number | null, result: unknown): Promise<void> {
    return this.writer.write(encodeJsonRpc({ jsonrpc: "2.0", id, result }));
  }

  sendError(id: string | number | null, error: JsonRpcErrorBody): Promise<void> {
    return this.writer.write(encodeJsonRpc({ jsonrpc: "2.0", id, error }));
  }

  sendBinary(streamId: number, payload: Uint8Array): Promise<void> {
    if (!this.authenticated) return Promise.reject(new ConnectionClosedError("not authenticated"));
    return this.writer.write(FrameCodec.encode({ channel: BINARY_STREAM_CHANNEL, streamId, payload }));
  }

  close(): void {
    this.destroy();
  }

  destroy(): void {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.timer);
    this.writer.close();
    this.server.dropSession(this.id);
    if (!this.socket.destroyed) this.socket.destroy();
  }

  private onData(chunk: Buffer): void {
    this.inbound = this.inbound.then(() => this.consume(chunk)).catch((error: unknown) => {
      this.logger.warn("frame rejected", {
        sessionId: this.id,
        name: error instanceof Error ? error.name : "Error",
      });
      this.server.emit("frame-error", error, this);
      this.destroy();
    });
  }

  private async consume(chunk: Buffer): Promise<void> {
    if (this.closed) return;
    const frames = this.codec.push(chunk);
    for (const frame of frames) {
      if (this.closed) return;
      if (frame.channel === BINARY_STREAM_CHANNEL) {
        if (!this.authenticated || frame.streamId === null) {
          await this.deny(null, authError(null));
          return;
        }
        this.server.emit("binary", { streamId: frame.streamId, payload: frame.payload }, this);
        continue;
      }
      if (frame.channel !== JSON_RPC_CHANNEL) continue;
      await this.handleJson(frame.payload);
    }
  }

  private async handleJson(payload: Uint8Array): Promise<void> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(Buffer.from(payload).toString("utf8")) as unknown;
    } catch {
      await this.deny(null, {
        jsonrpc: "2.0",
        id: null,
        error: { code: this.authenticated ? RPC_PARSE_ERROR : RPC_AUTH_FAILED, message: "invalid JSON" },
      });
      return;
    }
    if (!this.authenticated) {
      const hello = inspectSessionHello(parsed, (token) => this.server.tokenStore.verify(token));
      if (!isSessionHello(hello)) {
        if (hello.kind === "version") await this.deny(hello.id, versionError(hello.id, hello.error?.protocol ?? ""));
        else await this.deny(hello.id, authError(hello.id));
        return;
      }
      this.authenticated = true;
      clearTimeout(this.timer);
      await this.sendResult(hello.id, helloResult(hello.protocol, this.daemonVersion));
      this.logger.info("client authenticated", { sessionId: this.id, protocol: hello.protocol });
      return;
    }
    const request = readRequest(parsed);
    if (!request) {
      const id = isRecord(parsed) ? jsonRpcId(parsed.id) : null;
      await this.sendError(id, { code: RPC_INVALID_REQUEST, message: "invalid request" });
      return;
    }
    if (request.method === "session.ping") {
      this.server.emit("ping", this);
      await this.sendResult(request.id, { ok: true });
      return;
    }
    if (request.method === "session.hello") {
      await this.sendError(request.id, { code: RPC_INVALID_REQUEST, message: "session already established" });
      return;
    }
    this.server.emit("request", request, this);
    const handler = this.server.currentRequestHandler();
    if (!handler) {
      await this.sendError(request.id, { code: RPC_METHOD_NOT_FOUND, message: "method not found" });
      return;
    }
    try {
      const result = await handler(request, this);
      if (isDelegatedRpcError(result)) {
        await this.sendError(request.id, result.error);
        return;
      }
      await this.sendResult(request.id, result === undefined ? {} : result);
    } catch {
      await this.sendError(request.id, { code: RPC_INTERNAL_ERROR, message: "internal error" });
    }
  }

  private async deny(id: string | number | null, message: unknown): Promise<void> {
    try {
      await this.writer.write(encodeJsonRpc(message));
    } finally {
      this.destroy();
    }
  }
}

function helloResult(protocol: ProtocolVersion, daemonVersion: string): SessionHelloResult {
  return {
    protocol,
    daemonVersion,
    capabilities: {
      jsonRpc: true,
      binaryStreams: true,
      maxJsonBytes: JSON_IPC_MAX_BYTES,
      maxBinaryChunkBytes: BINARY_CHUNK_BYTES,
      protocolVersions: SUPPORTED_PROTOCOLS,
      currentProtocol: CURRENT_PROTOCOL,
    },
  };
}

async function probeLive(pipePath: string): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect(pipePath);
    const timer = setTimeout(() => {
      socket.destroy();
      resolve(false);
    }, 200);
    socket.once("connect", () => {
      clearTimeout(timer);
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
}

export class NamedPipeServer extends EventEmitter {
  readonly pipePath: string;
  readonly tokenStore: SessionTokenStore;
  private readonly server = net.createServer((socket) => {
    void this.accept(socket);
  });
  private readonly sessions = new Map<number, ServerSession>();
  private readonly logger: StructuredLogger;
  private readonly daemonVersion: string;
  private readonly handshakeTimeoutMs: number;
  private readonly maxOutboundBytes: number;
  private onRequest: RequestHandler | undefined;
  private nextId = 1;
  private opened = false;
  private shutdown: Promise<void> | undefined;

  constructor(options: NamedPipeServerOptions) {
    super();
    this.pipePath = options.pipePath;
    this.tokenStore = options.tokenStore;
    this.logger = options.logger ?? fallbackLogger();
    this.daemonVersion = options.daemonVersion ?? "0.0.0";
    this.handshakeTimeoutMs = options.handshakeTimeoutMs ?? DEFAULT_HANDSHAKE_TIMEOUT_MS;
    this.maxOutboundBytes = options.maxOutboundBytes ?? DEFAULT_MAX_OUTBOUND_BYTES;
    this.onRequest = options.onRequest;
  }

  currentRequestHandler(): RequestHandler | undefined {
    return this.onRequest;
  }

  get clientCount(): number {
    return this.sessions.size;
  }

  setRequestHandler(handler: RequestHandler): void {
    this.onRequest = handler;
  }

  takeSessionId(): number {
    const id = this.nextId;
    this.nextId += 1;
    return id;
  }

  dropSession(id: number): void {
    this.sessions.delete(id);
  }

  async listen(): Promise<void> {
    if (this.opened) throw new Error("named pipe server is already listening");
    const before = listTcpUdpListeners();
    await this.tokenStore.start();
    try {
      if (process.platform !== "win32") await clearStaleSocket(this.pipePath);
      await listenOnPipe(this.server, this.pipePath);
      this.opened = true;
      if (process.platform !== "win32") await fs.promises.chmod(this.pipePath, 0o600);
      if (process.platform === "win32") {
        await restrictNamedPipeToCurrentUser(pipeLeafFromPath(this.pipePath));
      }
      assertNoNewNetworkListeners(before);
    } catch (error) {
      await this.close().catch(() => undefined);
      throw error;
    }
    this.logger.info("named pipe listening", { pipePath: this.pipePath });
  }

  async close(): Promise<void> {
    if (this.shutdown) return this.shutdown;
    this.shutdown = this.shutdownNow();
    return this.shutdown;
  }

  private async shutdownNow(): Promise<void> {
    for (const session of [...this.sessions.values()]) session.destroy();
    if (this.server.listening) {
      await new Promise<void>((resolve) => {
        this.server.close(() => resolve());
      });
    }
    if (process.platform !== "win32") await fs.promises.rm(this.pipePath, { force: true });
    this.opened = false;
  }

  private async accept(socket: net.Socket): Promise<void> {
    const session = new ServerSession(
      this,
      socket,
      this.handshakeTimeoutMs,
      this.maxOutboundBytes,
      this.logger,
      this.daemonVersion,
    );
    this.sessions.set(session.id, session);
    try {
      const leaf = process.platform === "win32" ? pipeLeafFromPath(this.pipePath) : undefined;
      await session.secureAndResume(leaf);
      this.emit("session", session);
    } catch (error) {
      this.logger.warn("client rejected during accept", {
        sessionId: session.id,
        name: error instanceof Error ? error.name : "Error",
      });
      session.destroy();
    }
  }
}

function fallbackLogger(): StructuredLogger {
  return {
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  };
}

async function clearStaleSocket(pipePath: string): Promise<void> {
  try {
    await fs.promises.stat(pipePath);
  } catch {
    return;
  }
  if (await probeLive(pipePath)) throw new PipeInUseError(pipePath);
  await fs.promises.unlink(pipePath);
}

function listenOnPipe(server: net.Server, pipePath: string): Promise<void> {
  if (/^\d+$/.test(pipePath)) throw new Error("refusing to listen on a TCP port");
  return new Promise((resolve, reject) => {
    const onError = (error: NodeJS.ErrnoException): void => {
      server.off("listening", onListening);
      if (error.code === "EADDRINUSE") reject(new PipeInUseError(pipePath));
      else reject(error);
    };
    const onListening = (): void => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(pipePath);
  });
}
