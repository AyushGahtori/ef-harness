import type { CasBlobStore as DbCasBlobStore } from "@ef-harness/db";
import type { CasBlobStorePort, CasPutMeta, CasPutResult } from "./cas-port.js";

/**
 * Async view of `@ef-harness/db` `CasBlobStore` for scrubbed symptom payloads.
 * Caller holder kinds such as `symptom-card` are not a CAS holder class, so the
 * pin is recorded as `project`.
 */
export class DbSymptomCas implements CasBlobStorePort {
  constructor(
    private readonly store: DbCasBlobStore,
    private readonly holderId: string,
  ) {}

  async putBlob(content: Uint8Array, meta: CasPutMeta): Promise<CasPutResult> {
    const holderId = meta.holderId.length > 0 ? meta.holderId : this.holderId;
    const written = await this.store.putBlob(content, {
      holderKind: "project",
      holderId,
      format: "zstd",
    });
    return { hash: written.hash };
  }

  async getBlob(hash: string): Promise<Uint8Array> {
    const found = await this.store.getBytes(hash);
    if (!found) throw new Error("CAS blob is missing");
    return found;
  }
}
