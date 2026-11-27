import { deflateRawSync, inflateRawSync } from "node:zlib";
import { crc32 } from "./crc32.js";
import { FileExpansionLimitError } from "./errors.js";
import { exceedsExpansion, MAX_EXPANSION_RATIO, MAX_UNCOMPRESSED_BYTES } from "./limits.js";

export interface ZipEntryInput {
  readonly name: string;
  readonly data: Uint8Array;
  readonly method?: 0 | 8;
  readonly declaredUncompressedSize?: number;
}

export interface ZipEntry {
  readonly name: string;
  readonly data: Uint8Array;
}

function u16(value: number): Buffer {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16LE(value);
  return buffer;
}

function u32(value: number): Buffer {
  const buffer = Buffer.alloc(4);
  const stored = !Number.isFinite(value) || value > 0xffffffff ? 0xffffffff : value >>> 0;
  buffer.writeUInt32LE(stored);
  return buffer;
}

export function buildZip(entries: readonly ZipEntryInput[]): Uint8Array {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const method = entry.method ?? 0;
    const compressed = method === 8 ? Buffer.from(entry.data) : Buffer.from(entry.data);
    const uncompressedSize = entry.declaredUncompressedSize ?? (method === 8 ? compressed.length : entry.data.length);
    const checksum = method === 0 ? crc32(entry.data) : 0;
    const local = Buffer.concat([
      Buffer.from([0x50, 0x4b, 0x03, 0x04]),
      u16(20),
      u16(0),
      u16(method),
      u16(0),
      u16(0),
      u32(checksum),
      u32(compressed.length),
      u32(uncompressedSize),
      u16(name.length),
      u16(0),
      name,
      compressed,
    ]);
    const central = Buffer.concat([
      Buffer.from([0x50, 0x4b, 0x01, 0x02]),
      u16(20),
      u16(20),
      u16(0),
      u16(method),
      u16(0),
      u16(0),
      u32(checksum),
      u32(compressed.length),
      u32(uncompressedSize),
      u16(name.length),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(0),
      u32(offset),
      name,
    ]);
    locals.push(local);
    centrals.push(central);
    offset += local.length;
  }
  const centralDir = Buffer.concat(centrals);
  const eocd = Buffer.concat([
    Buffer.from([0x50, 0x4b, 0x05, 0x06]),
    u16(0),
    u16(0),
    u16(entries.length),
    u16(entries.length),
    u32(centralDir.length),
    u32(offset),
    u16(0),
  ]);
  return Buffer.concat([...locals, centralDir, eocd]);
}

export function readZip(bytes: Uint8Array): ZipEntry[] {
  const buf = Buffer.from(bytes);
  const eocdSig = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
  const eocd = buf.lastIndexOf(eocdSig);
  if (eocd < 0 || eocd + 22 > buf.length) {
    throw new FileExpansionLimitError("ZIP directory is missing or truncated.");
  }
  const count = buf.readUInt16LE(eocd + 10);
  let cursor = buf.readUInt32LE(eocd + 16);
  let totalUncompressed = 0;
  const entries: ZipEntry[] = [];
  for (let index = 0; index < count; index += 1) {
    if (cursor + 46 > buf.length || buf.readUInt32LE(cursor) !== 0x02014b50) {
      throw new FileExpansionLimitError("ZIP central directory is truncated.");
    }
    const method = buf.readUInt16LE(cursor + 10);
    const compressedSize = buf.readUInt32LE(cursor + 20);
    const uncompressedSize = buf.readUInt32LE(cursor + 24);
    const nameLength = buf.readUInt16LE(cursor + 28);
    const extraLength = buf.readUInt16LE(cursor + 30);
    const commentLength = buf.readUInt16LE(cursor + 32);
    const localOffset = buf.readUInt32LE(cursor + 42);
    const name = buf.subarray(cursor + 46, cursor + 46 + nameLength).toString("utf8");
    cursor += 46 + nameLength + extraLength + commentLength;
    if (name.includes("..") || name.startsWith("/") || name.startsWith("\\")) {
      throw new FileExpansionLimitError(`ZIP entry path is rejected: ${name}`);
    }
    if (uncompressedSize === 0xffffffff || exceedsExpansion(uncompressedSize, compressedSize)) {
      throw new FileExpansionLimitError(
        `ZIP entry ${name} exceeds the ${MAX_UNCOMPRESSED_BYTES} byte or ${MAX_EXPANSION_RATIO}x cap.`,
      );
    }
    totalUncompressed += uncompressedSize;
    if (totalUncompressed > MAX_UNCOMPRESSED_BYTES) {
      throw new FileExpansionLimitError("ZIP archive exceeds the 200 MB uncompressed ceiling.");
    }
    if (localOffset + 30 > buf.length || buf.readUInt32LE(localOffset) !== 0x04034b50) {
      throw new FileExpansionLimitError("ZIP local header is missing.");
    }
    const localName = buf.readUInt16LE(localOffset + 26);
    const localExtra = buf.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localName + localExtra;
    const compressed = buf.subarray(dataStart, dataStart + compressedSize);
    const data = inflateEntry(compressed, method, uncompressedSize, compressedSize);
    entries.push({ name, data });
  }
  return entries;
}

function inflateEntry(
  compressed: Uint8Array,
  method: number,
  declaredUncompressed: number,
  compressedSize: number,
): Uint8Array {
  if (method === 0) {
    if (compressed.byteLength !== declaredUncompressed && declaredUncompressed !== 0) {
      throw new FileExpansionLimitError("Stored ZIP entry size does not match its declaration.");
    }
    return Buffer.from(compressed);
  }
  if (method !== 8) {
    throw new FileExpansionLimitError(`Unsupported ZIP method ${method}.`);
  }
  const ratioCap = compressedSize > 0 ? compressedSize * MAX_EXPANSION_RATIO : MAX_UNCOMPRESSED_BYTES;
  const declaredCap = declaredUncompressed > 0 ? declaredUncompressed : ratioCap;
  const cap = Math.min(MAX_UNCOMPRESSED_BYTES, ratioCap, declaredCap);
  try {
    return inflateRawSync(compressed, { maxOutputLength: cap });
  } catch (error) {
    if (error instanceof RangeError || (error instanceof Error && /maxOutputLength|unexpected end/i.test(error.message))) {
      throw new FileExpansionLimitError("Streaming decompressor aborted at the expansion cap.");
    }
    throw error;
  }
}

export function deflateRaw(bytes: Uint8Array): Uint8Array {
  return deflateRawSync(bytes);
}
