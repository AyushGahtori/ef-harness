import type { DatabaseSync, SQLOutputValue } from "node:sqlite";
import {
  CasBlobMissingError,
  type CasBlobState,
  type CasBlobStore,
  type CasFormat,
  type CasHolder,
  type CasIntegrityVerdict,
  type CasPutRequest,
  type CasVerificationCandidate,
  type CasWriteResult,
  type CompressedBlob,
} from "../../src/artifacts/cas-port.js";
import { verifyCompressedPayload, sha256Hex } from "../../src/artifacts/seekable-zstd.js";

interface StoredBody {
  stored: Buffer;
}

/**
 * In-process CasBlobStore for Task 029 tests.
 * Task 028 is not on this branch, so the artifact tests drive the same global.db
 * pin and blob tables the production store will own.
 */
export class SqliteCasBlobStore implements CasBlobStore {
  private readonly bodies = new Map<string, StoredBody>();

  constructor(private readonly globalDb: DatabaseSync) {}

  putBlob(request: CasPutRequest): CasWriteResult {
    const hash = sha256Hex(request.uncompressed);
    const existing = this.globalDb
      .prepare("SELECT state, bytes, stored_bytes, format FROM cas_blobs WHERE hash = ?")
      .get(hash);
    if (!existing) {
      this.bodies.set(hash, { stored: Buffer.from(request.storedPayload) });
      this.globalDb
        .prepare(
          `INSERT INTO cas_blobs(hash, bytes, stored_bytes, format, state, created_at, last_verified_at)
           VALUES (?, ?, ?, ?, 'ok', ?, NULL)`,
        )
        .run(
          hash,
          request.uncompressed.byteLength,
          request.storedPayload.byteLength,
          request.format,
          request.createdAt,
        );
    } else if (text(existing.state) === "quarantined") {
      this.bodies.set(hash, { stored: Buffer.from(request.storedPayload) });
      this.globalDb
        .prepare(
          `UPDATE cas_blobs
              SET bytes = ?, stored_bytes = ?, format = ?, state = 'ok', last_verified_at = NULL
            WHERE hash = ?`,
        )
        .run(request.uncompressed.byteLength, request.storedPayload.byteLength, request.format, hash);
    }
    this.pinBlob(hash, request.holder, request.createdAt);
    const row = this.globalDb
      .prepare("SELECT bytes, stored_bytes, format FROM cas_blobs WHERE hash = ?")
      .get(hash);
    if (!row) throw new CasBlobMissingError(hash);
    return {
      hash,
      bytes: numberValue(row.bytes),
      storedBytes: numberValue(row.stored_bytes),
      format: text(row.format) as CasFormat,
    };
  }

  readCompressed(hash: string): CompressedBlob {
    const row = this.globalDb
      .prepare("SELECT bytes, stored_bytes, format, state FROM cas_blobs WHERE hash = ?")
      .get(hash);
    const body = this.bodies.get(hash);
    if (!row || !body) throw new CasBlobMissingError(hash);
    return {
      hash,
      format: text(row.format) as CasFormat,
      storedPayload: body.stored,
      bytes: numberValue(row.bytes),
      storedBytes: numberValue(row.stored_bytes),
      state: text(row.state) as CasBlobState,
    };
  }

  verifyBlobIntegrity(hash: string): CasIntegrityVerdict {
    const blob = this.readCompressed(hash);
    const verdict = verifyCompressedPayload({
      stored: blob.storedPayload,
      format: blob.format,
      expectedHash: hash,
    });
    if (verdict.ok) return { ok: true, hash, reason: null };
    return { ok: false, hash, reason: verdict.reason };
  }

  pinBlob(hash: string, holder: CasHolder, pinnedAt: number): void {
    this.globalDb
      .prepare(
        `INSERT INTO cas_pins(hash, holder_kind, holder_id, pinned_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(hash, holder_kind, holder_id) DO UPDATE SET pinned_at = excluded.pinned_at`,
      )
      .run(hash, holder.holderKind, holder.holderId, pinnedAt);
  }

  unpinHolder(hash: string, holder: CasHolder): void {
    this.globalDb
      .prepare("DELETE FROM cas_pins WHERE hash = ? AND holder_kind = ? AND holder_id = ?")
      .run(hash, holder.holderKind, holder.holderId);
  }

  quarantineBlob(hash: string): void {
    this.globalDb.prepare("UPDATE cas_blobs SET state = 'quarantined' WHERE hash = ?").run(hash);
  }

  markVerified(hash: string, verifiedAt: number): void {
    this.globalDb
      .prepare("UPDATE cas_blobs SET last_verified_at = ? WHERE hash = ?")
      .run(verifiedAt, hash);
  }

  totalPinnedStoredBytes(): number {
    const row = this.globalDb
      .prepare(
        `SELECT COALESCE(SUM(b.stored_bytes), 0) AS n
           FROM cas_blobs b
          WHERE EXISTS (SELECT 1 FROM cas_pins p WHERE p.hash = b.hash)`,
      )
      .get();
    return row ? numberValue(row.n) : 0;
  }

  listVerificationCandidates(): readonly CasVerificationCandidate[] {
    return this.globalDb
      .prepare(
        `SELECT hash, last_verified_at, format
           FROM cas_blobs
          WHERE state = 'ok'
          ORDER BY last_verified_at IS NULL DESC, last_verified_at ASC, hash ASC`,
      )
      .all()
      .map((row) => ({
        hash: text(row.hash),
        lastVerifiedAt: row.last_verified_at === null ? null : numberValue(row.last_verified_at),
        format: text(row.format) as CasFormat,
      }));
  }

  tamper(hash: string): void {
    const body = this.bodies.get(hash);
    if (!body || body.stored.length === 0) throw new Error(`Cannot tamper missing blob ${hash}.`);
    const stored = Buffer.from(body.stored);
    const last = stored.length - 1;
    stored[last] = (stored[last] ?? 0) ^ 0xff;
    body.stored = stored;
  }
}

function text(value: SQLOutputValue | undefined): string {
  if (typeof value !== "string") throw new Error("Expected text from global.db.");
  return value;
}

function numberValue(value: SQLOutputValue | undefined): number {
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  throw new Error("Expected a number from global.db.");
}
