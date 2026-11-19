import { randomUUID } from "node:crypto";
import { setImmediate as yieldToIo } from "node:timers/promises";
import {
  mkdir,
  open,
  readdir,
  readFile,
  rename as fsRename,
  rm,
  stat,
  unlink as fsUnlink,
} from "node:fs/promises";
import type { DatabaseSync, SQLOutputValue } from "node:sqlite";
import path from "node:path";
import { decodeBlob, hashesEqual, sha256, spillBlob } from "./codec.js";
import { CasBlobMissingError, CasIntegrityMismatchError } from "./errors.js";
import {
  CAS_RENAME_ATTEMPTS,
  CasTargetExistsError,
  casRenameBackoffMs,
  chmodWithRetry,
  defaultSleep,
  errorCode,
  isRetryableFsError,
  pathExists,
  renameWithRetry,
  unlinkWithRetry,
} from "./fs-retry.js";
import {
  CAS_GRACE_MS,
  CAS_TMP_MAX_AGE_MS,
  blobFilePath,
  casTempDir,
  defaultCasRoot,
  normalizeCasHash,
} from "./layout.js";
import { globalCasGcCandidatesSql } from "./named-query.js";
import type {
  CasBlobStoreOptions,
  CasCorruptionEvent,
  CasDependentReceiptMark,
  CasGcResult,
  CasHolderKind,
  CasIntegrityVerification,
  CasPinSyncResult,
  CasPutPin,
  CasRetention,
  CasScrubRecoveryAlert,
  CasStoredFormat,
  CasStoreEvent,
  CasWriteFormat,
  CasWriteResult,
} from "./types.js";

const HOLDER_KINDS = new Set<CasHolderKind>(["project", "backup", "research", "export", "pending"]);
const RETENTIONS = new Set<CasRetention>(["evidence", "diagnostic", "ephemeral", "asset"]);
const WRITE_FORMATS = new Set<CasWriteFormat>(["zstd", "raw"]);

interface BlobRow {
  readonly bytes: number;
  readonly storedBytes: number;
  readonly format: CasStoredFormat;
  readonly state: "ok" | "quarantined";
  readonly createdAt: number;
}

interface MarkedCorruption {
  readonly affectedArtifactIds: readonly string[];
  readonly dependentReceipts: readonly CasDependentReceiptMark[];
}

function assertHolder(kind: CasHolderKind, holderId: string): void {
  if (!HOLDER_KINDS.has(kind)) {
    throw new TypeError(`unsupported CAS holder kind: ${String(kind)}`);
  }
  if (typeof holderId !== "string" || holderId.length === 0) {
    throw new TypeError("CAS holder id must be a non-empty string");
  }
}

function assertRetention(retention: CasRetention): void {
  if (!RETENTIONS.has(retention)) {
    throw new TypeError(`unsupported CAS retention class: ${String(retention)}`);
  }
}

function parseFormat(value: string): CasStoredFormat {
  if (value === "zstd" || value === "zstd-seekable" || value === "raw") return value;
  throw new Error(`unsupported CAS format: ${value}`);
}

function text(value: SQLOutputValue | undefined, label: string): string {
  if (typeof value !== "string") throw new Error(`CAS column ${label} is not text`);
  return value;
}

function integer(value: SQLOutputValue | undefined, label: string): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "bigint") return Number(value);
  throw new Error(`CAS column ${label} is not an integer`);
}

function textOrNull(value: SQLOutputValue | undefined): string | null {
  if (value == null) return null;
  return typeof value === "string" ? value : String(value);
}

function changesOf(changes: number | bigint): number {
  return typeof changes === "bigint" ? Number(changes) : changes;
}

function isMissingTable(error: unknown): boolean {
  return error instanceof Error && /no such table/i.test(error.message);
}

function likePrefix(value: string): string {
  return `${value.replace(/[\\%_]/g, (character) => `\\${character}`)}:%`;
}

function withImmediate<T>(db: DatabaseSync, body: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const value = body();
    db.exec("COMMIT");
    return value;
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch (rollbackError) {
      throw new Error("CAS database rollback failed", { cause: rollbackError });
    }
    throw error;
  }
}

