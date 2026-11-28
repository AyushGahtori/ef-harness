import type {
  DiffHunkBody,
  HandoffHop,
  HandoffRead,
  InspectorTaskSnapshot,
  PinnedBrief,
} from "./types.js";

/**
 * Local stand-in for Task 033 `ArtifactStreamClient` + `RangeDiffHandler`.
 * Integration binds `fetchDiffRange` to `diff.get` hunk bodies, 64 KB at a time.
 */
export interface DiffRangeChunk {
  readonly attemptId: string;
  readonly filePath: string;
  readonly hunkOffset: number;
  readonly limit: number;
  readonly bytesRead: number;
  readonly hunks: readonly DiffHunkBody[];
}

export interface LogByteChunk {
  readonly artifactId: string;
  readonly byteOffset: number;
  readonly bytes: Uint8Array;
  readonly totalBytes: number;
  readonly archived: boolean;
}

export interface ScreenshotChunk {
  readonly artifactId: string;
  readonly bytes: Uint8Array;
  readonly totalBytes: number;
}

export interface BinaryStreamClient {
  fetchDiffRange(
    attemptId: string,
    filePath: string,
    hunkOffset: number,
    limit: number,
    signal: AbortSignal,
  ): Promise<DiffRangeChunk>;

  fetchLogChunk(
    artifactId: string,
    byteOffset: number,
    limit: number,
    signal: AbortSignal,
  ): Promise<LogByteChunk>;

  fetchScreenshot(
    artifactId: string,
    byteOffset: number,
    limit: number,
    signal: AbortSignal,
  ): Promise<ScreenshotChunk>;
}

export interface LogLocation {
  readonly artifactId: string;
  readonly byteOffset: number;
  readonly byteLength: number;
  readonly startLine: number;
  readonly endLine: number;
  readonly totalLines: number;
  readonly totalBytes: number;
  readonly archived: boolean;
  readonly framesDecompressed: number;
}

/**
 * Local stand-in for Task 029 `SeekableLogReader`.
 * The inspector never asks for more than 64 KB or 500 lines.
 */
export interface SeekableZstdLogReader {
  locateLineWindow(
    artifactId: string,
    startLine: number,
    maxLines: number,
    maxBytes: number,
    signal: AbortSignal,
  ): Promise<LogLocation>;
}

/**
 * Local stand-in for Task 088 `KnowledgePacketSlicer` manifest lookup.
 * `pinnedManifest` must return the hash the attempt executed, not the live graph.
 */
export interface KnowledgePacketSlicerManifestPort {
  pinnedManifest(sliceSha256: string, signal: AbortSignal): Promise<PinnedBrief>;
  previewManifest(taskId: string, signal: AbortSignal): Promise<PinnedBrief>;
}

/** Local stand-in for Task 109 `ArtifactHandoffStore` reads and lineage. */
export interface ArtifactHandoffStore {
  readsForAttempt(attemptId: string, signal: AbortSignal): Promise<readonly HandoffRead[]>;
  lineage(handoffId: string): readonly HandoffHop[];
}

/** Task snapshot the board/office click supplies until those tasks share a tree. */
export interface InspectorTaskCatalog {
  load(taskId: string, signal: AbortSignal): Promise<InspectorTaskSnapshot>;
}

/** Actions the single app shell (Task 122) and pop-out host (Task 123) perform. */
export interface InspectorShellPort {
  pause(taskId: string): void;
  explain(taskId: string, summary: string, evidence: readonly string[]): void;
  fixedItMyself(taskId: string): void;
  openCanvasNode(nodeId: string): void;
  openInEditor(command: string): void;
  disputeTest(taskId: string, checkId: string): void;
  copyText(text: string): void;
}

export interface InspectorDependencies {
  readonly catalog: InspectorTaskCatalog;
  readonly slicer: KnowledgePacketSlicerManifestPort;
  readonly handoffs: ArtifactHandoffStore;
  readonly binary: BinaryStreamClient;
  readonly logs: SeekableZstdLogReader;
  readonly shell: InspectorShellPort;
}
