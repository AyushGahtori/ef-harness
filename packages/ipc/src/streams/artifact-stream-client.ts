import { createHash, type Hash } from "node:crypto";
import { once } from "node:events";
import net from "node:net";
import { performance } from "node:perf_hooks";
import { CHUNK_BYTES, MAX_CREDIT_GRANT } from "./constants.js";
import {
  ArtifactNotFoundError,
  CasBlobMissingError,
  CasIntegrityMismatchError,
  InvalidCreditError,
  PayloadExceedsJsonCapError,
  StreamRemoteError,
} from "./errors.js";
import { StreamFrameCodec, encodeJsonFrame } from "./frame.js";
import { encodeJsonPayload } from "./json-guard.js";
import type { ByteRange } from "./ports.js";

export interface ArtifactStreamClientOptions {
  readonly pipePath: string;
  /** Refill size. Defaults to the server's advertised `initialCredits`. */
  readonly creditWindow?: number;
  /** When false, the client never grants credits (idle-timeout tests). */
  readonly autoCredit?: boolean;
  /** Keep the artifact bytes. Large transfers should leave this false and use the hash. */
  readonly retainBytes?: boolean;
}

export interface OpenedArtifact {
  readonly streamId: number;
  readonly totalBytes: number;
  readonly mime: string;
  readonly chunkBytes: number;
  readonly initialCredits: number;
}

export interface StreamDownload {
  readonly byteLength: number;
  readonly sha256: string;
  readonly bytesSent: number;
  readonly complete: boolean;
  readonly maxChunk: number;
  readonly bytes: Uint8Array | null;
}

interface PendingRpc {
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: Error) => void;
}

interface Receiver {
  readonly id: number;
  readonly totalBytes: number;
  readonly hash: Hash;
  readonly parts: Buffer[];
  readonly retain: boolean;
  window: number;
  localBudget: number;
  received: number;
  maxChunk: number;
  ended: boolean;
  sentinel: boolean;
  settled: boolean;
  remoteSha: string | null;
  remoteBytes: number | null;
  localSha: string | null;
  error: Error | null;
  resolve: ((download: StreamDownload) => void) | null;
  reject: ((error: Error) => void) | null;
}

/**
 * Channel 1 reader. Grants chunk credits, ignores binary frames for streams it
 * already closed, and checks `stream.end` against the bytes it actually got.
 */
export class ArtifactStreamClient {
  private readonly pipePath: string;
  private readonly creditWindow: number | undefined;
  private readonly autoCredit: boolean;
  private readonly retainBytes: boolean;
  private readonly codec = new StreamFrameCodec();
  private readonly pending = new Map<number, PendingRpc>();
  private readonly receivers = new Map<number, Receiver>();
  private readonly ignored = new Set<number>();
  private socket: net.Socket | null = null;
  private nextId = 0;
  private closed = false;

  constructor(options: ArtifactStreamClientOptions) {
    this.pipePath = options.pipePath;
    this.creditWindow = options.creditWindow;
    this.autoCredit = options.autoCredit ?? true;
    this.retainBytes = options.retainBytes ?? false;
  }

  async connect(): Promise<void> {
    const socket = net.createConnection(this.pipePath);
    socket.setNoDelay(true);
    this.socket = socket;
    socket.on("data", (chunk: Buffer) => this.onData(chunk));
    socket.on("error", (error: Error) => this.fail(error));
    socket.on("close", () => this.fail(new Error("pipe closed")));
    await once(socket, "connect");
  }

  async openArtifact(id: string, range?: ByteRange): Promise<OpenedArtifact> {
    const params = range ? { id, range } : { id };
    const result = await this.rpc("artifact.open", params);
    if (!isOpened(result)) throw new Error("artifact.open returned an unexpected result");
    return result;
  }

  readStream(streamId: number): Promise<StreamDownload> {
    const receiver = this.receivers.get(streamId);
    if (!receiver) return Promise.reject(new Error(`unknown stream ${String(streamId)}`));
    if (receiver.settled) {
      if (receiver.error) return Promise.reject(receiver.error);
      if (receiver.localSha !== null) return Promise.resolve(this.toDownload(receiver, true));
    }
    return new Promise((resolve, reject) => {
      receiver.resolve = resolve;
      receiver.reject = reject;
    });
  }

  async closeStream(streamId: number): Promise<void> {
    this.ignored.add(streamId);
    const receiver = this.receivers.get(streamId);
    if (receiver && !receiver.settled) {
      receiver.settled = true;
      receiver.resolve?.(this.toDownload(receiver, false));
    }
    await this.rpc("stream.cancel", { stream_id: streamId });
  }

