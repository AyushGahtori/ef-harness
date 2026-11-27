import { createHash, type Hash } from "node:crypto";
import type { CasBlobStore } from "@ef-harness/db";
import { createCasArtifactCatalog } from "./cas-bind.js";
import {
  CHUNK_BYTES,
  DEFAULT_IDLE_TIMEOUT_MS,
  DEFAULT_INITIAL_CREDITS,
  EMPTY_SHA256,
  MAX_CREDIT_GRANT,
  MAX_OUTSTANDING_CREDITS,
  MAX_PREFETCH_CHUNKS,
  MIN_CREDIT_GRANT,
} from "./constants.js";
import {
  ArtifactNotFoundError,
  CasBlobMissingError,
  CasIntegrityMismatchError,
  InvalidCreditError,
  InvalidStreamRequestError,
  StreamIdleTimeoutError,
  isCasBlobMissingError,
  isCasIntegrityMismatchError,
} from "./errors.js";
import { binaryStreamId, encodeBinaryFrame, encodeJsonFrame, framePayloadLength } from "./frame.js";
import { encodeJsonPayload } from "./json-guard.js";
import { retentionRequiresFullHash } from "./byte-source.js";
import type {
  ArtifactByteSource,
  ArtifactCatalog,
  ArtifactDescriptor,
  ByteRange,
  CasIntegrityPort,
  StreamOutput,
} from "./ports.js";

export interface ArtifactOpenResult {
  readonly streamId: number;
  readonly totalBytes: number;
  readonly mime: string;
  readonly chunkBytes: typeof CHUNK_BYTES;
  readonly initialCredits: number;
  readonly empty: boolean;
  readonly sha256: string;
}

export interface BinaryStreamManagerOptions {
  readonly projectId: string;
  readonly catalog: ArtifactCatalog;
  readonly output: StreamOutput;
  readonly initialCredits?: number;
  readonly idleTimeoutMs?: number;
  readonly cas?: CasIntegrityPort;
  /** When set, chunk bytes come from `CasBlobStore.openReadStream`. */
  readonly blobs?: CasBlobStore;
}

interface LiveStream {
  readonly id: number;
  readonly source: ArtifactByteSource;
  readonly total: number;
  readonly hashLabel: string;
  readonly digest: Hash;
  offset: number;
  /** Chunks the client has authorized that have not been read yet. */
  readBudget: number;
  /** Hard cap on retained chunk buffers. Stays at the advertised initial window. */
  bufferCap: number;
  heldChunks: number;
  heldBytes: number;
  bytesSent: number;
  endSent: boolean;
  failed: boolean;
  timer: NodeJS.Timeout | null;
}

interface EmptyCompletion {
  readonly sha256: string;
}

/**
 * Connection-scoped credit scheduler.
 * Disk and decompressors are read only while this stream's retained buffers
 * are below its credit window, so a paused renderer cannot pin a 200 MB trace.
 */
export class BinaryStreamManager {
  readonly projectId: string;
  private readonly catalog: ArtifactCatalog;
  private readonly output: StreamOutput;
  private readonly initialCredits: number;
  private readonly prefetchWindow: number;
  private readonly idleTimeoutMs: number;
  private readonly cas: CasIntegrityPort | undefined;
  private readonly streams = new Map<number, LiveStream>();
  private readonly emptyById = new Map<number, EmptyCompletion>();
  private nextId = 1;
  private cursor = 0;
  private chain: Promise<void> = Promise.resolve();
  private disposed = false;
  private bufferedBytes = 0;
  private maxBufferedBytes = 0;
  private maxStreamBufferedBytes = 0;

  constructor(options: BinaryStreamManagerOptions) {
    if (!options.projectId) throw new InvalidStreamRequestError("projectId is required");
    const initial = options.initialCredits ?? DEFAULT_INITIAL_CREDITS;
    if (!Number.isInteger(initial) || initial < 0 || initial > MAX_OUTSTANDING_CREDITS) {
      throw new InvalidStreamRequestError("initialCredits must be an integer from 0 to 512");
    }
    this.projectId = options.projectId;
    this.catalog = options.blobs
      ? createCasArtifactCatalog({
          store: options.blobs,
          lookup: (projectId, artifactId) => options.catalog.lookup(projectId, artifactId),
        })
      : options.catalog;
    this.output = options.output;
    this.initialCredits = initial;
    this.prefetchWindow = Math.min(initial > 0 ? initial : DEFAULT_INITIAL_CREDITS, MAX_PREFETCH_CHUNKS);
    this.idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
    this.cas = options.cas;
  }

