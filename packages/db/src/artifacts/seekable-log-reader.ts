import { zstdDecompressSync } from "node:zlib";
import type { CasFormat } from "./cas-port.js";
import {
  DEFAULT_SEARCH_BYTE_BUDGET,
  DEFAULT_SEARCH_TIME_BUDGET_MS,
  MAX_ASSEMBLED_LINE_BYTES,
  MAX_FRAME_UNCOMPRESSED_BYTES,
} from "./constants.js";
import { FrameDecodeError, LogLineTooLargeError } from "./errors.js";
import { LINE_INDEX_SAMPLE_EVERY, type LineIndex, type LineIndexEntry } from "./line-index.js";
import { decompressFrame, parseSeekable, type SeekableFrame } from "./seekable-zstd.js";

export interface LogLine {
  readonly lineNumber: number;
  readonly text: string;
}

export interface LogRangeRead {
  readonly lines: readonly string[];
  readonly totalLines: number;
  readonly truncated: boolean;
  readonly framesDecompressed: number;
  readonly rebuiltIndex: LineIndex | null;
}

export interface LogSearchRead {
  readonly matches: readonly LogLine[];
  readonly truncated: boolean;
  readonly capped: boolean;
  readonly framesDecompressed: number;
}

interface RawFrame {
  readonly compressedOffset: number;
  readonly compressedSize: number;
  readonly decompressedSize: number;
  readonly raw: boolean;
}

type StopReason = "eof" | "range" | "callback" | "budget" | "time";

interface WalkInput {
  readonly stored: Buffer;
  readonly frames: readonly RawFrame[];
  readonly startFrame: number;
  readonly startOffset: number;
  readonly startLine: number;
  readonly collectFrom: number;
  readonly collectTo: number;
  readonly stopAfterCollectTo: boolean;
  readonly collectText: boolean;
  readonly captureIndex: boolean;
  readonly byteBudget: number | null;
  readonly deadline: number | null;
  readonly onLine: ((line: LogLine) => boolean) | null;
}

/**
 * Random-access reader for seekable zstd logs.
 * `frameDecompressionCount` counts zstd frame decodes so a viewport read can
 * prove it did not inflate the rest of the trace.
 */
export class SeekableLogReader {
  private frameDecompressions = 0;

  get frameDecompressionCount(): number {
    return this.frameDecompressions;
  }

  resetFrameDecompressionCount(): void {
    this.frameDecompressions = 0;
  }

  readRange(input: {
    readonly stored: Uint8Array;
    readonly format: CasFormat;
    readonly index: LineIndex | null;
    readonly startLine: number;
    readonly endLine: number;
  }): LogRangeRead {
    const before = this.frameDecompressions;
    const stored = Buffer.from(input.stored);
    const frames = framesFor(input.format, stored);
    if (input.index && input.startLine > input.index.totalLines) {
      return {
        lines: [],
        totalLines: input.index.totalLines,
        truncated: false,
        framesDecompressed: 0,
        rebuiltIndex: null,
      };
    }
    const origin = input.index
      ? locate(input.index, input.startLine)
      : { frameIndex: 0, offset: 0, lineNumber: 1 };
    const walked = this.walk({
      stored,
      frames,
      startFrame: origin.frameIndex,
      startOffset: origin.offset,
      startLine: origin.lineNumber,
      collectFrom: input.startLine,
      collectTo: input.endLine,
      stopAfterCollectTo: input.index !== null,
      collectText: true,
      captureIndex: input.index === null,
      byteBudget: null,
      deadline: null,
      onLine: null,
    });
    const totalLines = input.index ? input.index.totalLines : (walked.totalLines ?? 0);
    return {
      lines: walked.lines,
      totalLines,
      truncated: false,
      framesDecompressed: this.frameDecompressions - before,
      rebuiltIndex: walked.rebuiltIndex,
    };
  }