async function fsyncDirectory(directory: string): Promise<void> {
  try {
    const handle = await open(directory, "r");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch (error) {
    const code = errorCode(error);
    if (
      code === "EPERM" ||
      code === "EACCES" ||
      code === "EINVAL" ||
      code === "ENOTSUP" ||
      code === "EISDIR" ||
      process.platform === "win32"
    ) {
      return;
    }
    throw error;
  }
}

async function removeFileIfPresent(filePath: string): Promise<void> {
  try {
    await rm(filePath, { force: true });
  } catch (error) {
    if (errorCode(error) === "ENOENT") return;
    throw error;
  }
}

/**
 * Content-addressed blob store. The hash is SHA-256 of the uncompressed payload.
 * A pin is committed in global.db before putBlob returns, so the caller can then
 * record the hash in state.db.artifacts without a window where GC sees a live blob unpinned.
 */
export class CasBlobStore {
  readonly gcCandidatesSql: string;
  private readonly globalDb: DatabaseSync;
  private readonly projectDb: DatabaseSync | undefined;
  private readonly rootDir: string;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly rename: (from: string, to: string) => Promise<void>;
  private readonly unlinkPromoted: ((filePath: string) => Promise<void>) | undefined;
  private readonly onEvent: ((event: CasStoreEvent) => void) | undefined;
  private readonly events: CasStoreEvent[] = [];

  constructor(options: CasBlobStoreOptions) {
    this.globalDb = options.globalDb;
    this.projectDb = options.projectDb;
    this.rootDir = path.resolve(options.rootDir ?? defaultCasRoot());
    this.now = options.now ?? (() => Date.now());
    this.sleep = options.sleep ?? defaultSleep;
    this.rename = options.rename ?? fsRename;
    this.unlinkPromoted = options.unlinkPromoted;
    this.onEvent = options.onEvent;
    this.gcCandidatesSql = globalCasGcCandidatesSql(options.queriesSqlPath);
  }

  static async open(options: CasBlobStoreOptions): Promise<CasBlobStore> {
    const store = new CasBlobStore(options);
    await store.sweepOrphanTempFiles();
    return store;
  }

  recentEvents(): readonly CasStoreEvent[] {
    return this.events;
  }

  async putBlob(content: Uint8Array, pin: CasPutPin): Promise<CasWriteResult> {
    if (!(content instanceof Uint8Array)) {
      throw new TypeError("CAS content must be a Uint8Array");
    }
    assertHolder(pin.holderKind, pin.holderId);
    const format: CasWriteFormat = pin.format ?? "zstd";
    if (!WRITE_FORMATS.has(format)) {
      throw new TypeError(`unsupported CAS write format: ${String(pin.format)}`);
    }
    const bytes = Buffer.from(content);
    await mkdir(casTempDir(this.rootDir), { recursive: true });
    const tempPath = path.join(casTempDir(this.rootDir), `${randomUUID()}.tmp`);
    let tempConsumed = false;
    try {
      const spilled = await spillBlob(bytes, tempPath, format);
      const placed = await this.placeSpilledBlob(spilled.hash, format, tempPath);
      tempConsumed = true;
      const storedBytes = placed.deduplicated
        ? (await stat(placed.absolutePath)).size
        : spilled.storedBytes;
      const recordedAt = this.now();
      this.recordBlobAndPin({
        hash: spilled.hash,
        bytes: bytes.byteLength,
        storedBytes,
        format: placed.format,
        now: recordedAt,
        holderKind: pin.holderKind,
        holderId: pin.holderId,
        replaceStored: !placed.deduplicated,
      });
      if (placed.replacedCorrupt) {
        this.emit(this.scrubAlert(spilled.hash, recordedAt));
      }
      return {
        hash: spilled.hash,
        bytes: bytes.byteLength,
        storedBytes,
        format: placed.format,
        absolutePath: placed.absolutePath,
        deduplicated: placed.deduplicated,
        replacedCorrupt: placed.replacedCorrupt,
        holderKind: pin.holderKind,
        holderId: pin.holderId,
      };
    } finally {
      if (!tempConsumed) await removeFileIfPresent(tempPath);
    }
  }

  async getBlob(hash: string, retention: CasRetention): Promise<Buffer> {
    assertRetention(retention);
    const normalized = normalizeCasHash(hash);
    const plain = await this.loadPlain(normalized, retention);
    const actual = sha256(plain);
    if (!hashesEqual(actual, normalized)) {
      await this.failIntegrity({
        hash: normalized,
        actualHash: actual,
        retention,
        reason: "uncompressed SHA-256 mismatch on read",
      });
      throw new Error("CAS integrity failure did not throw");
    }
    this.markVerified(normalized);
    return Buffer.from(plain);
  }

  async verifyBlobIntegrity(hash: string): Promise<CasIntegrityVerification> {
    const normalized = normalizeCasHash(hash);
    const plain = await this.loadPlain(normalized, null);
    const actual = sha256(plain);
    const verifiedAt = this.now();
    if (!hashesEqual(actual, normalized)) {
      await this.failIntegrity({
        hash: normalized,
        actualHash: actual,
        retention: null,
        reason: "uncompressed SHA-256 mismatch during integrity verification",
      });
      throw new Error("CAS integrity failure did not throw");
    }
    this.markVerified(normalized, verifiedAt);
    return { hash: normalized, bytes: plain.byteLength, verifiedAt };
  }

  pinBlob(hash: string, holderKind: CasHolderKind, holderId: string, pinnedAt?: number): void {
    const normalized = normalizeCasHash(hash);
    assertHolder(holderKind, holderId);
    const when = pinnedAt ?? this.now();
    withImmediate(this.globalDb, () => {
      const row = this.readBlobRow(normalized);
      if (!row) throw new CasBlobMissingError(normalized);
      this.globalDb
        .prepare(
          `INSERT INTO cas_pins(hash, holder_kind, holder_id, pinned_at)
           VALUES (:hash, :holder_kind, :holder_id, :pinned_at)
           ON CONFLICT(hash, holder_kind, holder_id) DO NOTHING`,
        )
        .run({ hash: normalized, holder_kind: holderKind, holder_id: holderId, pinned_at: when });
    });
  }

  unpinHolder(hash: string, holderKind: CasHolderKind, holderId: string): boolean {
    const normalized = normalizeCasHash(hash);
    assertHolder(holderKind, holderId);
    const result = this.globalDb
      .prepare(
        `DELETE FROM cas_pins
          WHERE hash = :hash AND holder_kind = :holder_kind AND holder_id = :holder_id`,
      )
      .run({ hash: normalized, holder_kind: holderKind, holder_id: holderId });
    return changesOf(result.changes) > 0;
  }

  /**
   * Replace this project's pin set with the hashes still present in state.db.artifacts.
   * Pending pins for the project are removed once the artifact row exists, and crash
   * orphans older than an hour are removed. Younger pending pins stay, so an in-flight
   * putBlob is not unpinned. This never deletes blob bytes.
   */
  syncProjectPins(projectId: string): CasPinSyncResult {
    if (typeof projectId !== "string" || projectId.length === 0) {
      throw new TypeError("projectId must be a non-empty string");
    }
    if (!this.projectDb) {
      throw new Error("ProjectStateDb is required to sync project pins");
    }
    const projectDb = this.projectDb;
    const liveRows = projectDb.prepare("SELECT DISTINCT hash FROM artifacts").all();
    const live = new Set<string>();
    for (const row of liveRows) {
      live.add(normalizeCasHash(text(row.hash, "artifacts.hash")));
    }
    const when = this.now();
    const staleBefore = when - CAS_TMP_MAX_AGE_MS;
    return withImmediate(this.globalDb, () => {
      let projectPinsAdded = 0;
      let projectPinsRemoved = 0;
      let pendingPinsCleared = 0;
      const insertPin = this.globalDb.prepare(
        `INSERT INTO cas_pins(hash, holder_kind, holder_id, pinned_at)
         VALUES (:hash, 'project', :holder_id, :pinned_at)
         ON CONFLICT(hash, holder_kind, holder_id) DO NOTHING`,
      );
      for (const hash of live) {
        projectPinsAdded += changesOf(
          insertPin.run({ hash, holder_id: projectId, pinned_at: when }).changes,
        );
      }
      const projectPins = this.globalDb
        .prepare(
          `SELECT hash FROM cas_pins WHERE holder_kind = 'project' AND holder_id = :holder_id`,
        )
        .all({ holder_id: projectId });
      const deleteProjectPin = this.globalDb.prepare(
        `DELETE FROM cas_pins
          WHERE hash = :hash AND holder_kind = 'project' AND holder_id = :holder_id`,
      );
      for (const pin of projectPins) {
        const hash = text(pin.hash, "cas_pins.hash");
        if (live.has(hash)) continue;
        projectPinsRemoved += changesOf(deleteProjectPin.run({ hash, holder_id: projectId }).changes);
      }
      const pending = this.globalDb
        .prepare(
          `SELECT hash, holder_id, pinned_at FROM cas_pins
            WHERE holder_kind = 'pending'
              AND (holder_id = :project_id OR holder_id LIKE :prefix ESCAPE '\\')`,
        )
        .all({ project_id: projectId, prefix: likePrefix(projectId) });
      const deletePending = this.globalDb.prepare(
        `DELETE FROM cas_pins
          WHERE hash = :hash AND holder_kind = 'pending' AND holder_id = :holder_id`,
      );
      for (const pin of pending) {
        const hash = text(pin.hash, "cas_pins.hash");
        const holderId = text(pin.holder_id, "cas_pins.holder_id");
        const pinnedAt = integer(pin.pinned_at, "cas_pins.pinned_at");
        if (!live.has(hash) && pinnedAt >= staleBefore) continue;
        pendingPinsCleared += changesOf(
          deletePending.run({ hash, holder_id: holderId }).changes,
        );
      }
      return { projectPinsAdded, projectPinsRemoved, pendingPinsCleared };
    });
  }

  async runGarbageCollection(options?: { readonly now?: number }): Promise<CasGcResult> {
    const now = options?.now ?? this.now();
    const tempFilesRemoved = await this.sweepOrphanTempFiles(now);
    const cutoff = now - CAS_GRACE_MS;
    const candidates = this.globalDb.prepare(this.gcCandidatesSql).all({ grace_cutoff: cutoff });
    const deleted: string[] = [];
    let skippedPinned = 0;
    for (const candidate of candidates) {
      const hash = normalizeCasHash(text(candidate.hash, "cas_blobs.hash"));
      const removed = await this.deleteUnpinnedBlob(hash, cutoff);
      if (removed) deleted.push(hash);
      else skippedPinned += 1;
    }
    return { scanned: candidates.length, deleted, skippedPinned, tempFilesRemoved };
  }

  quarantineBlob(
    hash: string,
    details?: {
      readonly actualHash?: string;
      readonly retention?: CasRetention | null;
      readonly reason?: string;
    },
  ): CasCorruptionEvent {
    const normalized = normalizeCasHash(hash);
    const row = this.readBlobRow(normalized);
    if (!row) throw new CasBlobMissingError(normalized);
    const retention = details?.retention ?? null;
    if (retention !== null) assertRetention(retention);
    const marked = this.markQuarantined(normalized);
    const event: CasCorruptionEvent = {
      kind: "cas.corruption",
      hash: normalized,
      actualHash: details?.actualHash ?? "unknown",
      retention,
      reason: details?.reason ?? "blob quarantined",
      at: this.now(),
      affectedArtifactIds: marked.affectedArtifactIds,
      dependentReceipts: marked.dependentReceipts,
    };
    this.emit(event);
    return event;
  }

  /**
   * Task 030 only. Unlinks a secret-bearing blob immediately, ignoring the 7-day grace.
   * Refuses while any pin remains; the caller replaces references and clears pins first.
   */
  async forceDeletePurgedBlob(
    hash: string,
    authorization: { readonly caller: "task-030-secret-purge" },
  ): Promise<void> {
    const normalized = normalizeCasHash(hash);
    if (authorization.caller !== "task-030-secret-purge") {
      throw new Error("forceDeletePurgedBlob is reserved for Task 030 secret purge");
    }
    const pinCount = this.globalDb
      .prepare("SELECT count(*) AS n FROM cas_pins WHERE hash = :hash")
      .get({ hash: normalized });
    if (integer(pinCount?.n, "pin count") > 0) {
      throw new Error(
        `forceDeletePurgedBlob refused for ${normalized}: pins remain; replace references and pins first`,
      );
    }
    const row = this.readBlobRow(normalized);
    if (row) {
      await this.removePromotedBlob(blobFilePath(this.rootDir, normalized, row.format));
    } else {
      await this.removePromotedBlob(blobFilePath(this.rootDir, normalized, "zstd"));
      await this.removePromotedBlob(blobFilePath(this.rootDir, normalized, "raw"));
    }
    this.globalDb.prepare("DELETE FROM cas_blobs WHERE hash = :hash").run({ hash: normalized });
  }

  /** Deletes files in cas/tmp older than one hour. Never reads or deletes cas/sha256. */
  async sweepOrphanTempFiles(now = this.now()): Promise<number> {
    const directory = casTempDir(this.rootDir);
    let names: string[];
    try {
      names = await readdir(directory);
    } catch (error) {
      if (errorCode(error) === "ENOENT") return 0;
      throw error;
    }
    let removed = 0;
    for (const name of names) {
      const full = path.join(directory, name);
      let mtimeMs: number;
      try {
        const info = await stat(full);
        if (!info.isFile()) continue;
        mtimeMs = info.mtimeMs;
      } catch (error) {
        if (errorCode(error) === "ENOENT") continue;
        throw error;
      }
      if (now - mtimeMs <= CAS_TMP_MAX_AGE_MS) continue;
      try {
        await chmodWithRetry(full, 0o666, this.sleep);
        await fsUnlink(full);
        removed += 1;
      } catch (error) {
        if (errorCode(error) === "ENOENT") removed += 1;
      }
    }
    return removed;
  }

  private async placeSpilledBlob(
    hash: string,
    requestedFormat: CasWriteFormat,
    tempPath: string,
  ): Promise<{
    absolutePath: string;
    format: CasStoredFormat;
    deduplicated: boolean;
    replacedCorrupt: boolean;
  }> {
    const row = this.readBlobRow(hash);
    const existingFormat = row?.format ?? requestedFormat;
    const existingPath = blobFilePath(this.rootDir, hash, existingFormat);
    const requestedPath = blobFilePath(this.rootDir, hash, requestedFormat);
    if ((await pathExists(existingPath)) && (await this.inspectFile(existingPath, existingFormat, hash)) === "match") {
      await removeFileIfPresent(tempPath);
      await chmodWithRetry(existingPath, 0o444, this.sleep);
      return {
        absolutePath: existingPath,
        format: existingFormat,
        deduplicated: true,
        replacedCorrupt: false,
      };
    }
    if ((await pathExists(existingPath)) && (await this.inspectFile(existingPath, existingFormat, hash)) === "mismatch") {
      await this.installVerifiedTemp(existingPath, tempPath, requestedPath, hash, requestedFormat);
      return {
        absolutePath: requestedPath,
        format: requestedFormat,
        deduplicated: false,
        replacedCorrupt: true,
      };
    }
    const promoted = await this.promoteNewFile(tempPath, requestedPath);
    if (promoted === "promoted") {
      return {
        absolutePath: requestedPath,
        format: requestedFormat,
        deduplicated: false,
        replacedCorrupt: false,
      };
    }
    if ((await this.inspectFile(requestedPath, requestedFormat, hash)) === "match") {
      await removeFileIfPresent(tempPath);
      await chmodWithRetry(requestedPath, 0o444, this.sleep);
      return {
        absolutePath: requestedPath,
        format: requestedFormat,
        deduplicated: true,
        replacedCorrupt: false,
      };
    }
    await this.installVerifiedTemp(requestedPath, tempPath, requestedPath, hash, requestedFormat);
    return {
      absolutePath: requestedPath,
      format: requestedFormat,
      deduplicated: false,
      replacedCorrupt: true,
    };
  }

  private async promoteNewFile(tempPath: string, finalPath: string): Promise<"promoted" | "exists"> {
    await mkdir(path.dirname(finalPath), { recursive: true });
    await mkdir(casTempDir(this.rootDir), { recursive: true });
    const lockPath = path.join(casTempDir(this.rootDir), `${path.basename(finalPath)}.publish.lock`);
    const owned = await this.acquirePublishLock(lockPath, finalPath);
    if (owned === "exists") return "exists";
    try {
      if (await pathExists(finalPath)) return "exists";
      try {
        await renameWithRetry(tempPath, finalPath, this.rename, this.sleep);
      } catch (error) {
        if (error instanceof CasTargetExistsError || (await pathExists(finalPath))) return "exists";
        throw error;
      }
      await chmodWithRetry(finalPath, 0o444, this.sleep);
      await fsyncDirectory(path.dirname(finalPath));
      return "promoted";
    } finally {
      await removeFileIfPresent(lockPath);
    }
  }

  /**
   * Node's rename on Windows replaces an existing file, so two publishers can both
   * believe they won. An exclusive lock file makes one rename the publisher; the
   * other sees the finished blob and verifies it.
   */
  private async acquirePublishLock(
    lockPath: string,
    finalPath: string,
  ): Promise<"owned" | "exists"> {
    for (let attempt = 1; attempt <= CAS_RENAME_ATTEMPTS; attempt += 1) {
      if (await pathExists(finalPath)) return "exists";
      try {
        const handle = await open(lockPath, "wx");
        await handle.close();
        return "owned";
      } catch (error) {
        if (errorCode(error) === "EEXIST") {
          if (await pathExists(finalPath)) return "exists";
          const info = await stat(lockPath).catch((statError: unknown) => {
            if (errorCode(statError) === "ENOENT") return undefined;
            throw statError;
          });
          if (info && this.now() - info.mtimeMs > CAS_TMP_MAX_AGE_MS) {
            await fsUnlink(lockPath).catch((unlinkError: unknown) => {
              if (errorCode(unlinkError) !== "ENOENT") throw unlinkError;
            });
            continue;
          }
          if (attempt === CAS_RENAME_ATTEMPTS) {
            throw new Error(`CAS publish lock held for ${finalPath}`);
          }
          await this.sleep(casRenameBackoffMs(attempt));
          await yieldToIo();
          continue;
        }
        if (!isRetryableFsError(error) || attempt === CAS_RENAME_ATTEMPTS) throw error;
        await this.sleep(casRenameBackoffMs(attempt));
        await yieldToIo();
      }
    }
    throw new Error(`CAS publish lock not acquired for ${finalPath}`);
  }

  private async installVerifiedTemp(
    currentPath: string,
    tempPath: string,
    finalPath: string,
    hash: string,
    finalFormat: CasStoredFormat,
  ): Promise<void> {
    if (currentPath !== finalPath) {
      if (!(await pathExists(finalPath))) {
        const promoted = await this.promoteNewFile(tempPath, finalPath);
        if (promoted === "promoted") {
          await this.removePromotedBlob(currentPath);
          return;
        }
      }
      if ((await this.inspectFile(finalPath, finalFormat, hash)) === "match") {
        await removeFileIfPresent(tempPath);
      } else {
        await this.replaceSamePath(finalPath, tempPath);
      }
      await this.removePromotedBlob(currentPath);
      return;
    }
    await this.replaceSamePath(currentPath, tempPath);
  }

  private async replaceSamePath(filePath: string, tempPath: string): Promise<void> {
    await mkdir(path.dirname(filePath), { recursive: true });
    const aside = `${filePath}.corrupt-${randomUUID()}`;
    await chmodWithRetry(filePath, 0o666, this.sleep);
    await renameWithRetry(filePath, aside, this.rename, this.sleep);
    try {
      await renameWithRetry(tempPath, filePath, this.rename, this.sleep);
      await chmodWithRetry(filePath, 0o444, this.sleep);
      await fsyncDirectory(path.dirname(filePath));
    } catch (error) {
      if ((await pathExists(aside)) && !(await pathExists(filePath))) {
        await renameWithRetry(aside, filePath, this.rename, this.sleep);
        await chmodWithRetry(filePath, 0o444, this.sleep);
      }
      throw error;
    }
    await this.removePromotedBlob(aside);
  }

  private async inspectFile(
    filePath: string,
    format: CasStoredFormat,
    expectedHash: string,
  ): Promise<"match" | "mismatch" | "absent"> {
    try {
      const stored = await readFile(filePath);
      const plain = decodeBlob(stored, format);
      return hashesEqual(sha256(plain), expectedHash) ? "match" : "mismatch";
    } catch (error) {
      if (errorCode(error) === "ENOENT") return "absent";
      if (isRetryableFsError(error)) throw error;
      return "mismatch";
    }
  }

  private recordBlobAndPin(input: {
    hash: string;
    bytes: number;
    storedBytes: number;
    format: CasStoredFormat;
    now: number;
    holderKind: CasHolderKind;
    holderId: string;
    replaceStored: boolean;
  }): void {
    withImmediate(this.globalDb, () => {
      if (input.replaceStored) {
        this.globalDb
          .prepare(
            `INSERT INTO cas_blobs(hash, bytes, stored_bytes, format, state, created_at, last_verified_at)
             VALUES (:hash, :bytes, :stored_bytes, :format, 'ok', :now, :now)
             ON CONFLICT(hash) DO UPDATE SET
               bytes = excluded.bytes,
               stored_bytes = excluded.stored_bytes,
               format = excluded.format,
               state = 'ok',
               last_verified_at = excluded.last_verified_at`,
          )
          .run({
            hash: input.hash,
            bytes: input.bytes,
            stored_bytes: input.storedBytes,
            format: input.format,
            now: input.now,
          });
      } else {
        this.globalDb
          .prepare(
            `INSERT INTO cas_blobs(hash, bytes, stored_bytes, format, state, created_at, last_verified_at)
             VALUES (:hash, :bytes, :stored_bytes, :format, 'ok', :now, :now)
             ON CONFLICT(hash) DO UPDATE SET
               state = 'ok',
               last_verified_at = excluded.last_verified_at`,
          )
          .run({
            hash: input.hash,
            bytes: input.bytes,
            stored_bytes: input.storedBytes,
            format: input.format,
            now: input.now,
          });
      }
      this.globalDb
        .prepare(
          `INSERT INTO cas_pins(hash, holder_kind, holder_id, pinned_at)
           VALUES (:hash, :holder_kind, :holder_id, :pinned_at)
           ON CONFLICT(hash, holder_kind, holder_id) DO NOTHING`,
        )
        .run({
          hash: input.hash,
          holder_kind: input.holderKind,
          holder_id: input.holderId,
          pinned_at: input.now,
        });
    });
  }

  private async loadPlain(hash: string, retention: CasRetention | null): Promise<Buffer> {
    const row = this.readBlobRow(hash);
    if (!row) throw new CasBlobMissingError(hash);
    const filePath = blobFilePath(this.rootDir, hash, row.format);
    let stored: Buffer;
    try {
      stored = await readFile(filePath);
    } catch (error) {
      if (errorCode(error) === "ENOENT" || errorCode(error) === "ENOTDIR") {
        throw new CasBlobMissingError(hash);
      }
      throw error;
    }
    try {
      return decodeBlob(stored, row.format);
    } catch (error) {
      await this.failIntegrity({
        hash,
        actualHash: "unreadable",
        retention,
        reason: "stored bytes could not be decoded",
        cause: error,
      });
      throw new Error("CAS integrity failure did not throw");
    }
  }

  private markVerified(hash: string, verifiedAt = this.now()): void {
    this.globalDb
      .prepare(
        `UPDATE cas_blobs SET state = 'ok', last_verified_at = :verified_at WHERE hash = :hash`,
      )
      .run({ hash, verified_at: verifiedAt });
  }

  private async failIntegrity(details: {
    hash: string;
    actualHash: string;
    retention: CasRetention | null;
    reason: string;
    cause?: unknown;
  }): Promise<never> {
    const marked = this.markQuarantined(details.hash);
    const event: CasCorruptionEvent = {
      kind: "cas.corruption",
      hash: details.hash,
      actualHash: details.actualHash,
      retention: details.retention,
      reason: details.reason,
      at: this.now(),
      affectedArtifactIds: marked.affectedArtifactIds,
      dependentReceipts: marked.dependentReceipts,
    };
    this.emit(event);
    throw new CasIntegrityMismatchError({
      hash: details.hash,
      actualHash: details.actualHash,
      retention: details.retention,
      dependentReceipts: marked.dependentReceipts,
      reason: details.reason,
      ...(details.cause === undefined ? {} : { cause: details.cause }),
    });
  }

  private markQuarantined(hash: string): MarkedCorruption {
    this.globalDb
      .prepare(`UPDATE cas_blobs SET state = 'quarantined' WHERE hash = :hash`)
      .run({ hash });
    return this.markDependentReceipts(hash);
  }

  private markDependentReceipts(hash: string): MarkedCorruption {
    const projectDb = this.projectDb;
    if (!projectDb) return { affectedArtifactIds: [], dependentReceipts: [] };
    try {
      return withImmediate(projectDb, () => {
        const artifactRows = projectDb
          .prepare("SELECT id FROM artifacts WHERE hash = :hash")
          .all({ hash });
        const affectedArtifactIds = artifactRows.map((row) => text(row.id, "artifacts.id"));
        const receiptRows = projectDb
          .prepare(
            `SELECT check_id, attempt, check_version, status, artifact_digest, receipt
               FROM check_results
              WHERE artifact_digest = :hash
                 OR artifact_digest IN (SELECT id FROM artifacts WHERE hash = :hash)`,
          )
          .all({ hash });
        const update = projectDb.prepare(
          `UPDATE check_results
              SET status = 'error', receipt = :receipt
            WHERE check_id = :check_id AND attempt = :attempt AND check_version = :check_version`,
        );
        const dependentReceipts: CasDependentReceiptMark[] = [];
        for (const row of receiptRows) {
          const mark: CasDependentReceiptMark = {
            checkId: text(row.check_id, "check_id"),
            attempt: text(row.attempt, "attempt"),
            checkVersion: integer(row.check_version, "check_version"),
            artifactDigest: text(row.artifact_digest, "artifact_digest"),
            previousStatus: text(row.status, "status"),
            previousReceipt: textOrNull(row.receipt),
          };
          update.run({
            receipt: JSON.stringify({
              casCorruption: true,
              hash,
              previousStatus: mark.previousStatus,
              previousReceipt: mark.previousReceipt,
            }),
            check_id: mark.checkId,
            attempt: mark.attempt,
            check_version: mark.checkVersion,
          });
          dependentReceipts.push(mark);
        }
        return { affectedArtifactIds, dependentReceipts };
      });
    } catch (error) {
      if (isMissingTable(error)) return { affectedArtifactIds: [], dependentReceipts: [] };
      throw error;
    }
  }

  private async deleteUnpinnedBlob(hash: string, cutoff: number): Promise<boolean> {
    this.globalDb.exec("BEGIN IMMEDIATE");
    try {
      const pinned = this.globalDb
        .prepare("SELECT 1 AS present FROM cas_pins WHERE hash = :hash LIMIT 1")
        .get({ hash });
      const row = this.readBlobRow(hash);
      if (pinned || !row || row.createdAt >= cutoff) {
        this.globalDb.exec("ROLLBACK");
        return false;
      }
      await this.removePromotedBlob(blobFilePath(this.rootDir, hash, row.format));
      const stillPinned = this.globalDb
        .prepare("SELECT 1 AS present FROM cas_pins WHERE hash = :hash LIMIT 1")
        .get({ hash });
      if (stillPinned) {
        this.globalDb.exec("ROLLBACK");
        return false;
      }
      this.globalDb.prepare("DELETE FROM cas_blobs WHERE hash = :hash").run({ hash });
      this.globalDb.exec("COMMIT");
      return true;
    } catch (error) {
      try {
        this.globalDb.exec("ROLLBACK");
      } catch (rollbackError) {
        throw new Error("CAS database rollback failed", { cause: rollbackError });
      }
      throw error;
    }
  }

  private async removePromotedBlob(filePath: string): Promise<void> {
    if (!(await pathExists(filePath))) return;
    try {
      await chmodWithRetry(filePath, 0o666, this.sleep);
    } catch (error) {
      if (errorCode(error) === "ENOENT") return;
      throw error;
    }
    try {
      if (this.unlinkPromoted) {
        await this.unlinkPromoted(filePath);
        return;
      }
      await unlinkWithRetry(filePath, fsUnlink, this.sleep);
    } catch (error) {
      if (errorCode(error) === "ENOENT") return;
      try {
        await chmodWithRetry(filePath, 0o444, this.sleep);
      } catch (restoreError) {
        throw new Error("CAS unlink failed and the read-only bit could not be restored", {
          cause: restoreError,
        });
      }
      throw error;
    }
  }

  private readBlobRow(hash: string): BlobRow | undefined {
    const row = this.globalDb
      .prepare(
        `SELECT bytes, stored_bytes, format, state, created_at
           FROM cas_blobs WHERE hash = :hash`,
      )
      .get({ hash });
    if (!row) return undefined;
    const state = text(row.state, "state");
    if (state !== "ok" && state !== "quarantined") {
      throw new Error(`unsupported CAS blob state: ${state}`);
    }
    return {
      bytes: integer(row.bytes, "bytes"),
      storedBytes: integer(row.stored_bytes, "stored_bytes"),
      format: parseFormat(text(row.format, "format")),
      state,
      createdAt: integer(row.created_at, "created_at"),
    };
  }

  private scrubAlert(hash: string, at: number): CasScrubRecoveryAlert {
    return {
      kind: "cas.scrub_recovery",
      hash,
      at,
      message: `Recovered corrupt CAS blob ${hash} by replacing it with a freshly verified write`,
    };
  }

  private emit(event: CasStoreEvent): void {
    this.events.push(event);
    if (this.events.length > 200) this.events.shift();
    if (!this.onEvent) return;
    try {
      this.onEvent(event);
    } catch (error) {
      const listenerFailed = error instanceof Error ? error.message : "listener failed";
      void listenerFailed;
    }
  }
}
