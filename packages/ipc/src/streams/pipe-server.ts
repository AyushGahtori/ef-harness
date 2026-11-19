import net from "node:net";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { CHUNK_BYTES, JSON_RPC_CHANNEL } from "./constants.js";
import {
  ArtifactNotFoundError,
  CasBlobMissingError,
  CasIntegrityMismatchError,
  InvalidCreditError,
  InvalidStreamRequestError,
  PayloadExceedsJsonCapError,
  isCasBlobMissingError,
  isCasIntegrityMismatchError,
  isPayloadExceedsJsonCapError,
} from "./errors.js";
import { StreamFrameCodec, encodeBinaryFrame, encodeJsonFrame, type StreamDecodeEvent } from "./frame.js";
import { encodeJsonPayload } from "./json-guard.js";
import { BinaryStreamManager, type ArtifactOpenResult } from "./binary-stream-manager.js";
import { PriorityWriter } from "./priority-writer.js";
import { RangeDiffHandler, type DiffGetParams } from "./range-diff-handler.js";
import { RangeLogHandler, type LogRangeParams, type LogSearchParams } from "./range-log-handler.js";
import type { ArtifactCatalog, ByteRange, CasIntegrityPort, DiffSource, ArtifactLogReader } from "./ports.js";

export interface ArtifactPipeServerOptions {
  readonly pipePath: string;
  readonly projectId: string;
  readonly catalog: ArtifactCatalog;
  readonly cas?: CasIntegrityPort;
  readonly logs?: {
    readonly reader: ArtifactLogReader;
    readonly belongsToProject: (artifactId: string) => boolean;
  };
  readonly diffs?: DiffSource;
  readonly initialCredits?: number;
  readonly idleTimeoutMs?: number;
  readonly onBuildStop?: (params: unknown) => void;
  readonly recordWrites?: boolean;
}

export interface WriteRecord {
  readonly lane: "control" | "binary";
  readonly channel: number;
}

interface RpcRequest {
  readonly id: string | number | null;
  readonly method: string;
  readonly params: unknown;
}

let pipeSequence = 0;

export function allocatePipePath(prefix = "efh-033"): string {
  pipeSequence += 1;
  const name = `${prefix}-${process.pid}-${pipeSequence}-${Math.random().toString(16).slice(2)}`;
  if (process.platform === "win32") return `\\\\.\\pipe\\${name}`;
  return path.join(os.tmpdir(), `${name}.sock`);
}

/**
 * Named-pipe endpoint for channel 0 JSON-RPC and channel 1 artifact bytes.
 * Task 031's `NamedPipeServer` can delegate `artifact.open` here once both land.
 */
export class ArtifactPipeServer {
  readonly pipePath: string;
  readonly projectId: string;
  readonly catalog: ArtifactCatalog;
  readonly writeLog: WriteRecord[] = [];
  private readonly options: ArtifactPipeServerOptions;
  private readonly sessions = new Set<PipeSession>();
  private readonly server: net.Server;
  private binaryPaused = false;
  private buildStops = 0;
  private controlLatencyMs = 0;
  private listening = false;

  constructor(options: ArtifactPipeServerOptions) {
    this.options = options;
    this.pipePath = options.pipePath;
    this.projectId = options.projectId;
    this.catalog = options.catalog;
    this.server = net.createServer((socket) => {
      const session = new PipeSession(socket, this);
      this.sessions.add(session);
      if (this.binaryPaused) session.pauseBinary();
      socket.on("close", () => {
        session.dispose();
        this.sessions.delete(session);
      });
    });
  }

  get openStreamCount(): number {
    let count = 0;
    for (const session of this.sessions) count += session.openStreamCount;
    return count;
  }

  get openHandleCount(): number {
    let count = 0;
    for (const session of this.sessions) count += session.openHandleCount;
    return count;
  }

  get maxBufferedPayloadBytes(): number {
    let max = 0;
    for (const session of this.sessions) max = Math.max(max, session.maxBufferedPayloadBytes);
    return max;
  }