  query(input: {
    readonly stored: Uint8Array;
    readonly format: CasFormat;
    readonly pattern: RegExp;
    readonly maxMatches: number;
    readonly byteBudget?: number;
    readonly timeBudgetMs?: number;
  }): LogSearchRead {
    const before = this.frameDecompressions;
    const stored = Buffer.from(input.stored);
    const frames = framesFor(input.format, stored);
    const matches: LogLine[] = [];
    const byteBudget = input.byteBudget ?? DEFAULT_SEARCH_BYTE_BUDGET;
    const timeBudgetMs = input.timeBudgetMs ?? DEFAULT_SEARCH_TIME_BUDGET_MS;
    const walked = this.walk({
      stored,
      frames,
      startFrame: 0,
      startOffset: 0,
      startLine: 1,
      collectFrom: 1,
      collectTo: Number.POSITIVE_INFINITY,
      stopAfterCollectTo: false,
      collectText: false,
      captureIndex: false,
      byteBudget,
      deadline: Date.now() + timeBudgetMs,
      onLine: (line) => {
        input.pattern.lastIndex = 0;
        if (!input.pattern.test(line.text)) return true;
        matches.push(line);
        return matches.length < input.maxMatches;
      },
    });
    return {
      matches,
      truncated: walked.stop === "budget" || walked.stop === "time",
      capped: matches.length >= input.maxMatches && walked.stop === "callback",
      framesDecompressed: this.frameDecompressions - before,
    };
  }

  private walk(input: WalkInput): {
    readonly lines: string[];
    readonly stop: StopReason;
    readonly totalLines: number | null;
    readonly rebuiltIndex: LineIndex | null;
  } {
    const lines: string[] = [];
    const entries: LineIndexEntry[] = [];
    const chunks: Buffer[] = [];
    let pendingBytes = 0;
    let frameIndex = input.startFrame;
    let offset = input.startOffset;
    let lineNumber = input.startLine;
    let lineStartFrame = input.startFrame;
    let lineStartOffset = input.startOffset;
    let uncompressedBytes = 0;
    let bytesRead = 0;
    let decodedFrames = 0;
    let linesSeen = 0;
    let stop: StopReason | null = null;

    const noteLineStart = (): void => {
      if (!input.captureIndex || lineNumber % LINE_INDEX_SAMPLE_EVERY !== 0) return;
      entries.push({
        lineNumber,
        frameIndex: lineStartFrame,
        uncompressedOffsetInFrame: lineStartOffset,
      });
    };

    const emit = (): void => {
      let merged = chunks.length === 0 ? Buffer.alloc(0) : Buffer.concat(chunks, pendingBytes);
      chunks.length = 0;
      pendingBytes = 0;
      if (merged.length > 0 && merged[merged.length - 1] === 0x0d) {
        merged = merged.subarray(0, merged.length - 1);
      }
      const text = merged.toString("utf8");
      linesSeen += 1;
      if (input.collectText && lineNumber >= input.collectFrom && lineNumber <= input.collectTo) {
        lines.push(text);
      }
      if (input.onLine && !input.onLine({ lineNumber, text })) {
        stop = "callback";
        return;
      }
      if (input.stopAfterCollectTo && lineNumber >= input.collectTo) {
        stop = "range";
      }
    };

    noteLineStart();

    while (stop === null && frameIndex < input.frames.length) {
      if (input.deadline !== null && Date.now() > input.deadline) {
        stop = "time";
        break;
      }
      if (input.byteBudget !== null && decodedFrames > 0 && bytesRead >= input.byteBudget) {
        stop = "budget";
        break;
      }
      const frame = input.frames[frameIndex];
      if (!frame) break;
      const decoded = this.decode(input.stored, frame);
      decodedFrames += 1;
      uncompressedBytes += decoded.length;
      bytesRead += decoded.length;

      while (stop === null && offset < decoded.length) {
        const newline = decoded.indexOf(0x0a, offset);
        if (newline === -1) {
          const rest = decoded.subarray(offset);
          this.pushChunk(chunks, rest, pendingBytes);
          pendingBytes += rest.length;
          offset = decoded.length;
          break;
        }
        const piece = decoded.subarray(offset, newline);
        this.pushChunk(chunks, piece, pendingBytes);
        pendingBytes += piece.length;
        emit();
        if (stop !== null) break;
        lineNumber += 1;
        offset = newline + 1;
        if (offset < decoded.length) {
          lineStartFrame = frameIndex;
          lineStartOffset = offset;
        } else {
          lineStartFrame = frameIndex + 1;
          lineStartOffset = 0;
        }
        if (!hasMoreContent(input.frames, frameIndex, offset, decoded.length)) {
          stop = "eof";
          break;
        }
        noteLineStart();
      }

      if (stop !== null) break;
      frameIndex += 1;
      offset = 0;
    }

    if (stop === null) stop = "eof";
    if (stop === "eof" && chunks.length > 0) {
      emit();
    }

    const scannedFromOrigin =
      input.startLine === 1 && input.startFrame === 0 && input.startOffset === 0 && stop === "eof";
    const totalLines = scannedFromOrigin ? linesSeen : null;
    return {
      lines,
      stop,
      totalLines,
      rebuiltIndex:
        input.captureIndex && scannedFromOrigin
          ? {
              version: 1,
              totalLines: linesSeen,
              totalUncompressedBytes: uncompressedBytes,
              sampleEvery: LINE_INDEX_SAMPLE_EVERY,
              entries,
            }
          : null,
    };
  }

