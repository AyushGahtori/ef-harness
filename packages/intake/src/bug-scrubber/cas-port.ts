import { createHash } from "node:crypto";

export interface CasPutMeta {
  readonly holderKind: string;
  readonly holderId: string;
}

export interface CasPutResult {
  readonly hash: string;
}

/**
 * Local port of Task 028 `CasBlobStore` (`putBlob` / `getBlob`).
 * MemoryCasBlobStore is the in-process stand-in until the real store is wired.
 */
export interface CasBlobStorePort {
  putBlob(content: Uint8Array, meta: CasPutMeta): Promise<CasPutResult>;
  getBlob(hash: string): Promise<Uint8Array>;
}

export class MemoryCasBlobStore implements CasBlobStorePort {
  readonly blobs = new Map<string, Uint8Array>();
  putCount = 0;

  async putBlob(content: Uint8Array, meta: CasPutMeta): Promise<CasPutResult> {
    if (meta.holderKind.length === 0 || meta.holderId.length === 0) {
      throw new Error("CAS blob needs a holder");
    }
    const hash = createHash("sha256").update(content).digest("hex");
    this.blobs.set(hash, content);
    this.putCount += 1;
    return { hash };
  }

  async getBlob(hash: string): Promise<Uint8Array> {
    const found = this.blobs.get(hash);
    if (!found) throw new Error("CAS blob is missing");
    return found;
  }
}
