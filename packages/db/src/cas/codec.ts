import { createHash, timingSafeEqual } from "node:crypto";
import { open } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { Readable, Transform, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createZstdCompress, zstdDecompressSync } from "node:zlib";
import { decompressFrame, parseSeekable } from "../artifacts/seekable-zstd.js";
import type { CasStoredFormat, CasWriteFormat } from "./types.js";

const SEEKABLE_MAGIC = 0x8f92eab1;

export function sha256(content: Uint8Array): string {
  return createHash("sha256").update(content).digest("hex");
}

export function hashesEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  return timingSafeEqual(Buffer.from(left), Buffer.from(right));
}

export function hasSeekableFooter(stored: Uint8Array): boolean {
  if (stored.byteLength < 17) return false;
  const view = Buffer.isBuffer(stored) ? stored : Buffer.from(stored);
  return view.readUInt32LE(view.length - 4) === SEEKABLE_MAGIC;
}

export function decodeBlob(stored: Buffer, format: CasStoredFormat): Buffer {
  if (format === "raw") return Buffer.from(stored);
  if (format === "zstd-seekable" && hasSeekableFooter(stored)) {
    return Buffer.concat(parseSeekable(stored).map((frame) => decompressFrame(stored, frame)));
  }
  return Buffer.from(zstdDecompressSync(stored));
}

/** Uncompressed byte slice. `end` is exclusive. Seekable logs decode only the frames that overlap the range. */
export function slicePlainBytes(
  stored: Buffer,
  format: CasStoredFormat,
  start: number,
  end: number | undefined,
): Buffer {
  if (format === "zstd-seekable" && hasSeekableFooter(stored) && (start > 0 || end !== undefined)) {
    const frames = parseSeekable(stored);
    const chunks: Buffer[] = [];
    let offset = 0;
    const rangeEnd = end ?? Number.POSITIVE_INFINITY;
    for (const frame of frames) {
      const frameEnd = offset + frame.decompressedSize;
      if (frameEnd <= start) {
        offset = frameEnd;
        continue;
      }
      if (offset >= rangeEnd) break;
      const plain = decompressFrame(stored, frame);
      const sliceStart = Math.max(0, start - offset);
      const sliceEnd = Math.min(plain.length, rangeEnd - offset);
      if (sliceEnd > sliceStart) chunks.push(plain.subarray(sliceStart, sliceEnd));
      offset = frameEnd;
    }
    return Buffer.concat(chunks);
  }
  const plain = decodeBlob(stored, format);
  const rangeEnd = end ?? plain.length;
  return plain.subarray(start, Math.min(rangeEnd, plain.length));
}

async function writeAll(handle: FileHandle, buffer: Buffer): Promise<void> {
  let offset = 0;
  while (offset < buffer.length) {
    const { bytesWritten } = await handle.write(buffer.subarray(offset));
    if (bytesWritten <= 0) {
      throw new Error("short write while spilling a CAS temp file");
    }
    offset += bytesWritten;
  }
}

/**
 * Stream uncompressed bytes through SHA-256 and, for zstd, through the compressor,
 * then fsync the temp file. The digest is of the uncompressed bytes only.
 */
export async function writeStoredFile(tempPath: string, bytes: Uint8Array): Promise<number> {
  const buffer = Buffer.from(bytes);
  const handle = await open(tempPath, "w");
  try {
    await writeAll(handle, buffer);
    await handle.sync();
    return buffer.length;
  } finally {
    await handle.close();
  }
}

export async function spillBlob(
  content: Uint8Array,
  tempPath: string,
  format: CasWriteFormat,
): Promise<{ hash: string; storedBytes: number }> {
  if (format === "zstd-seekable") {
    throw new TypeError("zstd-seekable payloads are stored pre-framed and must not be compressed again");
  }
  const hash = createHash("sha256");
  const handle = await open(tempPath, "w");
  let storedBytes = 0;
  try {
    if (format === "raw") {
      const chunkSize = 64 * 1024;
      for (let offset = 0; offset < content.byteLength; offset += chunkSize) {
        const end = Math.min(offset + chunkSize, content.byteLength);
        const slice = Buffer.from(content.subarray(offset, end));
        hash.update(slice);
        await writeAll(handle, slice);
        storedBytes += slice.length;
      }
    } else {
      const hasher = new Transform({
        transform(chunk: unknown, _encoding, callback) {
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
          hash.update(buffer);
          callback(null, buffer);
        },
      });
      const sink = new Writable({
        write(chunk, _encoding, callback) {
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
          storedBytes += buffer.length;
          writeAll(handle, buffer).then(
            () => callback(),
            (error: unknown) => callback(error instanceof Error ? error : new Error(String(error))),
          );
        },
      });
      await pipeline(Readable.from(Buffer.from(content)), hasher, createZstdCompress(), sink);
    }
    await handle.sync();
  } finally {
    await handle.close();
  }
  return { hash: hash.digest("hex"), storedBytes };
}
