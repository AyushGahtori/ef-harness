import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { crc32 } from "node:zlib";
import { isInside, isZipNameSafe } from "./paths.js";

export const MAX_ZIP_ENTRY_BYTES = 1_000_000;

export interface ZipInputEntry {
  readonly name: string;
  readonly data: Buffer;
  readonly declaredUncompressedSize?: number;
}

export interface StoredZipEntry {
  readonly name: string;
  readonly data: Buffer;
  readonly method: number;
  readonly declaredUncompressedSize: number;
}

export function zipStore(entries: readonly ZipInputEntry[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const size = entry.data.length;
    const declared = entry.declaredUncompressedSize ?? size;
    const checksum = crc32(entry.data) >>> 0;
    const local = Buffer.alloc(30 + name.length + size);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(size, 18);
    local.writeUInt32LE(declared, 22);
    local.writeUInt16LE(name.length, 26);
    name.copy(local, 30);
    entry.data.copy(local, 30 + name.length);
    locals.push(local);

    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(size, 20);
    central.writeUInt32LE(declared, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    name.copy(central, 46);
    centrals.push(central);
    offset += local.length;
  }
  const centralBuf = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBuf, eocd]);
}

export function readZipEntries(zip: Buffer): StoredZipEntry[] {
  const entries: StoredZipEntry[] = [];
  let offset = 0;
  while (offset + 30 <= zip.length) {
    if (zip.readUInt32LE(offset) !== 0x04034b50) break;
    const method = zip.readUInt16LE(offset + 8);
    const compressedSize = zip.readUInt32LE(offset + 18);
    const declared = zip.readUInt32LE(offset + 22);
    const nameLength = zip.readUInt16LE(offset + 26);
    const extraLength = zip.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    if (compressedSize > MAX_ZIP_ENTRY_BYTES || dataStart + compressedSize > zip.length) {
      throw new Error("zip entry exceeds scan cap");
    }
    const name = zip.subarray(nameStart, nameStart + nameLength).toString("utf8");
    const data = Buffer.from(zip.subarray(dataStart, dataStart + compressedSize));
    entries.push({ name, data, method, declaredUncompressedSize: declared });
    offset = dataStart + compressedSize;
  }
  return entries;
}

export function safeExtract(
  zip: Buffer,
  dest: string,
): { readonly ok: true } | { readonly ok: false; readonly reason: "zip-bomb" | "zip-slip" } {
  const entries = readZipEntries(zip);
  for (const entry of entries) {
    if (
      entry.declaredUncompressedSize > MAX_ZIP_ENTRY_BYTES ||
      (entry.method === 0 && entry.declaredUncompressedSize !== entry.data.length)
    ) {
      return { ok: false, reason: "zip-bomb" };
    }
    if (!isZipNameSafe(entry.name)) return { ok: false, reason: "zip-slip" };
    const target = path.resolve(dest, entry.name);
    if (!isInside(dest, target)) return { ok: false, reason: "zip-slip" };
  }
  for (const entry of entries) {
    const target = path.resolve(dest, entry.name);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, entry.data);
  }
  return { ok: true };
}