  private pushChunk(chunks: Buffer[], piece: Buffer, pendingBytes: number): void {
    if (piece.length === 0) return;
    if (pendingBytes + piece.length > MAX_ASSEMBLED_LINE_BYTES) {
      throw new LogLineTooLargeError(MAX_ASSEMBLED_LINE_BYTES);
    }
    chunks.push(Buffer.from(piece));
  }

  private decode(stored: Buffer, frame: RawFrame): Buffer {
    if (frame.raw) {
      return stored.subarray(frame.compressedOffset, frame.compressedOffset + frame.compressedSize);
    }
    this.frameDecompressions += 1;
    if (frame.decompressedSize >= 0) return decompressFrame(stored, frame);
    try {
      return Buffer.from(
        zstdDecompressSync(
          stored.subarray(frame.compressedOffset, frame.compressedOffset + frame.compressedSize),
          { maxOutputLength: MAX_FRAME_UNCOMPRESSED_BYTES },
        ),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "zstd frame decode failed";
      throw new FrameDecodeError(message);
    }
  }
}

function framesFor(format: CasFormat, stored: Buffer): RawFrame[] {
  if (format === "zstd-seekable") {
    return parseSeekable(stored).map((frame: SeekableFrame) => ({ ...frame, raw: false }));
  }
  if (format === "raw") {
    return [
      {
        compressedOffset: 0,
        compressedSize: stored.length,
        decompressedSize: stored.length,
        raw: true,
      },
    ];
  }
  return [
    {
      compressedOffset: 0,
      compressedSize: stored.length,
      decompressedSize: -1,
      raw: false,
    },
  ];
}

function locate(
  index: LineIndex,
  startLine: number,
): { frameIndex: number; offset: number; lineNumber: number } {
  let frameIndex = 0;
  let offset = 0;
  let lineNumber = 1;
  for (const entry of index.entries) {
    if (entry.lineNumber > startLine) break;
    frameIndex = entry.frameIndex;
    offset = entry.uncompressedOffsetInFrame;
    lineNumber = entry.lineNumber;
  }
  return { frameIndex, offset, lineNumber };
}

function hasMoreContent(
  frames: readonly RawFrame[],
  frameIndex: number,
  offset: number,
  frameLength: number,
): boolean {
  if (offset < frameLength) return true;
  for (let index = frameIndex + 1; index < frames.length; index += 1) {
    const frame = frames[index];
    if (frame && frame.decompressedSize !== 0) return true;
  }
  return false;
}
