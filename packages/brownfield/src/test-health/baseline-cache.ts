import { createHash } from "node:crypto";
import type { BaselineHealthCacheEntry, BaselineTestHealthReceipt } from "./types.js";
import type { BaselineTestHealthStorePort } from "./ports.js";

export function buildBaselineCacheKey(baselineCommitSha: string, lockfileSha256: string): string {
  return createHash("sha256").update(`${baselineCommitSha}:${lockfileSha256}`).digest("hex");
}

/**
 * Caches baseline health receipts keyed by HEAD SHA + lockfile hash.
 */
export class BaselineHealthCache {
  constructor(private readonly store: BaselineTestHealthStorePort) {}

  async get(cacheKey: string): Promise<BaselineTestHealthReceipt | null> {
    const entry = await this.store.loadCache(cacheKey);
    return entry?.receipt ?? null;
  }

  async put(cacheKey: string, receipt: BaselineTestHealthReceipt): Promise<void> {
    const entry: BaselineHealthCacheEntry = { cacheKey, receipt };
    await this.store.saveCache(entry);
    await this.store.saveReceipt(receipt);
  }
}