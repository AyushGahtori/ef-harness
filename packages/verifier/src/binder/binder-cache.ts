import { createHash } from "node:crypto";
import type { AcceptanceCheck, ObservationsSchema } from "./types.js";

export function entrySignatureHash(signature: string): string {
  return createHash("sha256").update(signature.trim()).digest("hex");
}

/** Hash every declared entry signature so a contract change misses the adapter cache. */
export function checkEntrySignatureHash(check: AcceptanceCheck): string {
  return entrySignatureHash(check.entries.map((entry) => entry.signature.trim()).join("\n"));
}

export interface CachedBinderAdapter {
  checkId: string;
  checkVersion: string;
  entrySignatureHash: string;
  adapterSource: string;
  entryUsed: string;
  observationsSchema: ObservationsSchema;
  baseMessage: string;
}

/**
 * Verified adapters keyed by `(checkId, checkVersion, entrySignatureHash)`.
 * A retry whose declared entry signature is unchanged does not call the model again.
 */
export class BinderAdapterCache {
  private readonly store = new Map<string, CachedBinderAdapter>();

  key(checkId: string, checkVersion: string, signatureHash: string): string {
    return `${checkId}\u0000${checkVersion}\u0000${signatureHash}`;
  }

  get(
    checkId: string,
    checkVersion: string,
    signatureHash: string,
  ): CachedBinderAdapter | undefined {
    return this.store.get(this.key(checkId, checkVersion, signatureHash));
  }

  put(adapter: CachedBinderAdapter): void {
    this.store.set(
      this.key(adapter.checkId, adapter.checkVersion, adapter.entrySignatureHash),
      adapter,
    );
  }

  get size(): number {
    return this.store.size;
  }
}