  get openStreamCount(): number {
    return this.streams.size;
  }

  get openHandleCount(): number {
    let handles = 0;
    for (const stream of this.streams.values()) handles += stream.source.handles;
    return handles;
  }

  get bufferedPayloadBytes(): number {
    return this.bufferedBytes;
  }

  get maxBufferedPayloadBytes(): number {
    return this.maxBufferedBytes;
  }

  get maxStreamBufferedPayloadBytes(): number {
    return this.maxStreamBufferedBytes;
  }

  async prepare(params: { readonly id: string; readonly range?: ByteRange; readonly projectId?: string }): Promise<ArtifactOpenResult> {
    if (this.disposed) throw new InvalidStreamRequestError("stream manager is closed");
    if (typeof params.id !== "string" || params.id.length === 0) {
      throw new InvalidStreamRequestError("artifact id is required");
    }
    if (params.projectId !== undefined && params.projectId !== this.projectId) {
      throw new ArtifactNotFoundError(params.id);
    }
    const descriptor = await this.catalog.lookup(this.projectId, params.id);
    if (!descriptor || descriptor.projectId !== this.projectId) throw new ArtifactNotFoundError(params.id);
    if (descriptor.format === "zstd-seekable") {
      throw new InvalidStreamRequestError("seekable logs are fetched with log.range, not artifact.open");
    }
    const range = normalizeRange(params.range, descriptor.totalBytes);
    if (retentionRequiresFullHash(descriptor.retention)) {
      await this.verifyRetainedBlob(descriptor);
    }
    const streamId = this.allocateId();
    const total = range.length;
    if (total === 0) {
      this.emptyById.set(streamId, { sha256: EMPTY_SHA256 });
      return {
        streamId,
        totalBytes: 0,
        mime: descriptor.mime,
        chunkBytes: CHUNK_BYTES,
        initialCredits: 0,
        empty: true,
        sha256: EMPTY_SHA256,
      };
    }
    const source = await this.catalog.open(descriptor, range);
    this.streams.set(streamId, {
      id: streamId,
      source,
      total,
      hashLabel: descriptor.sha256,
      digest: createHash("sha256"),
      offset: 0,
      readBudget: this.initialCredits,
      bufferCap: this.prefetchWindow,
      heldChunks: 0,
      heldBytes: 0,
      bytesSent: 0,
      endSent: false,
      failed: false,
      timer: null,
    });
    if (this.initialCredits === 0) this.armIdle(streamId);
    return {
      streamId,
      totalBytes: total,
      mime: descriptor.mime,
      chunkBytes: CHUNK_BYTES,
      initialCredits: this.initialCredits,
      empty: false,
      sha256: descriptor.sha256,
    };
  }

  /** Clean EOF for a zero-byte artifact. Does not wait for credits and holds no slot. */
  completeEmpty(streamId: number): void {
    const empty = this.emptyById.get(streamId);
    if (!empty) return;
    this.emptyById.delete(streamId);
    this.emitEnd(streamId, 0, empty.sha256);
  }

  /** Round-robin prefetch across every stream that still has budget and buffer room. */
  kick(): void {
    if (this.disposed) return;
    this.chain = this.chain
      .catch(() => undefined)
      .then(() => this.pumpStreams())
      .catch(() => undefined);
  }

  async whenIdle(): Promise<void> {
    let current = this.chain;
    for (;;) {
      await current;
      if (this.chain === current) return;
      current = this.chain;
    }
  }

  grantCredit(streamId: number, chunks: unknown): { readonly applied: boolean; readonly outstanding: number } {
    if (!this.streams.has(streamId)) return { applied: false, outstanding: 0 };
    const stream = this.streams.get(streamId);
    if (!stream || stream.failed) return { applied: false, outstanding: 0 };
    const granted = parseGrant(chunks, stream.readBudget + stream.heldChunks);
    stream.readBudget += granted;
    this.clearIdle(stream);
    this.kick();
    return { applied: true, outstanding: stream.readBudget + stream.heldChunks };
  }