  get maxStreamBufferedPayloadBytes(): number {
    let max = 0;
    for (const session of this.sessions) max = Math.max(max, session.maxStreamBufferedPayloadBytes);
    return max;
  }

  get buildStopCount(): number {
    return this.buildStops;
  }

  get maxControlLatencyMs(): number {
    return this.controlLatencyMs;
  }

  get config(): ArtifactPipeServerOptions {
    return this.options;
  }

  noteBuildStop(params: unknown): void {
    this.buildStops += 1;
    this.options.onBuildStop?.(params);
  }

  noteControlLatency(ms: number): void {
    if (ms > this.controlLatencyMs) this.controlLatencyMs = ms;
  }

  noteWrite(record: WriteRecord): void {
    if (this.options.recordWrites) this.writeLog.push(record);
  }

  pauseBinary(): void {
    this.binaryPaused = true;
    for (const session of this.sessions) session.pauseBinary();
  }

  resumeBinary(): void {
    this.binaryPaused = false;
    for (const session of this.sessions) session.resumeBinary();
  }

  queuedBinaryStreamIds(): number[] {
    const ids: number[] = [];
    for (const session of this.sessions) ids.push(...session.queuedBinaryStreamIds());
    return ids;
  }

  async whenIdle(): Promise<void> {
    for (const session of this.sessions) await session.whenIdle();
  }

  /** Simulate a channel 1 frame that is already on the wire after `stream.close`. */
  emitLateBinary(streamId: number, payload: Uint8Array): void {
    for (const session of this.sessions) session.emitLateBinary(streamId, payload);
  }

  async listen(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error): void => reject(error);
      this.server.once("error", onError);
      this.server.listen(this.pipePath, () => {
        this.server.off("error", onError);
        this.listening = true;
        resolve();
      });
    });
  }

  async close(): Promise<void> {
    for (const session of [...this.sessions]) session.dispose();
    this.sessions.clear();
    if (!this.listening) return;
    this.listening = false;
    await new Promise<void>((resolve) => {
      this.server.close(() => resolve());
    });
  }
}

class PipeSession {
  private readonly codec = new StreamFrameCodec();
  private readonly writer: PriorityWriter;
  private readonly manager: BinaryStreamManager;
  private readonly logs: RangeLogHandler | null;
  private readonly diffs: RangeDiffHandler | null;
  private readonly arrivedAt = new Map<string, number>();
  private readonly pendingStart: ArtifactOpenResult[] = [];
  private inbound: Promise<void> = Promise.resolve();
  private disposed = false;
  /** Bumped so a newer `artifact.open` cancels a kick that has not started. */
  private kickToken = 0;
  private kickWait: Promise<void> = Promise.resolve();

  constructor(
    private readonly socket: net.Socket,
    private readonly host: ArtifactPipeServer,
  ) {
    socket.setNoDelay(true);
    this.writer = new PriorityWriter((frame) => this.writeFrame(frame));
    const options = host.config;
    this.manager = new BinaryStreamManager({
      projectId: host.projectId,
      catalog: host.catalog,
      output: this.writer,
      ...(options.initialCredits !== undefined ? { initialCredits: options.initialCredits } : {}),
      ...(options.idleTimeoutMs !== undefined ? { idleTimeoutMs: options.idleTimeoutMs } : {}),
      ...(options.cas !== undefined ? { cas: options.cas } : {}),
    });
    this.writer.observer.onBinarySent = (frame) => {
      this.host.noteWrite({ lane: "binary", channel: frame[4] ?? 0 });
      this.manager.noteBinarySent(frame);
    };
    this.writer.observer.onControlSent = (frame) => {
      this.host.noteWrite({ lane: "control", channel: frame[4] ?? 0 });
      this.noteControl(frame);
    };
    const logs = options.logs;
    this.logs = logs ? new RangeLogHandler(logs.reader, logs.belongsToProject) : null;
    this.diffs = options.diffs ? new RangeDiffHandler(host.projectId, options.diffs) : null;
    socket.on("data", (chunk: Buffer) => {
      this.inbound = this.inbound.then(() => this.consume(chunk)).catch(() => this.dispose());
    });
    socket.on("error", () => this.dispose());
  }

