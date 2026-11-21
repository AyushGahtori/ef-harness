import { CasBlobMissingError, CasIntegrityMismatchError } from "../errors.js";
import { createCanonicalHash, type CanonicalHash } from "./canonical-hash.js";

export interface CasPutMeta {
  readonly retention: "evidence" | "asset" | "diagnostic";
  readonly holderKind: "intake" | "project" | "pending";
}

export interface CasWriteResult {
  readonly hash: string;
  readonly bytesStored: number;
}

export interface CasBlobStore {
  putBlob(bytes: Uint8Array, meta: CasPutMeta): Promise<CasWriteResult>;
  getBlob(hash: string): Promise<Uint8Array>;
  readNormalized(sourceHash: string): Promise<Uint8Array | null>;
  writeNormalized(sourceHash: string, documentBytes: Uint8Array): Promise<string>;
}

export class MemoryCasBlobStore implements CasBlobStore {
  private readonly blobs = new Map<string, Uint8Array>();
  private readonly normalized = new Map<string, string>();
  private readonly hash: CanonicalHash;

  constructor(hash: CanonicalHash = createCanonicalHash()) {
    this.hash = hash;
  }

  async putBlob(bytes: Uint8Array, meta: CasPutMeta): Promise<CasWriteResult> {
    void meta.holderKind;
    const hash = this.hash.sha256Prefixed(bytes);
    const existing = this.blobs.get(hash);
    if (!existing) {
      this.blobs.set(hash, Buffer.from(bytes));
    } else if (!equalBytes(existing, bytes)) {
      throw new CasIntegrityMismatchError(hash);
    }
    return { hash, bytesStored: bytes.byteLength };
  }

  async getBlob(hash: string): Promise<Uint8Array> {
    const found = this.blobs.get(hash);
    if (!found) throw new CasBlobMissingError(hash);
    const actual = this.hash.sha256Prefixed(found);
    if (actual !== hash) throw new CasIntegrityMismatchError(hash);
    return found;
  }

  async readNormalized(sourceHash: string): Promise<Uint8Array | null> {
    const hash = this.normalized.get(sourceHash);
    if (!hash) return null;
    return this.getBlob(hash);
  }

  async writeNormalized(sourceHash: string, documentBytes: Uint8Array): Promise<string> {
    const written = await this.putBlob(documentBytes, {
      retention: "evidence",
      holderKind: "intake",
    });
    this.normalized.set(sourceHash, written.hash);
    return written.hash;
  }
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let i = 0; i < left.byteLength; i += 1) {
    if (left[i] !== right[i]) return false;
  }
  return true;
}