  closeStream(streamId: number): { readonly applied: boolean } {
    const stream = this.streams.get(streamId);
    if (!stream) return { applied: false };
    this.release(stream);
    return { applied: true };
  }

  noteBinarySent(frame: Uint8Array): void {
    const streamId = readId(frame);
    if (streamId === null) return;
    const stream = this.streams.get(streamId);
    if (!stream || stream.failed) return;
    const payload = framePayloadLength(frame);
    stream.heldChunks = Math.max(0, stream.heldChunks - 1);
    stream.heldBytes = Math.max(0, stream.heldBytes - payload);
    stream.bytesSent += payload;
    this.recount();
    if (stream.offset >= stream.total && stream.heldChunks === 0) this.finish(stream);
    else if (stream.readBudget === 0 && stream.heldChunks === 0 && stream.offset < stream.total) this.armIdle(stream.id);
    else this.kick();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const stream of [...this.streams.values()]) this.release(stream);
    this.emptyById.clear();
    this.recount();
  }

  /**
   * Evidence and asset blobs are hashed before any chunk is sent.
   * A zero-byte blob has a known SHA-256, so it does not need a file handle.
   */
  private async verifyRetainedBlob(descriptor: ArtifactDescriptor): Promise<void> {
    if (this.catalog.verifyIntegrity) {
      await this.catalog.verifyIntegrity(descriptor);
      return;
    }
    const hash = descriptor.casHash ?? descriptor.sha256;
    if (this.cas) {
      await this.cas.verifyBlobIntegrity(hash);
      return;
    }
    if (descriptor.totalBytes === 0) {
      if (descriptor.sha256 !== EMPTY_SHA256) {
        throw new CasIntegrityMismatchError({
          hash: descriptor.sha256,
          actualHash: EMPTY_SHA256,
          retention: descriptor.retention,
          reason: "zero-byte artifact hash is not the empty SHA-256",
        });
      }
      return;
    }
    throw new CasBlobMissingError(hash);
  }

  private allocateId(): number {
    const id = this.nextId;
    this.nextId = (this.nextId + 1) >>> 0;
    if (this.nextId === 0) this.nextId = 1;
    return id;
  }

  private async pumpStreams(): Promise<void> {
    if (this.disposed) return;
    let progressed = true;
    while (progressed && !this.disposed) {
      progressed = false;
      const ids = [...this.streams.keys()];
      if (ids.length === 0) return;
      const start = this.cursor % ids.length;
      for (let step = 0; step < ids.length; step += 1) {
        const id = ids[(start + step) % ids.length];
        if (id === undefined) continue;
        const stream = this.streams.get(id);
        if (!stream || !this.canPrefetch(stream)) continue;
        await this.prefetch(stream);
        this.cursor = (start + step + 1) % Math.max(1, this.streams.size);
        progressed = true;
        break;
      }
    }
  }

  private canPrefetch(stream: LiveStream): boolean {
    return (
      !stream.failed &&
      !stream.endSent &&
      stream.readBudget > 0 &&
      stream.heldChunks < stream.bufferCap &&
      stream.offset < stream.total
    );
  }

  private async prefetch(stream: LiveStream): Promise<void> {
    const want = Math.min(CHUNK_BYTES, stream.total - stream.offset);
    let bytes: Uint8Array;
    try {
      bytes = await stream.source.read(stream.offset, want);
    } catch (error) {
      if (stream.source.closed || !this.streams.has(stream.id)) return;
      this.fail(stream, error);
      return;
    }
    if (!this.streams.has(stream.id) || stream.failed) return;
    if (bytes.byteLength !== want) {
      this.fail(stream, new CasBlobMissingError(stream.hashLabel));
      return;
    }
    stream.digest.update(bytes);
    stream.offset += bytes.byteLength;
    stream.readBudget -= 1;
    stream.heldChunks += 1;
    stream.heldBytes += bytes.byteLength;
    this.recount();
    this.clearIdle(stream);
    this.output.enqueue(encodeBinaryFrame(stream.id, bytes), "binary");
  }

  private finish(stream: LiveStream): void {
    if (stream.endSent || stream.failed) return;
    stream.endSent = true;
    const sha256 = stream.digest.copy().digest("hex");
    const bytesSent = stream.bytesSent;
    const id = stream.id;
    this.release(stream);
    this.emitEnd(id, bytesSent, sha256);
  }

  private fail(stream: LiveStream, error: unknown): void {
    if (stream.failed) return;
    stream.failed = true;
    const code = isCasBlobMissingError(error)
      ? "CAS_BLOB_MISSING"
      : isCasIntegrityMismatchError(error)
        ? "CAS_INTEGRITY_MISMATCH"
        : error instanceof StreamIdleTimeoutError
          ? "STREAM_IDLE_TIMEOUT"
          : "STREAM_FAILED";
    const message = error instanceof Error ? error.message : "stream failed";
    const id = stream.id;
    this.release(stream);
    this.emitError(id, code, message);
  }

  private release(stream: LiveStream): void {
    this.clearIdle(stream);
    this.output.dropBinaryStream(stream.id);
    stream.heldBytes = 0;
    stream.heldChunks = 0;
    stream.source.close();
    this.streams.delete(stream.id);
    this.recount();
  }

  private emitEnd(streamId: number, bytesSent: number, sha256: string): void {
    this.output.enqueue(
      encodeJsonFrame(
        encodeJsonPayload({
          jsonrpc: "2.0",
          method: "stream.end",
          params: { streamId, bytesSent, sha256 },
        }),
      ),
      "control",
    );
    this.output.enqueue(encodeBinaryFrame(streamId, Buffer.alloc(0)), "control");
  }

  private emitError(streamId: number, code: string, message: string): void {
    this.output.enqueue(
      encodeJsonFrame(
        encodeJsonPayload({
          jsonrpc: "2.0",
          method: "stream.error",
          params: { streamId, code, message },
        }),
      ),
      "control",
    );
  }

  private armIdle(streamId: number): void {
    const stream = this.streams.get(streamId);
    if (!stream || stream.timer) return;
    stream.timer = setTimeout(() => {
      const current = this.streams.get(streamId);
      if (!current || current.failed) return;
      if (current.readBudget > 0 || current.heldChunks > 0) return;
      this.fail(current, new StreamIdleTimeoutError(streamId, this.idleTimeoutMs));
    }, this.idleTimeoutMs);
    stream.timer.unref();
  }

  private clearIdle(stream: LiveStream): void {
    if (!stream.timer) return;
    clearTimeout(stream.timer);
    stream.timer = null;
  }

  private recount(): void {
    let total = 0;
    let maxStream = 0;
    for (const stream of this.streams.values()) {
      total += stream.heldBytes;
      if (stream.heldBytes > maxStream) maxStream = stream.heldBytes;
    }
    this.bufferedBytes = total;
    if (total > this.maxBufferedBytes) this.maxBufferedBytes = total;
    if (maxStream > this.maxStreamBufferedBytes) this.maxStreamBufferedBytes = maxStream;
  }
}