  async ping(): Promise<number> {
    const started = performance.now();
    await this.rpc("session.ping", {});
    return performance.now() - started;
  }

  async buildStop(params: unknown = {}): Promise<number> {
    const started = performance.now();
    await this.rpc("build.stop", params);
    return performance.now() - started;
  }

  async call(method: string, params: unknown): Promise<unknown> {
    return this.rpc(method, params);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.socket?.destroy();
    this.socket = null;
  }

  private rpc(method: string, params: unknown): Promise<unknown> {
    const socket = this.socket;
    if (!socket || this.closed) return Promise.reject(new Error("client is not connected"));
    const id = ++this.nextId;
    const payload = encodeJsonPayload({ jsonrpc: "2.0", id, method, params });
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      socket.write(encodeJsonFrame(payload), (error) => {
        if (error) {
          this.pending.delete(id);
          reject(error);
        }
      });
    });
  }

  private onData(chunk: Buffer): void {
    const events = this.codec.push(chunk);
    for (const event of events) {
      if (event.kind === "rejected") continue;
      if (event.channel === 0) this.onJson(event.payload);
      else if (event.streamId !== null) this.onBinary(event.streamId, event.payload);
    }
  }

  private onJson(payload: Uint8Array): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(Buffer.from(payload).toString("utf8")) as unknown;
    } catch {
      return;
    }
    if (!isRecord(parsed)) return;
    if (typeof parsed.method === "string") {
      this.onNotification(parsed.method, parsed.params);
      return;
    }
    if (typeof parsed.id !== "number") return;
    const waiter = this.pending.get(parsed.id);
    if (!waiter) return;
    this.pending.delete(parsed.id);
    if ("error" in parsed && parsed.error !== undefined) {
      waiter.reject(asRpcError(parsed.error));
      return;
    }
    if (isOpened(parsed.result)) this.attach(parsed.result);
    waiter.resolve(parsed.result);
  }

  private onNotification(method: string, params: unknown): void {
    if (!isRecord(params)) return;
    const streamId = streamIdOf(params);
    if (streamId === null) return;
    const receiver = this.receivers.get(streamId);
    if (!receiver || this.ignored.has(streamId)) return;
    if (method === "stream.end") {
      receiver.ended = true;
      receiver.remoteSha = typeof params.sha256 === "string" ? params.sha256 : null;
      receiver.remoteBytes = byteCountOf(params);
      this.maybeFinish(receiver);
      return;
    }
    if (method === "stream.error") {
      const code = typeof params.code === "string" ? params.code : "STREAM_FAILED";
      const message = typeof params.message === "string" ? params.message : "stream failed";
      this.settleError(receiver, new StreamRemoteError(streamId, code, message));
    }
  }

  private onBinary(streamId: number, payload: Uint8Array): void {
    if (this.ignored.has(streamId)) return;
    const receiver = this.receivers.get(streamId);
    if (!receiver || receiver.settled) return;
    if (payload.byteLength === 0) {
      receiver.sentinel = true;
      this.maybeFinish(receiver);
      return;
    }
    if (payload.byteLength > CHUNK_BYTES) {
      this.settleError(receiver, new Error(`channel 1 chunk is ${String(payload.byteLength)} bytes`));
      return;
    }
    receiver.maxChunk = Math.max(receiver.maxChunk, payload.byteLength);
    receiver.hash.update(payload);
    receiver.received += payload.byteLength;
    if (receiver.retain) receiver.parts.push(Buffer.from(payload));
    receiver.localBudget -= 1;
    if (this.autoCredit && receiver.localBudget <= 0 && !receiver.ended) {
      const grant = grantSize(receiver.window);
      receiver.localBudget += grant;
      void this.rpc("stream.credit", { stream_id: streamId, credits: grant }).catch((error: unknown) => {
        if (!receiver.settled) {
          this.settleError(receiver, error instanceof Error ? error : new Error("credit grant failed"));
        }
      });
    }
  }

  private attach(opened: OpenedArtifact): void {
    if (this.receivers.has(opened.streamId)) return;
    const window = this.creditWindow ?? opened.initialCredits;
    const receiver: Receiver = {
      id: opened.streamId,
      totalBytes: opened.totalBytes,
      hash: createHash("sha256"),
      parts: [],
      retain: this.retainBytes,
      window,
      localBudget: opened.initialCredits,
      received: 0,
      maxChunk: 0,
      ended: false,
      sentinel: false,
      settled: false,
      remoteSha: null,
      remoteBytes: null,
      localSha: null,
      error: null,
      resolve: null,
      reject: null,
    };
    this.receivers.set(opened.streamId, receiver);
    if (this.autoCredit && receiver.localBudget === 0 && receiver.totalBytes > 0) {
      const grant = grantSize(window);
      receiver.localBudget = grant;
      void this.rpc("stream.credit", { stream_id: opened.streamId, credits: grant }).catch((error: unknown) => {
        if (!receiver.settled) this.settleError(receiver, error instanceof Error ? error : new Error("credit grant failed"));
      });
    }
  }

  private maybeFinish(receiver: Receiver): void {
    if (receiver.settled || !receiver.ended) return;
    if (receiver.remoteBytes !== null && receiver.received !== receiver.remoteBytes) {
      this.settleError(
        receiver,
        new Error(`short read: got ${String(receiver.received)} of ${String(receiver.remoteBytes)} bytes`),
      );
      return;
    }
    const sha256 = this.finishHash(receiver);
    if (receiver.remoteSha !== null && sha256 !== receiver.remoteSha) {
      this.settleError(receiver, new Error("SHA-256 mismatch on artifact stream"));
      return;
    }
    receiver.settled = true;
    receiver.resolve?.(this.toDownload(receiver, true));
  }

  private finishHash(receiver: Receiver): string {
    if (receiver.localSha !== null) return receiver.localSha;
    const sha256 = receiver.hash.digest("hex");
    receiver.localSha = sha256;
    return sha256;
  }

  private toDownload(receiver: Receiver, complete: boolean): StreamDownload {
    return {
      byteLength: receiver.received,
      sha256: this.finishHash(receiver),
      bytesSent: receiver.remoteBytes ?? receiver.received,
      complete,
      maxChunk: receiver.maxChunk,
      bytes: receiver.retain ? Buffer.concat(receiver.parts) : null,
    };
  }

  private settleError(receiver: Receiver, error: Error): void {
    if (receiver.settled || this.ignored.has(receiver.id)) return;
    receiver.settled = true;
    receiver.error = error;
    receiver.reject?.(error);
  }

  private fail(error: Error): void {
    if (this.closed && error.message === "pipe closed") return;
    for (const waiter of this.pending.values()) waiter.reject(error);
    this.pending.clear();
    for (const receiver of this.receivers.values()) this.settleError(receiver, error);
  }
}

