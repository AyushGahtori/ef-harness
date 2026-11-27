import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import {
  CasBlobMissingError as ArtifactBlobMissingError,
  CasIntegrityMismatchError as ArtifactIntegrityMismatchError,
  type CasBlobStore as ArtifactCasBlobStore,
  type CasHolder,
  type CasIntegrityVerdict,
  type CasPutRequest,
  type CasVerificationCandidate,
  type CasWriteResult as ArtifactCasWriteResult,
  type CompressedBlob,
} from "../artifacts/cas-port.js";
import type {
  CasBlobStore as SecretPurgeCasBlobStore,
  CasHolderKind,
  CasPutOptions,
  CasWriteResult as SecretPurgeCasWriteResult,
} from "../secret-purge/types.js";
import { decodeBlob, hashesEqual, sha256 } from "./codec.js";
import { CasBlobMissingError, CasIntegrityMismatchError } from "./errors.js";
import { normalizeCasHash } from "./layout.js";
import type { CasBlobStore } from "./store.js";

/**
 * Sync view of the canonical store for `ArtifactManager`.
 * Pre-framed `zstd-seekable` bytes are stored as-is.
 */
export function toArtifactCasPort(store: CasBlobStore): ArtifactCasBlobStore {
  return {
    putBlob(request: CasPutRequest): ArtifactCasWriteResult {
      try {
        const written = store.putPreframedSync({
          uncompressed: request.uncompressed,
          storedPayload: request.storedPayload,
          format: request.format,
          holderKind: request.holder.holderKind,
          holderId: request.holder.holderId,
        });
        return {
          hash: written.hash,
          bytes: written.bytes,
          storedBytes: written.storedBytes,
          format: written.format,
        };
      } catch (error) {
        rethrowArtifact(error, sha256(Buffer.from(request.uncompressed)));
      }
    },
    readCompressed(hash: string): CompressedBlob {
      try {
        return store.readCompressedSync(hash);
      } catch (error) {
        rethrowArtifact(error, normalizeCasHash(hash));
      }
    },
    verifyBlobIntegrity(hash: string): CasIntegrityVerdict {
      const normalized = normalizeCasHash(hash);
      let storedPayload: Uint8Array;
      let format: CompressedBlob["format"];
      try {
        const blob = store.readCompressedSync(hash);
        storedPayload = blob.storedPayload;
        format = blob.format;
      } catch (error) {
        rethrowArtifact(error, normalized);
      }
      try {
        const plain = decodeBlob(Buffer.from(storedPayload), format);
        if (!hashesEqual(sha256(plain), normalized)) {
          return { ok: false, hash: normalized, reason: "sha256 mismatch" };
        }
        return { ok: true, hash: normalized, reason: null };
      } catch (error) {
        const reason = error instanceof Error ? error.message : "decode failed";
        return { ok: false, hash: normalized, reason };
      }
    },
    pinBlob(hash: string, holder: CasHolder, pinnedAt: number): void {
      try {
        store.pinBlob(hash, holder.holderKind, holder.holderId, pinnedAt);
      } catch (error) {
        rethrowArtifact(error, normalizeCasHash(hash));
      }
    },
    unpinHolder(hash: string, holder: CasHolder): void {
      store.unpinHolder(hash, holder.holderKind, holder.holderId);
    },
    quarantineBlob(hash: string): void {
      store.quarantineBlob(hash);
    },
    markVerified(hash: string, verifiedAt: number): void {
      store.noteVerified(hash, verifiedAt);
    },
    totalPinnedStoredBytes(): number {
      return store.totalPinnedStoredBytes();
    },
    listVerificationCandidates(): readonly CasVerificationCandidate[] {
      return store.listVerificationCandidates();
    },
  };
}

/**
 * Sync view of the canonical store for `SecretPurgeEngine`.
 * Reads and unlinks both `.zst` and `.raw`. Purge drops pins immediately.
 */
export function toSecretPurgeCasPort(store: CasBlobStore): SecretPurgeCasBlobStore {
  return {
    putBlob(bytes: Uint8Array, options: CasPutOptions): SecretPurgeCasWriteResult {
      const format = options.format ?? "raw";
      const storedPayload = format === "raw" ? bytes : options.storedPayload;
      if (storedPayload === undefined) {
        throw new TypeError(`${format} CAS writes require pre-framed storedPayload`);
      }
      const written = store.putPreframedSync({
        uncompressed: bytes,
        storedPayload,
        format,
        holderKind: options.holderKind,
        holderId: options.holderId,
      });
      return { hash: written.hash, bytes: written.bytes };
    },
    getBlob(hash: string): Uint8Array {
      try {
        return store.readPlainSync(hash);
      } catch (error) {
        if (error instanceof CasBlobMissingError) throw new Error("CAS blob is missing");
        if (error instanceof CasIntegrityMismatchError) throw new Error("CAS blob integrity mismatch");
        throw error;
      }
    },
    pinBlob(hash: string, holderKind: CasHolderKind, holderId: string): void {
      store.pinBlob(hash, holderKind, holderId);
    },
    unpinHolder(hash: string, holderKind: CasHolderKind, holderId: string): void {
      store.unpinHolder(hash, holderKind, holderId);
    },
    forceDeletePurgedBlob(hash: string): void {
      store.dropAllPinsSync(hash);
      store.unlinkBlobFilesSync(hash);
    },
    listStoredHashes(): readonly string[] {
      return listCasHashes(store.rootDirectory);
    },
  };
}

function rethrowArtifact(error: unknown, hash: string): never {
  if (error instanceof CasBlobMissingError) throw new ArtifactBlobMissingError(hash);
  if (error instanceof CasIntegrityMismatchError) throw new ArtifactIntegrityMismatchError(hash, error.reason);
  throw error;
}

function listCasHashes(root: string): readonly string[] {
  const hashes = new Set<string>();
  walk(root, hashes);
  return [...hashes];
}

function walk(directory: string, hashes: Set<string>): void {
  if (!existsSync(directory)) return;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      walk(full, hashes);
      continue;
    }
    if (!entry.isFile()) continue;
    const match = /^([0-9a-f]{64})\.(?:zst|raw)$/.exec(entry.name);
    const hash = match?.[1];
    if (hash) hashes.add(hash);
  }
}
