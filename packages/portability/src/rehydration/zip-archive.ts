import { crc32 } from "node:zlib";

const LOCAL_HEADER_SIGNATURE = 0x04034b50;
const CENTRAL_DIR_SIGNATURE = 0x02014b50;
const END_OF_CENTRAL_DIR_SIGNATURE = 0x06054b50;
const METHOD_STORE = 0;
const MAX_UNCOMPRESSED_BYTES = 64 * 1024 * 1024;

export interface ZipEntryInput {
  readonly path: string;
  readonly content: Uint8Array;
}

export interface ZipEntryOutput {
  readonly path: string;
  readonly content: Uint8Array;
}

function dosDateTime(date: Date): { time: number; date: number } {
  return {
    time: ((date.getHours() & 0x1f) << 11) | ((date.getMinutes() & 0x3f) << 5) | ((date.getSeconds() / 2) & 0x1f),
    date:
      (((date.getFullYear() - 1980) & 0x7f) << 9) |
      (((date.getMonth() + 1) & 0x0f) << 5) |
      (date.getDate() & 0x1f),
  };
}

export function normalizeZipPath(filePath: string): string {
  return filePath.replaceAll("\\", "/").replace(/^\/+/, "");
}

export function assertSafeZipEntryPath(filePath: string): void {
  const normalized = normalizeZipPath(filePath);
  if (normalized.includes("..")) {
    throw new Error(`zip-slip path rejected: ${filePath}`);
  }
  if (normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized)) {
    throw new Error(`absolute zip path rejected: ${filePath}`);
  }
}

export function createZipArchive(entries: readonly ZipEntryInput[]): Uint8Array {
  const now = dosDateTime(new Date());
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    assertSafeZipEntryPath(entry.path);
    const path = normalizeZipPath(entry.path);
    const pathBytes = new TextEncoder().encode(path);
    if (entry.content.byteLength > MAX_UNCOMPRESSED_BYTES) {
      throw new Error(`zip entry oversize: ${path}`);
    }
    const checksum = crc32(entry.content);

    const local = Buffer.alloc(30 + pathBytes.length + entry.content.byteLength);
    let cursor = 0;
    local.writeUInt32LE(LOCAL_HEADER_SIGNATURE, cursor);
    cursor += 4;
    local.writeUInt16LE(20, cursor);
    cursor += 2;
    local.writeUInt16LE(0, cursor);
    cursor += 2;
    local.writeUInt16LE(METHOD_STORE, cursor);
    cursor += 2;
    local.writeUInt16LE(now.time, cursor);
    cursor += 2;
    local.writeUInt16LE(now.date, cursor);
    cursor += 2;
    local.writeUInt32LE(checksum >>> 0, cursor);
    cursor += 4;
    local.writeUInt32LE(entry.content.byteLength, cursor);
    cursor += 4;
    local.writeUInt32LE(entry.content.byteLength, cursor);
    cursor += 4;
    local.writeUInt16LE(pathBytes.length, cursor);
    cursor += 2;
    local.writeUInt16LE(0, cursor);
    cursor += 2;
    local.set(pathBytes, cursor);
    cursor += pathBytes.length;
    local.set(entry.content, cursor);

    const central = Buffer.alloc(46 + pathBytes.length);
    let cCursor = 0;
    central.writeUInt32LE(CENTRAL_DIR_SIGNATURE, cCursor);
    cCursor += 4;
    central.writeUInt16LE(20, cCursor);
    cCursor += 2;
    central.writeUInt16LE(20, cCursor);
    cCursor += 2;
    central.writeUInt16LE(0, cCursor);
    cCursor += 2;
    central.writeUInt16LE(METHOD_STORE, cCursor);
    cCursor += 2;
    central.writeUInt16LE(now.time, cCursor);
    cCursor += 2;
    central.writeUInt16LE(now.date, cCursor);
    cCursor += 2;
    central.writeUInt32LE(checksum >>> 0, cCursor);
    cCursor += 4;
    central.writeUInt32LE(entry.content.byteLength, cCursor);
    cCursor += 4;
    central.writeUInt32LE(entry.content.byteLength, cCursor);
    cCursor += 4;
    central.writeUInt16LE(pathBytes.length, cCursor);
    cCursor += 2;
    central.writeUInt16LE(0, cCursor);
    cCursor += 2;
    central.writeUInt16LE(0, cCursor);
    cCursor += 2;
    central.writeUInt16LE(0, cCursor);
    cCursor += 2;
    central.writeUInt16LE(0, cCursor);
    cCursor += 2;
    central.writeUInt32LE(0, cCursor);
    cCursor += 4;
    central.writeUInt32LE(offset, cCursor);
    cCursor += 4;
    central.set(pathBytes, cCursor);

    localParts.push(local);
    centralParts.push(central);
    offset += local.byteLength;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const localData = Buffer.concat(localParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(END_OF_CENTRAL_DIR_SIGNATURE, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.byteLength, 12);
  end.writeUInt32LE(localData.byteLength, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([localData, centralDirectory, end]);
}

export function readZipArchive(zipBytes: Uint8Array): ZipEntryOutput[] {
  const view = new DataView(zipBytes.buffer, zipBytes.byteOffset, zipBytes.byteLength);
  const entries: ZipEntryOutput[] = [];
  let offset = 0;
  while (offset + 4 <= zipBytes.byteLength) {
    const signature = view.getUint32(offset, true);
    if (signature === END_OF_CENTRAL_DIR_SIGNATURE || signature === CENTRAL_DIR_SIGNATURE) break;
    if (signature !== LOCAL_HEADER_SIGNATURE) {
      throw new Error("invalid zip local header");
    }
    const method = view.getUint16(offset + 8, true);
    const compressedSize = view.getUint32(offset + 18, true);
    const fileNameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const nameStart = offset + 30;
    const nameBytes = zipBytes.subarray(nameStart, nameStart + fileNameLength);
    const filePath = new TextDecoder().decode(nameBytes);
    assertSafeZipEntryPath(filePath);
    if (method === 0) {
      const dataStart = nameStart + fileNameLength + extraLength;
      const dataEnd = dataStart + compressedSize;
      if (dataEnd > zipBytes.byteLength) throw new Error("corrupt zip entry");
      const content = zipBytes.slice(dataStart, dataEnd);
      entries.push({ path: normalizeZipPath(filePath), content });
      offset = dataEnd;
      continue;
    }
    throw new Error(`unsupported zip method ${method} (symlink or deflate not allowed in import)`);
  }
  return entries;
}