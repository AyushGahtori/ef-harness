import fs from "node:fs";
import path from "node:path";

import type { DatabaseSync } from "node:sqlite";

import { decodeBlob, hasSeekableFooter, sha256 } from "../cas/codec.js";
import { blobFilePath, normalizeCasHash } from "../cas/layout.js";
import { sqlText } from "./sqlite-util.js";
import type { CasBlobStore, CasHolderKind, CasPutOptions, CasWriteResult } from "./types.js";

export function sha256Hex(bytes: Uint8Array): string {
  return sha256(bytes);
}

export function casRawPath(root: string, hash: string): string {
  return blobFilePath(root, normalizeCasHash(hash), "raw");
}

function sleepSync(ms: number): void {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    // Windows antivirus can briefly hold a renamed CAS file.
  }
}

function unlinkRetry(filePath: string): void {
  let last: unknown;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      if (!fs.existsSync(filePath)) return;
      fs.chmodSync(filePath, 0o666);
      fs.unlinkSync(filePath);
      return;
    } catch (error) {
      last = error;
      sleepSync(20 * (attempt + 1));
    }
  }
  throw last instanceof Error ? last : new Error("failed to unlink CAS blob");
}

/**
 * File CAS used when the caller does not inject the canonical store.
 * Reads and deletes both `.zst` and `.raw`. Hash is SHA-256 of the uncompressed bytes.
 * `forceDeletePurgedBlob` skips the grace window.
 */
export class RawFileCasBlobStore implements CasBlobStore {
  private readonly pins = new Set<string>();

  constructor(
    private readonly options: {
      readonly root: string;
      readonly globalDb?: DatabaseSync;
      readonly now?: () => number;
    },
  ) {
    fs.mkdirSync(this.options.root, { recursive: true });
  }

  putBlob(bytes: Uint8Array, putOptions: CasPutOptions): CasWriteResult {
    const plain = Buffer.from(bytes);
    const hash = sha256(plain);
    const format = putOptions.format ?? "raw";
    const payload = framedPayload(plain, format, putOptions.storedPayload);
    const destination = blobFilePath(this.options.root, hash, format);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    if (!fs.existsSync(destination)) {
      const temporary = path.join(this.options.root, "tmp", `${hash}.${process.pid}.tmp`);
      fs.mkdirSync(path.dirname(temporary), { recursive: true });
      fs.writeFileSync(temporary, payload);
      fs.renameSync(temporary, destination);
      fs.chmodSync(destination, 0o444);
    }
    this.insertBlobRow(hash, plain.byteLength, payload.byteLength, format);
    this.pinBlob(hash, putOptions.holderKind, putOptions.holderId);
    return { hash, bytes: plain.byteLength };
  }

  getBlob(hash: string): Uint8Array {
    const normalized = normalizeCasHash(hash);
    const rawPath = blobFilePath(this.options.root, normalized, "raw");
    const zstPath = blobFilePath(this.options.root, normalized, "zstd");
    if (fs.existsSync(rawPath)) {
      const bytes = fs.readFileSync(rawPath);
      if (sha256(bytes) !== normalized) throw new Error("CAS blob integrity mismatch");
      return bytes;
    }
    if (fs.existsSync(zstPath)) {
      const stored = fs.readFileSync(zstPath);
      const format = hasSeekableFooter(stored) ? "zstd-seekable" : "zstd";
      const plain = decodeBlob(stored, format);
      if (sha256(plain) !== normalized) throw new Error("CAS blob integrity mismatch");
      return plain;
    }
    throw new Error("CAS blob is missing");
  }

  pinBlob(hash: string, holderKind: CasHolderKind, holderId: string): void {
    const normalized = normalizeCasHash(hash);
    this.pins.add(pinKey(normalized, holderKind, holderId));
    const globalDb = this.options.globalDb;
    if (!globalDb) return;
    globalDb
      .prepare(
        `INSERT OR IGNORE INTO cas_pins(hash, holder_kind, holder_id, pinned_at)
         VALUES (?, ?, ?, ?)`,
      )
      .run(normalized, holderKind, holderId, this.now());
  }

  unpinHolder(hash: string, holderKind: CasHolderKind, holderId: string): void {
    const normalized = normalizeCasHash(hash);
    this.pins.delete(pinKey(normalized, holderKind, holderId));
    this.options.globalDb
      ?.prepare("DELETE FROM cas_pins WHERE hash = ? AND holder_kind = ? AND holder_id = ?")
      .run(normalized, holderKind, holderId);
  }

  /**
   * Privileged secret-purge delete. Unlinks the file immediately and drops every pin,
   * including backup pins, so the secret bytes cannot wait out the 7-day grace window.
   */
  forceDeletePurgedBlob(hash: string): void {
    const normalized = normalizeCasHash(hash);
    for (const format of ["raw", "zstd"] as const) {
      const destination = blobFilePath(this.options.root, normalized, format);
      if (fs.existsSync(destination)) unlinkRetry(destination);
    }
    for (const key of [...this.pins]) {
      if (key.startsWith(`${normalized}\0`)) this.pins.delete(key);
    }
    const globalDb = this.options.globalDb;
    if (!globalDb) return;
    globalDb.prepare("DELETE FROM cas_pins WHERE hash = ?").run(normalized);
    globalDb.prepare("DELETE FROM cas_blobs WHERE hash = ?").run(normalized);
  }

  listStoredHashes(): readonly string[] {
    const hashes = new Set<string>();
    walkFiles(this.options.root, (filePath) => {
      const match = /^([0-9a-f]{64})\.(?:zst|raw)$/.exec(path.basename(filePath));
      const hash = match?.[1];
      if (hash) hashes.add(hash);
    });
    return [...hashes];
  }

  private insertBlobRow(hash: string, bytes: number, storedBytes: number, format: string): void {
    const globalDb = this.options.globalDb;
    if (!globalDb) return;
    globalDb
      .prepare(
        `INSERT INTO cas_blobs(hash, bytes, stored_bytes, format, state, created_at)
         VALUES (?, ?, ?, ?, 'ok', ?)
         ON CONFLICT(hash) DO NOTHING`,
      )
      .run(hash, bytes, storedBytes, format, this.now());
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }
}

function framedPayload(
  plain: Buffer,
  format: "zstd" | "zstd-seekable" | "raw",
  storedPayload: Uint8Array | undefined,
): Buffer {
  if (format === "raw") return plain;
  if (storedPayload === undefined) {
    throw new TypeError(`${format} CAS writes require pre-framed storedPayload`);
  }
  const payload = Buffer.from(storedPayload);
  const decoded = decodeBlob(payload, format);
  if (sha256(decoded) !== sha256(plain)) throw new Error("CAS blob integrity mismatch");
  return payload;
}

function pinKey(hash: string, holderKind: string, holderId: string): string {
  return `${hash}\0${holderKind}\0${holderId}`;
}

export function walkFiles(directory: string, visit: (filePath: string) => void): void {
  if (!fs.existsSync(directory)) return;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) walkFiles(full, visit);
    else if (entry.isFile()) visit(full);
  }
}

export function artifactHashes(db: DatabaseSync): string[] {
  return db
    .prepare("SELECT DISTINCT hash FROM artifacts")
    .all()
    .map((row) => sqlText(row["hash"]))
    .filter((hash) => hash.length > 0);
}

export function replaceArtifactHash(
  db: DatabaseSync,
  oldHash: string,
  newHash: string,
  bytes: number,
): number {
  const result = db
    .prepare("UPDATE artifacts SET hash = ?, bytes = ? WHERE hash = ?")
    .run(newHash, bytes, oldHash);
  return Number(result.changes);
}