function normalizeRange(range: ByteRange | undefined, totalBytes: number): ByteRange {
  if (!range) return { offset: 0, length: totalBytes };
  if (!Number.isSafeInteger(range.offset) || !Number.isSafeInteger(range.length)) {
    throw new InvalidStreamRequestError("artifact range must be integers");
  }
  if (range.offset < 0 || range.length < 0 || range.offset + range.length > totalBytes) {
    throw new InvalidStreamRequestError("artifact range is outside the blob");
  }
  return range;
}

function parseGrant(chunks: unknown, outstanding: number): number {
  if (typeof chunks !== "number" || !Number.isSafeInteger(chunks)) {
    throw new InvalidCreditError(typeof chunks === "number" ? chunks : 0, outstanding, "credit grant must be an integer");
  }
  if (chunks < MIN_CREDIT_GRANT || chunks > MAX_CREDIT_GRANT) {
    throw new InvalidCreditError(
      chunks,
      outstanding,
      `credit grant must be from ${String(MIN_CREDIT_GRANT)} to ${String(MAX_CREDIT_GRANT)}`,
    );
  }
  if (outstanding + chunks > MAX_OUTSTANDING_CREDITS) {
    throw new InvalidCreditError(chunks, outstanding, "outstanding credits would exceed 512");
  }
  return chunks;
}

function readId(frame: Uint8Array): number | null {
  return binaryStreamId(frame);
}
