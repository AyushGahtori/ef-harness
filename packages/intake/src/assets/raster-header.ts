import { RasterSafetyError } from "./errors.js";
import { MAX_ANIMATION_FRAMES, MAX_RASTER_BYTES, MAX_RASTER_PIXELS } from "./limits.js";

export type RasterFormat = "png" | "jpeg" | "gif" | "webp" | "avif" | "unknown";

export interface RasterHeader {
  readonly format: RasterFormat;
  readonly width: number;
  readonly height: number;
  readonly frames: number;
}

export function readRasterHeader(bytes: Uint8Array): RasterHeader {
  if (isPng(bytes)) return readPng(bytes);
  if (isJpeg(bytes)) return readJpeg(bytes);
  if (isGif(bytes)) return readGif(bytes);
  if (isWebp(bytes)) return readWebp(bytes);
  if (isAvif(bytes)) return readAvif(bytes);
  return { format: "unknown", width: 0, height: 0, frames: 1 };
}

/**
 * Rejects oversized uploads and animated containers before sharp allocates a frame buffer.
 * A single-frame pixel bomb is left for `sharp({ limitInputPixels })` so that guard is the one that fires.
 */
export function assertPreSharpBudget(bytes: Uint8Array, header: RasterHeader): void {
  if (bytes.byteLength > MAX_RASTER_BYTES) {
    throw new RasterSafetyError(
      "byte-limit",
      `Raster input is ${bytes.byteLength} bytes, above the ${MAX_RASTER_BYTES} byte cap`,
    );
  }
  if (header.frames > MAX_ANIMATION_FRAMES) {
    throw new RasterSafetyError(
      "frame-limit",
      `Rejected ${header.frames} animated frames before sharp allocated a buffer. The frame cap is ${MAX_ANIMATION_FRAMES}.`,
    );
  }
  if (header.frames > 1 && header.width > 0 && header.height > 0) {
    const total = header.width * header.height * header.frames;
    if (total > MAX_RASTER_PIXELS) {
      throw new RasterSafetyError(
        "frame-limit",
        `Rejected ${header.frames} frames of ${header.width}x${header.height} (${total} pixels) before sharp allocated a buffer. The cap is ${MAX_RASTER_PIXELS} pixels.`,
      );
    }
  }
}

function isPng(bytes: Uint8Array): boolean {
  return bytes.length >= 8
    && bytes[0] === 0x89
    && bytes[1] === 0x50
    && bytes[2] === 0x4e
    && bytes[3] === 0x47;
}

function isJpeg(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8;
}

function isGif(bytes: Uint8Array): boolean {
  return bytes.length >= 6 && Buffer.from(bytes.subarray(0, 6)).toString("latin1") === "GIF89a"
    || Buffer.from(bytes.subarray(0, Math.min(6, bytes.length))).toString("latin1") === "GIF87a";
}

function isWebp(bytes: Uint8Array): boolean {
  return bytes.length >= 12
    && Buffer.from(bytes.subarray(0, 4)).toString("latin1") === "RIFF"
    && Buffer.from(bytes.subarray(8, 12)).toString("latin1") === "WEBP";
}

function isAvif(bytes: Uint8Array): boolean {
  if (bytes.length < 12) return false;
  const brand = Buffer.from(bytes.subarray(4, 12)).toString("latin1");
  return brand.startsWith("ftypavif") || brand.startsWith("ftypavis") || brand.includes("avif");
}

function readPng(bytes: Uint8Array): RasterHeader {
  if (bytes.length < 24) return { format: "png", width: 0, height: 0, frames: 1 };
  const width = readU32(bytes, 16);
  const height = readU32(bytes, 20);
  let frames = 1;
  let offset = 8;
  while (offset + 8 <= bytes.length) {
    const length = readU32(bytes, offset);
    const type = Buffer.from(bytes.subarray(offset + 4, offset + 8)).toString("latin1");
    if (type === "acTL" && offset + 12 <= bytes.length) {
      frames = Math.max(1, readU32(bytes, offset + 8));
    }
    if (type === "IEND") break;
    offset += 12 + length;
  }
  return { format: "png", width, height, frames };
}

