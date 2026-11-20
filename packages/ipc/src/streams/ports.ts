/**
 * Ports for tasks that are not on this branch yet.
 * `ArtifactLogReader` matches `ArtifactManager.readLogRange` / `queryLogStream`.
 * `adaptFrameCodec` accepts the transport `FrameCodec` shape from Task 031.
 */

export type ArtifactRetention = "evidence" | "asset" | "diagnostic" | "ephemeral";

export type ArtifactBytesFormat = "raw" | "zstd" | "zstd-seekable";

export interface ArtifactDescriptor {
  readonly id: string;
  readonly projectId: string;
  readonly retention: ArtifactRetention;
  readonly mime: string;
  readonly totalBytes: number;
  readonly sha256: string;
  readonly format: ArtifactBytesFormat;
  /** CAS key when it differs from the streamed slice hash. Defaults to `sha256`. */
  readonly casHash?: string;
}

export interface ArtifactCatalog {
  lookup(
    projectId: string,
    artifactId: string,
  ): Promise<ArtifactDescriptor | null> | ArtifactDescriptor | null;
  open(
    descriptor: ArtifactDescriptor,
    range?: ByteRange,
  ): Promise<ArtifactByteSource> | ArtifactByteSource;
  verifyIntegrity?(descriptor: ArtifactDescriptor): Promise<void> | void;
}

/** Byte offset plus length. `length` may be zero. */
export interface ByteRange {
  readonly offset: number;
  readonly length: number;
}

/** Reads at most `length` bytes starting at `offset` within an already-sliced range. */
export interface ArtifactByteSource {
  readonly closed: boolean;
  /** Open file descriptors plus live decompressors. */
  readonly handles: number;
  read(offset: number, length: number): Uint8Array | Promise<Uint8Array>;
  close(): void;
}

export interface BlobReadHandle {
  read(maxBytes: number): Promise<Uint8Array | null>;
  close(): Promise<void>;
}

/** Pull-style CAS reader kept for callers that already have a blob path. */
export interface CasBlobSource {
  open(descriptor: ArtifactDescriptor, range?: ByteRange): Promise<BlobReadHandle>;
}

/** Full-hash check used when the catalog does not verify evidence and asset blobs itself. */
export interface CasIntegrityPort {
  verifyBlobIntegrity(hash: string): Promise<void> | void;
}

export interface LogRangeResult {
  readonly lines: readonly string[];
  readonly totalLines: number;
  readonly truncated: boolean;
  readonly framesDecompressed: number;
  readonly indexSource: "sidecar" | "regenerated" | "frame-scan" | "single-frame";
}

export interface LogSearchResult {
  readonly matches: readonly { readonly lineNumber: number; readonly text: string }[];
  readonly truncated: boolean;
  readonly capped: boolean;
  readonly framesDecompressed: number;
}

export interface ArtifactLogReader {
  readLogRange(
    artifactId: string,
    startLine: number,
    endLine: number,
    options?: { readonly regenerateMissingIndex?: boolean },
  ): Promise<LogRangeResult> | LogRangeResult;
  queryLogStream(
    artifactId: string,
    pattern: string,
    maxMatches: number,
    options?: { readonly byteBudget?: number; readonly timeBudgetMs?: number },
  ): Promise<LogSearchResult> | LogSearchResult;
}

export interface DiffHunkHeader {
  readonly index: number;
  readonly header: string;
  readonly oldStart: number;
  readonly oldCount: number;
  readonly newStart: number;
  readonly newCount: number;
  readonly insertions: number;
  readonly deletions: number;
}

export interface DiffHunkBody extends DiffHunkHeader {
  readonly lines: readonly string[];
}

export interface DiffSummary {
  readonly path: string;
  readonly insertions: number;
  readonly deletions: number;
  readonly hunks: readonly DiffHunkHeader[];
  readonly projectId?: string;
}

export interface DiffSource {
  summarize(
    projectId: string,
    task: string,
    file: string,
  ): Promise<DiffSummary | null> | DiffSummary | null;
  readHunks(
    projectId: string,
    task: string,
    file: string,
    hunkIndexes: readonly number[],
  ): Promise<readonly DiffHunkBody[]> | readonly DiffHunkBody[];
}

export type OutboundLane = "control" | "binary";

/** Scheduler sink. Control frames must be writable ahead of queued binary chunks. */
export interface StreamOutput {
  enqueue(frame: Uint8Array, lane: OutboundLane): void;
  dropBinaryStream(streamId: number): void;
}
