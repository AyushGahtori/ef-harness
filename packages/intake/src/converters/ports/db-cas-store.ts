import type { CasBlobStore as DbCasBlobStore } from "@ef-harness/db";
import { toBareSha256Hex, toPrefixedSha256 } from "@ef-harness/shared-contracts";
import { CasBlobMissingError } from "../errors.js";
import type { CanonicalHash } from "./canonical-hash.js";
import { createCanonicalHash } from "./canonical-hash.js";
import type { CasBlobStore, CasPutMeta, CasWriteResult } from "./cas-blob-store.js";

/**
 * Adapter from the intake converter port onto `@ef-harness/db` `CasBlobStore`.
 * Digests crossing the port stay `sha256:`-prefixed. The database stores bare hex.
 */
export class DbCasBlobStoreAdapter implements CasBlobStore {
  private readonly normalized = new Map<string, string>();
  private readonly hash: CanonicalHash;

  constructor(
    private readonly store: DbCasBlobStore,
    private readonly holderId: string,
    hash: CanonicalHash = createCanonicalHash(),
  ) {
    this.hash = hash;
  }

  async putBlob(bytes: Uint8Array, meta: CasPutMeta): Promise<CasWriteResult> {
    const written = await this.store.putBlob(bytes, {
      holderKind: meta.holderKind === "pending" ? "pending" : "project",
      holderId: this.holderId,
      format: "zstd",
    });
    return { hash: toPrefixedSha256(written.hash), bytesStored: written.bytes };
  }

  async getBlob(hash: string): Promise<Uint8Array> {
    const bytes = await this.store.getBytes(toBareSha256Hex(hash));
    if (!bytes) throw new CasBlobMissingError(hash);
    const actual = this.hash.sha256Prefixed(bytes);
    if (actual !== toPrefixedSha256(hash)) throw new CasBlobMissingError(hash);
    return bytes;
  }

  async readNormalized(sourceHash: string): Promise<Uint8Array | null> {
    const hash = this.normalized.get(sourceHash);
    if (!hash) return null;
    return this.getBlob(hash);
  }

  async writeNormalized(sourceHash: string, documentBytes: Uint8Array): Promise<string> {
    const written = await this.putBlob(documentBytes, { retention: "evidence", holderKind: "project" });
    this.normalized.set(sourceHash, written.hash);
    return written.hash;
  }
}
