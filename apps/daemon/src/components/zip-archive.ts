import { deflateRawSync, inflateRawSync } from "node:zlib";
import { open, mkdir, rm, writeFile } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import path from "node:path";
import { ArchiveIntegrityError, ChecksumMismatchError } from "./errors.js";
import { hashesEqual, sha256Hex } from "./hash.js";
import { assertSafeRelativePath, safeChildPath } from "./paths.js";

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(buffer: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) {
    const byte = buffer[i] ?? 0;
    const mixed = CRC_TABLE[(c ^ byte) & 0xff];
    c = (mixed ?? 0) ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

export interface ZipSourceEntry {
  readonly path: string;
  readonly data: Buffer;
}

interface ZipCentralEntry {
  readonly name: string;
  readonly method: number;
  readonly crc32: number;
  readonly compressedSize: number;
  readonly uncompressedSize: number;
  readonly localOffset: number;
}

export interface ExpectedZipFile {
  readonly path: string;
  readonly sha256: string;
  readonly sizeBytes: number;
}

function u16(value: number): Buffer {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16LE(value, 0);
  return buffer;
}

function u32(value: number): Buffer {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value >>> 0, 0);
  return buffer;
}

export function packZip(entries: readonly ZipSourceEntry[], method: "store" | "deflate" = "store"): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  const flags = 0x800;
  const methodCode = method === "deflate" ? 8 : 0;
  for (const entry of entries) {
    const name = Buffer.from(assertSafeRelativePath(entry.path), "utf8");
    const compressed = method === "deflate" ? deflateRawSync(entry.data) : entry.data;
    const crc = crc32(entry.data);
    const local = Buffer.concat([
      u32(0x04034b50),
      u16(20),
      u16(flags),
      u16(methodCode),
      u16(0),
      u16(0),
      u32(crc),
      u32(compressed.length),
      u32(entry.data.length),
      u16(name.length),
      u16(0),
      name,
      compressed,
    ]);
    const central = Buffer.concat([
      u32(0x02014b50),
      u16(20),
      u16(20),
      u16(flags),
      u16(methodCode),
      u16(0),
      u16(0),
      u32(crc),
      u32(compressed.length),
      u32(entry.data.length),
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
    u32(0x06054b50),
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

async function readExact(handle: FileHandle, position: number, length: number): Promise<Buffer> {
  if (length === 0) return Buffer.alloc(0);
  if (length > 0x7fffffff) throw new ArchiveIntegrityError("zip entry exceeds the in-memory extract limit");
  const buffer = Buffer.alloc(length);
  let offset = 0;
  while (offset < length) {
    const { bytesRead } = await handle.read(buffer, offset, length - offset, position + offset);
    if (bytesRead === 0) throw new ArchiveIntegrityError("unexpected end of archive");
    offset += bytesRead;
  }
  return buffer;
}

async function readCentralDirectory(handle: FileHandle, size: number): Promise<ZipCentralEntry[]> {
  const tailLen = Math.min(size, 22 + 0xffff);
  const tail = await readExact(handle, size - tailLen, tailLen);
  const signature = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
  const eocdRel = tail.lastIndexOf(signature);
  if (eocdRel < 0 || eocdRel + 22 > tail.length) {
    throw new ArchiveIntegrityError("zip end of central directory not found");
  }
  const count = tail.readUInt16LE(eocdRel + 10);
  const cdSize = tail.readUInt32LE(eocdRel + 12);
  const cdOffset = tail.readUInt32LE(eocdRel + 16);
  if (cdOffset === 0xffffffff || cdSize === 0xffffffff) {
    throw new ArchiveIntegrityError("zip64 archives are not supported");
  }
  const cd = await readExact(handle, cdOffset, cdSize);
  const entries: ZipCentralEntry[] = [];
  let cursor = 0;
  for (let index = 0; index < count; index += 1) {
    if (cursor + 46 > cd.length || cd.readUInt32LE(cursor) !== 0x02014b50) {
      throw new ArchiveIntegrityError("central directory entry is truncated");
    }
    const method = cd.readUInt16LE(cursor + 10);
    const crc = cd.readUInt32LE(cursor + 16);
    const compressedSize = cd.readUInt32LE(cursor + 20);
    const uncompressedSize = cd.readUInt32LE(cursor + 24);
    const nameLen = cd.readUInt16LE(cursor + 28);
    const extraLen = cd.readUInt16LE(cursor + 30);
    const commentLen = cd.readUInt16LE(cursor + 32);
    const localOffset = cd.readUInt32LE(cursor + 42);
    const nameStart = cursor + 46;
    const nameEnd = nameStart + nameLen;
    if (nameEnd > cd.length) throw new ArchiveIntegrityError("central directory name is truncated");
    const name = cd.subarray(nameStart, nameEnd).toString("utf8").replaceAll("\\", "/");
    entries.push({
      name,
      method,
      crc32: crc,
      compressedSize,
      uncompressedSize,
      localOffset,
    });
    cursor = nameEnd + extraLen + commentLen;
  }
  return entries;
}

export async function extractZip(
  archivePath: string,
  destinationDir: string,
  expected: readonly ExpectedZipFile[],
): Promise<void> {
  const handle = await open(archivePath, "r");
  try {
    const stat = await handle.stat();
    const entries = await readCentralDirectory(handle, stat.size);
    const byName = new Map(entries.map((entry) => [entry.name, entry]));
    for (const file of expected) {
      const safeName = assertSafeRelativePath(file.path);
      const entry = byName.get(safeName);
      if (entry === undefined) throw new ChecksumMismatchError(safeName);
      if (entry.uncompressedSize !== file.sizeBytes) throw new ChecksumMismatchError(safeName);
      if (entry.method !== 0 && entry.method !== 8) {
        throw new ArchiveIntegrityError(`unsupported zip method ${entry.method}`);
      }
      const local = await readExact(handle, entry.localOffset, 30);
      if (local.readUInt32LE(0) !== 0x04034b50) throw new ArchiveIntegrityError("local file header is missing");
      const nameLen = local.readUInt16LE(26);
      const extraLen = local.readUInt16LE(28);
      const dataOffset = entry.localOffset + 30 + nameLen + extraLen;
      const compressed = await readExact(handle, dataOffset, entry.compressedSize);
      const data = entry.method === 8 ? inflateRawSync(compressed) : compressed;
      if (data.length !== file.sizeBytes || crc32(data) !== entry.crc32) {
        throw new ArchiveIntegrityError(safeName);
      }
      if (!hashesEqual(sha256Hex(data), file.sha256)) throw new ChecksumMismatchError(safeName);
      const dest = safeChildPath(destinationDir, safeName);
      await mkdir(path.dirname(dest), { recursive: true });
      await writeFile(dest, data);
    }
  } finally {
    await handle.close();
  }
}

export async function removeTree(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
}