  get openStreamCount(): number {
    return this.manager.openStreamCount;
  }

  get openHandleCount(): number {
    return this.manager.openHandleCount;
  }

  get maxBufferedPayloadBytes(): number {
    return this.manager.maxBufferedPayloadBytes;
  }

  get maxStreamBufferedPayloadBytes(): number {
    return this.manager.maxStreamBufferedPayloadBytes;
  }

  pauseBinary(): void {
    this.writer.pauseBinary();
  }

  resumeBinary(): void {
    this.writer.resumeBinary();
  }

  queuedBinaryStreamIds(): number[] {
    return this.writer.binaryStreamIds();
  }

  async whenIdle(): Promise<void> {
    await this.kickWait;
    await this.manager.whenIdle();
  }

  emitLateBinary(streamId: number, payload: Uint8Array): void {
    this.writer.enqueue(encodeBinaryFrame(streamId, payload), "binary");
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.kickToken += 1;
    this.manager.dispose();
    this.writer.close();
    if (!this.socket.destroyed) this.socket.destroy();
  }

  private async writeFrame(frame: Buffer): Promise<void> {
    if (this.disposed || this.socket.destroyed) {
      this.writer.close();
      return;
    }
    try {
      await new Promise<void>((resolve, reject) => {
        this.socket.write(frame, (error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    } catch (error) {
      const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
      if (
        this.disposed ||
        this.socket.destroyed ||
        code === "EPIPE" ||
        code === "ECONNRESET" ||
        code === "ERR_STREAM_DESTROYED"
      ) {
        this.writer.close();
        return;
      }
      throw error;
    }
  }

  private noteControl(frame: Buffer): void {
    if (frame[4] !== JSON_RPC_CHANNEL) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(frame.subarray(5).toString("utf8")) as unknown;
    } catch {
      return;
    }
    if (!isRecord(parsed) || (typeof parsed.id !== "string" && typeof parsed.id !== "number")) return;
    const key = String(parsed.id);
    const started = this.arrivedAt.get(key);
    if (started === undefined) return;
    this.arrivedAt.delete(key);
    this.host.noteControlLatency(performance.now() - started);
  }

  private async consume(chunk: Buffer): Promise<void> {
    if (this.disposed) return;
    const events = this.codec.push(chunk);
    for (const event of events) {
      if (this.disposed) return;
      await this.dispatch(event);
    }
  }

  private async dispatch(event: StreamDecodeEvent): Promise<void> {
    if (event.kind === "rejected") {
      const error = new PayloadExceedsJsonCapError(event.declared, event.channel === 0 ? 1_048_576 : CHUNK_BYTES);
      this.reply(null, undefined, error);
      return;
    }
    if (event.channel === 1) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(Buffer.from(event.payload).toString("utf8")) as unknown;
    } catch {
      this.reply(null, undefined, new InvalidStreamRequestError("invalid JSON"));
      return;
    }
    const request = readRequest(parsed);
    if (!request) {
      this.reply(null, undefined, new InvalidStreamRequestError("invalid JSON-RPC request"));
      return;
    }
    if (request.id !== null) this.arrivedAt.set(String(request.id), performance.now());
    try {
      const result = await this.handle(request);
      if (request.id !== null) this.reply(request.id, result, undefined);
      this.flushStarts();
    } catch (error) {
      this.pendingStart.length = 0;
      if (request.id !== null) this.reply(request.id, undefined, error);
    }
  }

  private async handle(request: RpcRequest): Promise<unknown> {
    switch (request.method) {
      case "session.hello":
        return { ok: true, protocol: "1.1" };
      case "session.ping":
        return { ok: true };
      case "build.stop":
        this.host.noteBuildStop(request.params ?? {});
        return { ok: true, stopped: true };
      case "chat.send":
        return { ok: true };
      case "artifact.open":
        return this.openArtifact(request.params);
      case "stream.credit":
        return this.credit(request.params);
      case "stream.close":
        return this.closeStream(request.params);
      case "log.range":
        if (!this.logs) throw new InvalidStreamRequestError("log handler is not configured");
        return this.logs.logRange(readLogRange(request.params));
      case "log.search":
        if (!this.logs) throw new InvalidStreamRequestError("log handler is not configured");
        return this.logs.logSearch(readLogSearch(request.params));
      case "diff.get":
        if (!this.diffs) throw new InvalidStreamRequestError("diff handler is not configured");
        return this.diffs.diffGet(readDiffGet(request.params));
      default:
        throw new InvalidStreamRequestError(`unknown method ${request.method}`);
    }
  }

  private async openArtifact(params: unknown): Promise<Omit<ArtifactOpenResult, "empty" | "sha256">> {
    const prepared = await this.manager.prepare(readOpen(params));
    this.pendingStart.push(prepared);
    return {
      streamId: prepared.streamId,
      totalBytes: prepared.totalBytes,
      mime: prepared.mime,
      chunkBytes: prepared.chunkBytes,
      initialCredits: prepared.initialCredits,
    };
  }

  /** Channel 0 open result is queued before the first channel 1 chunk or EOF. */
  private flushStarts(): void {
    const starts = this.pendingStart.splice(0);
    let needsKick = false;
    for (const prepared of starts) {
      if (prepared.empty) this.manager.completeEmpty(prepared.streamId);
      else needsKick = true;
    }
    if (needsKick) this.armCoalescedKick();
  }

  /**
   * Wait a few event-loop turns before the first prefetch.
   * Back-to-back `artifact.open` calls then share one round-robin pass
   * instead of the first stream draining its credit window alone.
   * Eight turns covers a same-process named-pipe round trip.
   */
  private armCoalescedKick(): void {
    const token = ++this.kickToken;
    this.kickWait = this.runCoalescedKick(token);
  }

  private async runCoalescedKick(token: number): Promise<void> {
    for (let turn = 0; turn < 8; turn += 1) {
      if (this.kickToken !== token || this.disposed) return;
      await new Promise<void>((resolve) => {
        setImmediate(resolve);
      });
    }
    if (this.kickToken !== token || this.disposed) return;
    this.manager.kick();
    await this.manager.whenIdle();
  }

  private credit(params: unknown): { applied: boolean; outstanding: number } {
    if (!isRecord(params) || typeof params.streamId !== "number") {
      throw new InvalidStreamRequestError("stream.credit requires streamId");
    }
    return this.manager.grantCredit(params.streamId, params.chunks);
  }

  private closeStream(params: unknown): { applied: boolean } {
    if (!isRecord(params) || typeof params.streamId !== "number") {
      throw new InvalidStreamRequestError("stream.close requires streamId");
    }
    return this.manager.closeStream(params.streamId);
  }

  private reply(id: string | number | null, result: unknown, error: unknown): void {
    const message =
      error === undefined
        ? { jsonrpc: "2.0", id, result }
        : { jsonrpc: "2.0", id, error: rpcError(error) };
    this.writer.enqueue(encodeJsonFrame(encodeJsonPayload(message)), "control");
  }
}

function rpcError(error: unknown): { code: number; message: string; data: Record<string, unknown> } {
  const name = error instanceof Error ? error.name : "Error";
  const message = error instanceof Error ? error.message : "request failed";
  let code = -32603;
  if (error instanceof ArtifactNotFoundError) code = -32004;
  else if (error instanceof InvalidCreditError || error instanceof InvalidStreamRequestError) code = -32602;
  else if (isPayloadExceedsJsonCapError(error)) code = -32010;
  else if (isCasBlobMissingError(error)) code = -32011;
  else if (isCasIntegrityMismatchError(error)) code = -32012;
  const data: Record<string, unknown> = { name };
  if (error instanceof ArtifactNotFoundError) data.artifactId = error.artifactId;
  if (error instanceof PayloadExceedsJsonCapError) {
    data.spill = error.spill;
    data.byteLength = error.byteLength;
    data.capBytes = error.capBytes;
  }
  if (error instanceof InvalidCreditError) {
    data.chunks = error.chunks;
    data.outstanding = error.outstanding;
  }
  if (error instanceof CasBlobMissingError || error instanceof CasIntegrityMismatchError) data.hash = error.hash;
  if (isCasBlobMissingError(error) && typeof error === "object" && error !== null && "hash" in error) {
    data.hash = (error as { hash: unknown }).hash;
  }
  return { code, message, data };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readRequest(value: unknown): RpcRequest | null {
  if (!isRecord(value) || value.jsonrpc !== "2.0" || typeof value.method !== "string") return null;
  const id = value.id;
  if (id !== undefined && id !== null && typeof id !== "string" && typeof id !== "number") return null;
  return { id: id === undefined ? null : (id as string | number | null), method: value.method, params: value.params };
}

function readOpen(params: unknown): { id: string; range?: ByteRange; projectId?: string } {
  if (!isRecord(params) || typeof params.id !== "string" || params.id.length === 0) {
    throw new InvalidStreamRequestError("artifact.open requires id");
  }
  const range = readRange(params.range);
  const projectId = typeof params.projectId === "string" ? params.projectId : undefined;
  if (range && projectId !== undefined) return { id: params.id, range, projectId };
  if (range) return { id: params.id, range };
  if (projectId !== undefined) return { id: params.id, projectId };
  return { id: params.id };
}

function readRange(value: unknown): ByteRange | undefined {
  if (value === undefined || value === null) return undefined;
  if (!isRecord(value)) throw new InvalidStreamRequestError("artifact range must be an object");
  if (typeof value.offset === "number" && typeof value.length === "number") {
    return { offset: value.offset, length: value.length };
  }
  if (typeof value.start === "number" && typeof value.end === "number") {
    return { offset: value.start, length: value.end - value.start };
  }
  throw new InvalidStreamRequestError("artifact range needs offset/length or start/end");
}

function readLogRange(params: unknown): LogRangeParams {
  if (!isRecord(params) || typeof params.artifactId !== "string") {
    throw new InvalidStreamRequestError("log.range requires artifactId");
  }
  if (typeof params.startLine !== "number" || typeof params.endLine !== "number") {
    throw new InvalidStreamRequestError("log.range requires startLine and endLine");
  }
  return { artifactId: params.artifactId, startLine: params.startLine, endLine: params.endLine };
}

function readLogSearch(params: unknown): LogSearchParams {
  if (!isRecord(params) || typeof params.artifactId !== "string" || typeof params.query !== "string") {
    throw new InvalidStreamRequestError("log.search requires artifactId and query");
  }
  if (typeof params.maxMatches !== "number") throw new InvalidStreamRequestError("log.search requires maxMatches");
  return { artifactId: params.artifactId, query: params.query, maxMatches: params.maxMatches };
}

function readDiffGet(params: unknown): DiffGetParams {
  if (!isRecord(params) || typeof params.task !== "string" || typeof params.file !== "string") {
    throw new InvalidStreamRequestError("diff.get requires task and file");
  }
  if (params.hunks === undefined) return { task: params.task, file: params.file };
  if (!Array.isArray(params.hunks)) throw new InvalidStreamRequestError("diff hunks must be an array");
  const hunks: number[] = [];
  for (const hunk of params.hunks) {
    if (typeof hunk !== "number") throw new InvalidStreamRequestError("diff hunks must be numbers");
    hunks.push(hunk);
  }
  return { task: params.task, file: params.file, hunks };
}
