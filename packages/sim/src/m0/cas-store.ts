import { createHash } from "node:crypto";
import type { CasBlobStore } from "@ef-harness/db";

export interface CasStore {
  stage(content: string): string;
  promote(hash: string): Promise<void>;
  recover(): Promise<string[]>;
  hasBlob(hash: string): boolean;
}

const PIN = { holderKind: "project" as const, holderId: "P1", format: "raw" as const };

/**
 * Stages bytes until promote or recover, then writes them through `CasBlobStore`.
 * The staged map survives a simulated crash in this process. The store itself is
 * resolved on each call so a reopened global.db is the one that records the blob.
 */
class BoundCasStore implements CasStore {
  private readonly staged = new Map<string, Uint8Array>();

  constructor(private readonly current: () => CasBlobStore) {}

  stage(content: string): string {
    const bytes = Buffer.from(content);
    const hash = createHash("sha256").update(bytes).digest("hex");
    this.staged.set(hash, bytes);
    return hash;
  }

  async promote(hash: string): Promise<void> {
    const bytes = this.staged.get(hash);
    if (!bytes) throw new Error(`missing staged blob ${hash}`);
    const stored = await this.current().put(bytes, PIN);
    if (stored.hash !== hash) throw new Error(`staged blob hash mismatch ${hash}`);
    this.staged.delete(hash);
  }

  async recover(): Promise<string[]> {
    const promoted: string[] = [];
    for (const [hash, bytes] of this.staged) {
      const stored = await this.current().put(bytes, PIN);
      if (stored.hash !== hash) throw new Error(`staged blob hash mismatch ${hash}`);
      promoted.push(hash);
    }
    this.staged.clear();
    return promoted;
  }

  hasBlob(hash: string): boolean {
    return this.current().has(hash);
  }
}

/** Fast runs still land blobs in the unified store. */
export class MemoryCasStore extends BoundCasStore {}

/** Disk runs use the same store rooted beside global.db. */
export class DiskCasStore extends BoundCasStore {}
