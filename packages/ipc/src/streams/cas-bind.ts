import type { CasBlobStore, CasByteRange } from "@ef-harness/db";
import { toBareSha256Hex } from "@ef-harness/shared-contracts";
import { CasBlobMissingError } from "./errors.js";
import type { ArtifactByteSource, ArtifactCatalog, ArtifactDescriptor, ByteRange } from "./ports.js";

/** Streams use `{ offset, length }`. CAS reads use an exclusive end. */
export function byteRangeToCasRange(range: ByteRange): CasByteRange {
  return { start: range.offset, end: range.offset + range.length };
}

/**
 * Pulls uncompressed bytes from the unified store.
 * `read` offsets are relative to the range passed to `open`.
 */
export class CasBlobByteSource implements ArtifactByteSource {
  private closedFlag = false;

  constructor(
    private readonly store: CasBlobStore,
    private readonly digest: string,
    private readonly baseOffset: number,
    private readonly length: number,
  ) {}

  get closed(): boolean {
    return this.closedFlag;
  }

  get handles(): number {
    return this.closedFlag ? 0 : 1;
  }

  async read(offset: number, length: number): Promise<Uint8Array> {
    if (this.closedFlag) throw new CasBlobMissingError(this.digest);
    if (offset < 0 || length < 0 || offset + length > this.length) {
      throw new CasBlobMissingError(this.digest);
    }
    const range = byteRangeToCasRange({ offset: this.baseOffset + offset, length });
    const parts: Uint8Array[] = [];
    let total = 0;
    for await (const chunk of this.store.openReadStream(this.digest, range)) {
      parts.push(chunk);
      total += chunk.byteLength;
    }
    if (total !== length) throw new CasBlobMissingError(this.digest);
    if (parts.length === 1) {
      const only = parts[0];
      if (!only) throw new CasBlobMissingError(this.digest);
      return only;
    }
    const merged = new Uint8Array(total);
    let at = 0;
    for (const part of parts) {
      merged.set(part, at);
      at += part.byteLength;
    }
    return merged;
  }

  close(): void {
    this.closedFlag = true;
  }
}

export function createCasArtifactCatalog(options: {
  readonly store: CasBlobStore;
  readonly lookup: ArtifactCatalog["lookup"];
}): ArtifactCatalog {
  const store = options.store;
  return {
    lookup: options.lookup,
    async open(descriptor: ArtifactDescriptor, range?: ByteRange): Promise<ArtifactByteSource> {
      const digest = toBareSha256Hex(descriptor.casHash ?? descriptor.sha256);
      const offset = range?.offset ?? 0;
      const length = range ? range.length : Math.max(0, descriptor.totalBytes - offset);
      return new CasBlobByteSource(store, digest, offset, length);
    },
    async verifyIntegrity(descriptor: ArtifactDescriptor): Promise<void> {
      await store.verifyBlobIntegrity(toBareSha256Hex(descriptor.casHash ?? descriptor.sha256));
    },
  };
}
