import { CasBlobMissingError, CasIntegrityMismatchError } from "./errors.js";
import { sha256Hex } from "./canonical-hash.js";
import {
  CAS_BLOB_STORE_SOURCE,
  type CasBlobStorePort,
  type CasHolderKind,
  type CasPutOptions,
  type CasWriteResult,
} from "./ports.js";

export type { CasWriteResult };

interface Pin {
  readonly holderKind: CasHolderKind;
  readonly holderId: string;
}

/**
 * In-process CAS. The hash is the lowercase SHA-256 of the uncompressed bytes,
 * matching Task 028's uncompressed-content key.
 */
export class MemoryCasBlobStore implements CasBlobStorePort {
  readonly source = CAS_BLOB_STORE_SOURCE;
  private readonly blobs = new Map<string, Buffer>();
  private readonly pins = new Map<string, Pin[]>();

  putBlob(bytes: Uint8Array, options: CasPutOptions): CasWriteResult {
    const hash = sha256Hex(bytes);
    const existing = this.blobs.get(hash);
    const deduplicated = existing !== undefined;
    if (!existing) {
      this.blobs.set(hash, Buffer.from(bytes));
    } else if (!existing.equals(Buffer.from(bytes))) {
      throw new CasIntegrityMismatchError(hash);
    }
    this.pinBlob(hash, options.holderKind, options.holderId);
    return { hash, bytes: bytes.byteLength, deduplicated };
  }

  getBlob(hash: string): Uint8Array {
    this.verifyBlobIntegrity(hash);
    const stored = this.blobs.get(hash);
    if (!stored) throw new CasBlobMissingError(hash);
    return Uint8Array.from(stored);
  }

  verifyBlobIntegrity(hash: string): void {
    const stored = this.blobs.get(hash);
    if (!stored) throw new CasBlobMissingError(hash);
    if (sha256Hex(stored) !== hash) throw new CasIntegrityMismatchError(hash);
  }

  pinBlob(hash: string, holderKind: CasHolderKind, holderId: string): void {
    if (!this.blobs.has(hash)) throw new CasBlobMissingError(hash);
    const current = this.pins.get(hash) ?? [];
    if (current.some((pin) => pin.holderKind === holderKind && pin.holderId === holderId)) return;
    this.pins.set(hash, [...current, { holderKind, holderId }]);
  }

  unpinHolder(hash: string, holderKind: CasHolderKind, holderId: string): void {
    const current = this.pins.get(hash) ?? [];
    this.pins.set(
      hash,
      current.filter((pin) => pin.holderKind !== holderKind || pin.holderId !== holderId),
    );
  }
}
