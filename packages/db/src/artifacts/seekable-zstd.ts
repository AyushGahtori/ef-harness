import { createHash, timingSafeEqual } from "node:crypto";
import { zstdCompressSync, zstdDecompressSync } from "node:zlib";
import type { CasFormat } from "./cas-port.js";
import { LINE_INDEX_SAMPLE_EVERY, MAX_FRAME_UNCOMPRESSED_BYTES } from "./constants.js";
import { FrameDecodeError } from "./errors.js";
import type { LineIndex } from "./line-index.js";

const SKIPPABLE_MAGIC = 0x184d2a5e;
const SEEKABLE_MAGIC = 0x8f92eab1;

export interface SeekableFrame {
  readonly compressedOffset: number;
  readonly compressedSize: number;
  readonly decompressedSize: number;
}

export interface SeekableEncodedLog {
  readonly uncompressed: Buffer;
  readonly stored: Buffer;
  readonly frames: readonly SeekableFrame[];
  readonly index: LineIndex;
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function splitUtf8FrameRanges(
  bytes: Buffer,
  frameBytes: number,
): Array<{ start: number; end: number }> {
  if (bytes.length === 0) return [{ start: 0, end: 0 }];
  const ranges: Array<{ start: number; end: number }> = [];
  let start = 0;
  while (start < bytes.length) {
    let end = Math.min(start + frameBytes, bytes.length);
    if (end < bytes.length) {
      end = retreatToUtf8Boundary(bytes, end);
      if (end <= start) {
        end = Math.min(bytes.length, start + utf8SequenceLength(bytes[start] ?? 0));
      }
    }
    ranges.push({ start, end });
    start = end;
  }
  return ranges;
}

function retreatToUtf8Boundary(bytes: Buffer, end: number): number {
  if (end >= bytes.length) return bytes.length;
  const at = bytes[end] ?? 0;
  if ((at & 0xc0) !== 0x80) return end;
  let index = end;
  while (index > 0 && ((bytes[index] ?? 0) & 0xc0) === 0x80) index -= 1;
  return index;
}

function utf8SequenceLength(lead: number): number {
  if ((lead & 0x80) === 0) return 1;
  if ((lead & 0xe0) === 0xc0) return 2;
  if ((lead & 0xf0) === 0xe0) return 3;
  if ((lead & 0xf8) === 0xf0) return 4;
  return 1;
}

export function encodeSeekableLog(text: string, frameBytes: number): SeekableEncodedLog {
  const uncompressed = Buffer.from(text, "utf8");
  const ranges = splitUtf8FrameRanges(uncompressed, frameBytes);
  const compressedFrames: Buffer[] = [];
  const frames: SeekableFrame[] = [];
  let compressedOffset = 0;
  for (const range of ranges) {
    const slice = uncompressed.subarray(range.start, range.end);
    const compressed = Buffer.from(
      zstdCompressSync(slice, { pledgedSrcSize: slice.length }),
    );
    compressedFrames.push(compressed);
    frames.push({
      compressedOffset,
      compressedSize: compressed.length,
      decompressedSize: slice.length,
    });
    compressedOffset += compressed.length;
  }
  const stored = Buffer.concat([...compressedFrames, encodeSeekTable(frames)]);
  return {
    uncompressed,
    stored,
    frames,
    index: buildLineIndex(uncompressed, ranges),
  };
}

export function encodeSingleZstd(bytes: Buffer): Buffer {
  return Buffer.from(zstdCompressSync(bytes, { pledgedSrcSize: bytes.length }));
}

export function parseSeekable(stored: Buffer): SeekableFrame[] {
  if (stored.length < 17) {
    throw new FrameDecodeError("Seekable zstd payload is too short to contain a seek table.");
  }
  const magic = stored.readUInt32LE(stored.length - 4);
  if (magic !== SEEKABLE_MAGIC) {
    throw new FrameDecodeError("Seekable zstd payload is missing the seek-table magic.");
  }
  const descriptor = stored[stored.length - 5] ?? 0;
  if ((descriptor & 0x7f) !== 0) {
    throw new FrameDecodeError("Seekable zstd descriptor has reserved bits set.");
  }
  const checksum = (descriptor & 0x80) !== 0;
  const entrySize = checksum ? 12 : 8;
  const frameCount = stored.readUInt32LE(stored.length - 9);
  if (frameCount < 1 || frameCount > 1_000_000) {
    throw new FrameDecodeError("Seekable zstd frame count is invalid.");
  }
  const userSize = frameCount * entrySize + 9;
  const tableStart = stored.length - (8 + userSize);
  if (tableStart < 0) {
    throw new FrameDecodeError("Seekable zstd seek table overruns the payload.");
  }
  if (stored.readUInt32LE(tableStart) !== SKIPPABLE_MAGIC) {
    throw new FrameDecodeError("Seekable zstd skippable-frame magic is missing.");
  }
  if (stored.readUInt32LE(tableStart + 4) !== userSize) {
    throw new FrameDecodeError("Seekable zstd skippable-frame size does not match the footer.");
  }
  const frames: SeekableFrame[] = [];
  let offset = 0;
  for (let index = 0; index < frameCount; index += 1) {
    const at = tableStart + 8 + index * entrySize;
    const compressedSize = stored.readUInt32LE(at);
    const decompressedSize = stored.readUInt32LE(at + 4);
    if (compressedSize < 1 || decompressedSize > MAX_FRAME_UNCOMPRESSED_BYTES) {
      throw new FrameDecodeError("Seekable zstd frame size is outside the allowed bound.");
    }
    if (offset + compressedSize > tableStart) {
      throw new FrameDecodeError("Seekable zstd frames overlap the seek table.");
    }
    frames.push({ compressedOffset: offset, compressedSize, decompressedSize });
    offset += compressedSize;
  }
  if (offset !== tableStart) {
    throw new FrameDecodeError("Seekable zstd frames do not pack exactly up to the seek table.");
  }
  return frames;
}

export function decompressFrame(stored: Buffer, frame: SeekableFrame): Buffer {
  const slice = stored.subarray(frame.compressedOffset, frame.compressedOffset + frame.compressedSize);
  let decoded: Buffer;
  try {
    decoded = Buffer.from(
      zstdDecompressSync(slice, {
        maxOutputLength: Math.max(frame.decompressedSize, 1),
      }),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "zstd frame decode failed";
    throw new FrameDecodeError(message);
  }
  if (decoded.length !== frame.decompressedSize) {
    throw new FrameDecodeError("Decompressed zstd frame size does not match the seek table.");
  }
  return decoded;
}

export function decodeSeekableFrames(stored: Uint8Array): Buffer[] {
  const buffer = Buffer.from(stored);
  return parseSeekable(buffer).map((frame) => decompressFrame(buffer, frame));
}

export function verifyCompressedPayload(input: {
  readonly stored: Uint8Array;
  readonly format: CasFormat;
  readonly expectedHash: string;
}): { ok: true } | { ok: false; reason: string } {
  try {
    const hash = createHash("sha256");
    if (input.format === "raw") {
      hash.update(input.stored);
    } else if (input.format === "zstd") {
      hash.update(zstdDecompressSync(input.stored, { maxOutputLength: MAX_FRAME_UNCOMPRESSED_BYTES }));
    } else {
      const stored = Buffer.from(input.stored);
      for (const frame of decompressAll(stored)) {
        hash.update(frame);
      }
    }
    const digest = hash.digest();
    const expected = Buffer.from(input.expectedHash, "hex");
    if (expected.length !== digest.length || !timingSafeEqual(digest, expected)) {
      return { ok: false, reason: "sha256 mismatch" };
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : "decode failed" };
  }
}

function decompressAll(stored: Buffer): Buffer[] {
  return parseSeekable(stored).map((frame) => decompressFrame(stored, frame));
}

function encodeSeekTable(frames: readonly SeekableFrame[]): Buffer {
  const userSize = frames.length * 8 + 9;
  const out = Buffer.alloc(8 + userSize);
  out.writeUInt32LE(SKIPPABLE_MAGIC, 0);
  out.writeUInt32LE(userSize, 4);
  let cursor = 8;
  for (const frame of frames) {
    out.writeUInt32LE(frame.compressedSize, cursor);
    out.writeUInt32LE(frame.decompressedSize, cursor + 4);
    cursor += 8;
  }
  out.writeUInt32LE(frames.length, cursor);
  out.writeUInt8(0, cursor + 4);
  out.writeUInt32LE(SEEKABLE_MAGIC, cursor + 5);
  return out;
}

export function buildLineIndex(
  bytes: Buffer,
  ranges: readonly { start: number; end: number }[],
): LineIndex {
  const entries: LineIndex["entries"][number][] = [];
  let lineNumber = 1;
  let totalLines = 0;
  if (bytes.length > 0) {
    let newlines = 0;
    for (let index = 0; index < bytes.length; index += 1) {
      if (bytes[index] !== 0x0a) continue;
      newlines += 1;
      const nextLine = lineNumber + 1;
      const nextStart = index + 1;
      if (nextStart < bytes.length && nextLine % LINE_INDEX_SAMPLE_EVERY === 0) {
        const frame = frameAt(ranges, nextStart);
        entries.push({
          lineNumber: nextLine,
          frameIndex: frame.index,
          uncompressedOffsetInFrame: nextStart - frame.start,
        });
      }
      lineNumber = nextLine;
    }
    totalLines = bytes[bytes.length - 1] === 0x0a ? newlines : newlines + 1;
  }
  return {
    version: 1,
    totalLines,
    totalUncompressedBytes: bytes.length,
    sampleEvery: LINE_INDEX_SAMPLE_EVERY,
    entries,
  };
}

function frameAt(
  ranges: readonly { start: number; end: number }[],
  absolute: number,
): { index: number; start: number } {
  let lo = 0;
  let hi = ranges.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const range = ranges[mid];
    if (!range) break;
    if (absolute < range.start) hi = mid - 1;
    else if (absolute >= range.end) lo = mid + 1;
    else return { index: mid, start: range.start };
  }
  const last = ranges[ranges.length - 1];
  if (!last) return { index: 0, start: 0 };
  return { index: ranges.length - 1, start: last.start };
}