function grantSize(window: number): number {
  const size = window > 0 ? window : 1;
  return Math.min(MAX_CREDIT_GRANT, size);
}

function streamIdOf(params: unknown): number | null {
  if (!isRecord(params)) return null;
  if (typeof params.stream_id === "number") return params.stream_id;
  if (typeof params.streamId === "number") return params.streamId;
  return null;
}

function byteCountOf(params: Record<string, unknown>): number | null {
  if (typeof params.bytes_sent === "number") return params.bytes_sent;
  if (typeof params.bytesSent === "number") return params.bytesSent;
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOpened(value: unknown): value is OpenedArtifact {
  if (!isRecord(value)) return false;
  return (
    typeof value.streamId === "number" &&
    typeof value.totalBytes === "number" &&
    typeof value.mime === "string" &&
    typeof value.chunkBytes === "number" &&
    typeof value.initialCredits === "number"
  );
}

function asRpcError(value: unknown): Error {
  if (!isRecord(value)) return new Error("request failed");
  const data = isRecord(value.data) ? value.data : {};
  const name = typeof data.name === "string" ? data.name : "";
  const message = typeof value.message === "string" ? value.message : "request failed";
  const hash = typeof data.hash === "string" ? data.hash : "";
  if (name === "ArtifactNotFoundError") {
    const artifactId = typeof data.artifactId === "string" ? data.artifactId : message;
    return new ArtifactNotFoundError(artifactId);
  }
  if (name === "InvalidCreditError") {
    return new InvalidCreditError(data.chunks ?? 0, numberField(data.outstanding), message);
  }
  if (name === "PayloadExceedsJsonCapError") {
    return new PayloadExceedsJsonCapError(numberField(data.byteLength), numberField(data.capBytes) || 1_048_576);
  }
  if (name === "CasBlobMissingError") return new CasBlobMissingError(hash);
  if (name === "CasIntegrityMismatchError") return new CasIntegrityMismatchError(hash, message);
  const error = new Error(message);
  if (name) error.name = name;
  return error;
}

function numberField(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
