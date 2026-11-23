import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { exactInputCacheKey } from "./canonical-hash.js";
import type { CacheMode, CacheStats, ModelCallInput, ModelCallResult } from "./types.js";
import type { FakeModelAdapter } from "./types.js";

export interface ExactInputCacheOptions {
  readonly dbPath?: string;
  readonly cacheMode?: CacheMode;
}

export class ExactInputModelResponseCache {
  private readonly db: DatabaseSync;
  private hits = 0;
  private misses = 0;
  private bypassed = 0;
  private mode: CacheMode;

  constructor(options: ExactInputCacheOptions = {}) {
    this.db = new DatabaseSync(options.dbPath ?? ":memory:");
    this.mode = options.cacheMode ?? "read-write";
    this.db.exec("PRAGMA journal_mode=WAL;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS model_response_cache (
        cache_key TEXT PRIMARY KEY,
        response_json TEXT NOT NULL,
        stored_at INTEGER NOT NULL
      );
    `);
  }

  setCacheMode(mode: CacheMode): void {
    this.mode = mode;
  }

  stats(): CacheStats {
    const total = this.hits + this.misses + this.bypassed;
    const hitRatio = total === 0 ? 0 : this.hits / total;
    return {
      hits: this.hits,
      misses: this.misses,
      bypassed: this.bypassed,
      hitRatio,
    };
  }

  get(key: string): ModelCallResult | undefined {
    if (this.mode === "bypass") {
      this.bypassed += 1;
      return undefined;
    }
    const row = this.db
      .prepare("SELECT response_json FROM model_response_cache WHERE cache_key = ?")
      .get(key) as { response_json: string } | undefined;
    if (!row) {
      this.misses += 1;
      return undefined;
    }
    this.hits += 1;
    const parsed = JSON.parse(row.response_json) as ModelCallResult;
    return {
      ...parsed,
      fromCache: true,
      costUsd: 0,
      latencyMs: Math.min(parsed.latencyMs, 4),
    };
  }

  put(key: string, result: ModelCallResult): void {
    if (this.mode === "read-only" || this.mode === "bypass") {
      return;
    }
    const payload: SQLInputValue = JSON.stringify({
      ...result,
      fromCache: false,
    });
    this.db
      .prepare(
        "INSERT INTO model_response_cache (cache_key, response_json, stored_at) VALUES (?, ?, ?) ON CONFLICT(cache_key) DO UPDATE SET response_json = excluded.response_json, stored_at = excluded.stored_at",
      )
      .run(key, payload, Date.now());
  }

  async resolve(
    input: ModelCallInput,
    live: FakeModelAdapter,
  ): Promise<ModelCallResult> {
    const key = exactInputCacheKey(input);
    const cached = this.get(key);
    if (cached) {
      return cached;
    }
    const fresh = await live.complete(input);
    this.put(key, fresh);
    return fresh;
  }

  close(): void {
    this.db.close();
  }
}