function readJpeg(bytes: Uint8Array): RasterHeader {
  let offset = 2;
  while (offset + 3 < bytes.length) {
    if (bytes[offset] !== 0xff) break;
    const marker = bytes[offset + 1] ?? 0;
    if (marker === 0xd8 || marker === 0xd9) {
      offset += 2;
      continue;
    }
    if (offset + 4 > bytes.length) break;
    const length = ((bytes[offset + 2] ?? 0) << 8) | (bytes[offset + 3] ?? 0);
    const isStartOfFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isStartOfFrame && offset + 9 <= bytes.length) {
      const height = ((bytes[offset + 5] ?? 0) << 8) | (bytes[offset + 6] ?? 0);
      const width = ((bytes[offset + 7] ?? 0) << 8) | (bytes[offset + 8] ?? 0);
      return { format: "jpeg", width, height, frames: 1 };
    }
    if (length < 2) break;
    offset += 2 + length;
  }
  return { format: "jpeg", width: 0, height: 0, frames: 1 };
}

function readGif(bytes: Uint8Array): RasterHeader {
  if (bytes.length < 10) return { format: "gif", width: 0, height: 0, frames: 1 };
  const width = (bytes[6] ?? 0) | ((bytes[7] ?? 0) << 8);
  const height = (bytes[8] ?? 0) | ((bytes[9] ?? 0) << 8);
  let offset = 13;
  if ((bytes[10] ?? 0) & 0x80) {
    offset += 3 * (2 ** (((bytes[10] ?? 0) & 0x07) + 1));
  }
  let frames = 0;
  while (offset < bytes.length) {
    const marker = bytes[offset];
    if (marker === 0x3b) break;
    if (marker === 0x21) {
      offset = skipSubBlocks(bytes, offset + 2);
      continue;
    }
    if (marker === 0x2c) {
      frames += 1;
      if (offset + 10 > bytes.length) break;
      const packed = bytes[offset + 9] ?? 0;
      offset += 10;
      if (packed & 0x80) offset += 3 * (2 ** ((packed & 0x07) + 1));
      offset += 1;
      offset = skipSubBlocks(bytes, offset);
      continue;
    }
    break;
  }
  return { format: "gif", width, height, frames: Math.max(frames, 1) };
}

function readWebp(bytes: Uint8Array): RasterHeader {
  let offset = 12;
  let width = 0;
  let height = 0;
  let frames = 1;
  while (offset + 8 <= bytes.length) {
    const type = Buffer.from(bytes.subarray(offset, offset + 4)).toString("latin1");
    const size = readU32LE(bytes, offset + 4);
    if (type === "VP8X" && offset + 18 <= bytes.length) {
      width = 1 + (bytes[offset + 12] ?? 0) + ((bytes[offset + 13] ?? 0) << 8) + ((bytes[offset + 14] ?? 0) << 16);
      height = 1 + (bytes[offset + 15] ?? 0) + ((bytes[offset + 16] ?? 0) << 8) + ((bytes[offset + 17] ?? 0) << 16);
      if ((bytes[offset + 8] ?? 0) & 0x02) frames = Math.max(frames, 2);
    }
    if (type === "ANIM" && offset + 12 <= bytes.length) frames = Math.max(frames, 2);
    const padded = size + (size % 2);
    offset += 8 + padded;
  }
  return { format: "webp", width, height, frames };
}

function readAvif(bytes: Uint8Array): RasterHeader {
  const ascii = Buffer.from(bytes).toString("latin1");
  const ispe = ascii.indexOf("ispe");
  if (ispe >= 0 && ispe + 20 <= bytes.length) {
    const width = readU32(bytes, ispe + 12);
    const height = readU32(bytes, ispe + 16);
    if (width > 0 && height > 0) return { format: "avif", width, height, frames: 1 };
  }
  return { format: "avif", width: 0, height: 0, frames: 1 };
}

function skipSubBlocks(bytes: Uint8Array, offset: number): number {
  let cursor = offset;
  while (cursor < bytes.length) {
    const size = bytes[cursor] ?? 0;
    cursor += 1;
    if (size === 0) break;
    cursor += size;
  }
  return cursor;
}

function readU32(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] ?? 0) * 0x1000000)
    + ((bytes[offset + 1] ?? 0) << 16)
    + ((bytes[offset + 2] ?? 0) << 8)
    + (bytes[offset + 3] ?? 0);
}

function readU32LE(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0)
    + ((bytes[offset + 1] ?? 0) << 8)
    + ((bytes[offset + 2] ?? 0) << 16)
    + ((bytes[offset + 3] ?? 0) * 0x1000000);
}
