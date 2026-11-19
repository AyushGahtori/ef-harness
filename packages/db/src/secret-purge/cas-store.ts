import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import type { DatabaseSync } from "node:sqlite";

import { sqlText } from "./sqlite-util.js";
import type { CasBlobStore, CasHolderKind, CasPutOptions, CasWriteResult } from "./types.js";

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function casRawPath(root: string, hash: string): string {
  return path.join(root, "sha256", hash.slice(0, 2), hash.slice(2, 4), `${hash}.raw`);
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
 * Uncompressed CAS layout used when Task 028's store is not wired yet.
 * Hash is SHA-256 of the raw bytes. `forceDeletePurgedBlob` skips the grace window.
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
    const hash = sha256Hex(bytes);
    const destination = casRawPath(this.options.root, hash);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    if (!fs.existsSync(destination)) {
      const temporary = path.join(this.options.root, "tmp", `${hash}.${process.pid}.tmp`);
      fs.mkdirSync(path.dirname(temporary), { recursive: true });
      fs.writeFileSync(temporary, bytes);
      fs.renameSync(temporary, destination);
      fs.chmodSync(destination, 0o444);
    }
    this.insertBlobRow(hash, bytes.byteLength);
    this.pinBlob(hash, putOptions.holderKind, putOptions.holderId);
    return { hash, bytes: bytes.byteLength };
  }

  getBlob(hash: string): Uint8Array {
    const destination = casRawPath(this.options.root, hash);
    if (!fs.existsSync(destination)) {
      throw new Error("CAS blob is missing");
    }
    const bytes = fs.readFileSync(destination);
    if (sha256Hex(bytes) !== hash) {
      throw new Error("CAS blob integrity mismatch");
    }
    return bytes;
  }

  pinBlob(hash: string, holderKind: CasHolderKind, holderId: string): void {
    this.pins.add(pinKey(hash, holderKind, holderId));
    const globalDb = this.options.globalDb;
    if (!globalDb) return;
    globalDb
      .prepare(
        `INSERT OR IGNORE INTO cas_pins(hash, holder_kind, holder_id, pinned_at)
         VALUES (?, ?, ?, ?)`,
      )
      .run(hash, holderKind, holderId, this.now());
  }

  unpinHolder(hash: string, holderKind: CasHolderKind, holderId: string): void {
    this.pins.delete(pinKey(hash, holderKind, holderId));
    this.options.globalDb
      ?.prepare("DELETE FROM cas_pins WHERE hash = ? AND holder_kind = ? AND holder_id = ?")
      .run(hash, holderKind, holderId);
  }

  /**
   * Privileged secret-purge delete. Unlinks the file immediately and drops every pin,
   * including backup pins, so the secret bytes cannot wait out the 7-day grace window.
   */
  forceDeletePurgedBlob(hash: string): void {
    const destination = casRawPath(this.options.root, hash);
    if (fs.existsSync(destination)) unlinkRetry(destination);
    for (const key of [...this.pins]) {
      if (key.startsWith(`${hash}\0`)) this.pins.delete(key);
    }
    const globalDb = this.options.globalDb;
    if (!globalDb) return;
    globalDb.prepare("DELETE FROM cas_pins WHERE hash = ?").run(hash);
    globalDb.prepare("DELETE FROM cas_blobs WHERE hash = ?").run(hash);
  }

  listStoredHashes(): readonly string[] {
    const hashes: string[] = [];
    walkFiles(this.options.root, (filePath) => {
      if (!filePath.endsWith(".raw")) return;
      hashes.push(path.basename(filePath, ".raw"));
    });
    return hashes;
  }

  private insertBlobRow(hash: string, bytes: number): void {
    const globalDb = this.options.globalDb;
    if (!globalDb) return;
    globalDb
      .prepare(
        `INSERT INTO cas_blobs(hash, bytes, stored_bytes, format, state, created_at)
         VALUES (?, ?, ?, 'raw', 'ok', ?)
         ON CONFLICT(hash) DO NOTHING`,
      )
      .run(hash, bytes, bytes, this.now());
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }
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
