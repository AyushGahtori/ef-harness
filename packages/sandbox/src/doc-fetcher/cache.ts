import { DatabaseSync } from "node:sqlite";
import { DocFetchError } from "./errors.js";
import { sha256Hex } from "./hash.js";
import { RESEARCH_CACHE_TTL_MS } from "./policy.js";

export interface ResearchCacheEntry {
  readonly packageName: string;
  readonly versionRange: string;
  readonly docUrl: string;
  readonly pageVersion: string | null;
  readonly artifactHash: string;
  readonly fetchedAt: number;
  readonly expiresAt: number;
}

export interface ResearchCacheWrite {
  readonly packageName: string;
  readonly versionRange: string;
  readonly docUrl: string;
  readonly pageVersion: string | null;
  readonly artifactHash: string;
  readonly fetchedAt: number;
}

export interface ResearchCacheFilter {
  readonly packageName?: string;
  readonly versionRange?: string;
  readonly docUrl?: string;
}

export interface ResearchPin {
  readonly hash: string;
  readonly holderId: string;
  readonly pinnedAt: number;
}

export interface ResearchCacheStore {
  put(entry: ResearchCacheWrite): ResearchCacheEntry;
  lookup(
    key: Pick<ResearchCacheEntry, "packageName" | "versionRange" | "docUrl">,
    now: number,
  ): ResearchCacheEntry | null;
  invalidate(filter: ResearchCacheFilter): ResearchCacheEntry[];
  pin(hash: string, holderId: string, pinnedAt: number, bytes: number): void;
  unpin(hash: string, holderId: string): void;
  listPins(): readonly ResearchPin[];
}

export interface CasBlobStore {
  putBlob(content: Uint8Array): Promise<{ hash: string }>;
  getBlob(hash: string): Promise<Uint8Array | null>;
}

export function researchHolderId(packageName: string, versionRange: string, docUrl: string): string {
  return `research:${packageName}:${versionRange}:${sha256Hex(docUrl).slice(0, 32)}`;
}

export class MemoryCasBlobStore implements CasBlobStore {
  private readonly blobs = new Map<string, Uint8Array>();

  async putBlob(content: Uint8Array): Promise<{ hash: string }> {
    const hash = sha256Hex(content);
    this.blobs.set(hash, new Uint8Array(content));
    return { hash };
  }

  async getBlob(hash: string): Promise<Uint8Array | null> {
    const found = this.blobs.get(hash);
    return found ? new Uint8Array(found) : null;
  }
}

export class MemoryResearchCacheStore implements ResearchCacheStore {
  private readonly entries = new Map<string, ResearchCacheEntry>();
  private readonly pins = new Map<string, ResearchPin>();

  put(entry: ResearchCacheWrite): ResearchCacheEntry {
    const key = cacheKey(entry);
    const previous = this.entries.get(key);
    if (previous && previous.artifactHash !== entry.artifactHash) {
      this.unpin(previous.artifactHash, researchHolderId(previous.packageName, previous.versionRange, previous.docUrl));
    }
    const stored = withExpiry(entry);
    this.entries.set(key, stored);
    return stored;
  }

  lookup(
    key: Pick<ResearchCacheEntry, "packageName" | "versionRange" | "docUrl">,
    now: number,
  ): ResearchCacheEntry | null {
    const entry = this.entries.get(cacheKey(key));
    if (!entry) return null;
    if (entry.expiresAt <= now) {
      this.invalidate(key);
      return null;
    }
    return entry;
  }

  invalidate(filter: ResearchCacheFilter): ResearchCacheEntry[] {
    assertFilter(filter);
    const removed: ResearchCacheEntry[] = [];
    for (const [key, entry] of this.entries) {
      if (!matches(entry, filter)) continue;
      this.entries.delete(key);
      this.unpin(entry.artifactHash, researchHolderId(entry.packageName, entry.versionRange, entry.docUrl));
      removed.push(entry);
    }
    return removed;
  }

  pin(hash: string, holderId: string, pinnedAt: number, bytes: number): void {
    void bytes;
    this.pins.set(pinKey(hash, holderId), { hash, holderId, pinnedAt });
  }

  unpin(hash: string, holderId: string): void {
    this.pins.delete(pinKey(hash, holderId));
  }

  listPins(): readonly ResearchPin[] {
    return [...this.pins.values()];
  }
}

export class SqliteResearchCacheStore implements ResearchCacheStore {
  constructor(private readonly db: DatabaseSync) {}

  put(entry: ResearchCacheWrite): ResearchCacheEntry {
    const previous = this.read(entry);
    if (previous && previous.artifactHash !== entry.artifactHash) {
      this.unpin(previous.artifactHash, researchHolderId(previous.packageName, previous.versionRange, previous.docUrl));
    }
    const stored = withExpiry(entry);
    this.db
      .prepare(
        `INSERT INTO research_cache(
           package, version_range, doc_url, page_version, artifact_hash, fetched_at, expires_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(package, version_range, doc_url) DO UPDATE SET
           page_version = excluded.page_version,
           artifact_hash = excluded.artifact_hash,
           fetched_at = excluded.fetched_at,
           expires_at = excluded.expires_at`,
      )
      .run(
        stored.packageName,
        stored.versionRange,
        stored.docUrl,
        stored.pageVersion,
        stored.artifactHash,
        stored.fetchedAt,
        stored.expiresAt,
      );
    return stored;
  }

  lookup(
    key: Pick<ResearchCacheEntry, "packageName" | "versionRange" | "docUrl">,
    now: number,
  ): ResearchCacheEntry | null {
    const entry = this.read(key);
    if (!entry) return null;
    if (entry.expiresAt <= now) {
      this.invalidate(key);
      return null;
    }
    return entry;
  }

  invalidate(filter: ResearchCacheFilter): ResearchCacheEntry[] {
    assertFilter(filter);
    const removed = this.select(filter);
    const clauses: string[] = [];
    const params: string[] = [];
    if (filter.packageName !== undefined) {
      clauses.push("package = ?");
      params.push(filter.packageName);
    }
    if (filter.versionRange !== undefined) {
      clauses.push("version_range = ?");
      params.push(filter.versionRange);
    }
    if (filter.docUrl !== undefined) {
      clauses.push("doc_url = ?");
      params.push(filter.docUrl);
    }
    this.db.prepare(`DELETE FROM research_cache WHERE ${clauses.join(" AND ")}`).run(...params);
    for (const entry of removed) {
      this.unpin(entry.artifactHash, researchHolderId(entry.packageName, entry.versionRange, entry.docUrl));
    }
    return removed;
  }

  pin(hash: string, holderId: string, pinnedAt: number, bytes: number): void {
    this.db
      .prepare(
        `INSERT INTO cas_blobs(hash, bytes, stored_bytes, format, state, created_at)
         VALUES (?, ?, ?, 'raw', 'ok', ?)
         ON CONFLICT(hash) DO NOTHING`,
      )
      .run(hash, bytes, bytes, pinnedAt);
    this.db
      .prepare(
        `INSERT INTO cas_pins(hash, holder_kind, holder_id, pinned_at)
         VALUES (?, 'research', ?, ?)
         ON CONFLICT(hash, holder_kind, holder_id) DO UPDATE SET pinned_at = excluded.pinned_at`,
      )
      .run(hash, holderId, pinnedAt);
  }

  unpin(hash: string, holderId: string): void {
    this.db
      .prepare("DELETE FROM cas_pins WHERE hash = ? AND holder_kind = 'research' AND holder_id = ?")
      .run(hash, holderId);
  }

  listPins(): readonly ResearchPin[] {
    return this.db
      .prepare(
        `SELECT hash, holder_id, pinned_at
         FROM cas_pins
         WHERE holder_kind = 'research'
         ORDER BY holder_id, hash`,
      )
      .all()
      .map((row) => {
        const record = asRecord(row);
        return {
          hash: requiredText(record, "hash"),
          holderId: requiredText(record, "holder_id"),
          pinnedAt: requiredInt(record, "pinned_at"),
        };
      });
  }

  private read(key: Pick<ResearchCacheEntry, "packageName" | "versionRange" | "docUrl">): ResearchCacheEntry | null {
    const row = this.db
      .prepare(
        `SELECT package, version_range, doc_url, page_version, artifact_hash, fetched_at, expires_at
         FROM research_cache
         WHERE package = ? AND version_range = ? AND doc_url = ?`,
      )
      .get(key.packageName, key.versionRange, key.docUrl);
    if (row === undefined) return null;
    return mapEntry(asRecord(row));
  }

  private select(filter: ResearchCacheFilter): ResearchCacheEntry[] {
    const clauses: string[] = [];
    const params: string[] = [];
    if (filter.packageName !== undefined) {
      clauses.push("package = ?");
      params.push(filter.packageName);
    }
    if (filter.versionRange !== undefined) {
      clauses.push("version_range = ?");
      params.push(filter.versionRange);
    }
    if (filter.docUrl !== undefined) {
      clauses.push("doc_url = ?");
      params.push(filter.docUrl);
    }
    return this.db
      .prepare(
        `SELECT package, version_range, doc_url, page_version, artifact_hash, fetched_at, expires_at
         FROM research_cache WHERE ${clauses.join(" AND ")}`,
      )
      .all(...params)
      .map((row) => mapEntry(asRecord(row)));
  }
}

function withExpiry(entry: ResearchCacheWrite): ResearchCacheEntry {
  if (!Number.isSafeInteger(entry.fetchedAt)) {
    throw new DocFetchError("CACHE_TIME", "fetchedAt must be a safe integer");
  }
  const expiresAt = entry.fetchedAt + RESEARCH_CACHE_TTL_MS;
  if (!Number.isSafeInteger(expiresAt)) throw new DocFetchError("CACHE_TIME", "research cache expiry is out of range");
  return { ...entry, expiresAt };
}

function cacheKey(entry: Pick<ResearchCacheEntry, "packageName" | "versionRange" | "docUrl">): string {
  return JSON.stringify([entry.packageName, entry.versionRange, entry.docUrl]);
}

function pinKey(hash: string, holderId: string): string {
  return JSON.stringify([hash, holderId]);
}

function matches(entry: ResearchCacheEntry, filter: ResearchCacheFilter): boolean {
  if (filter.packageName !== undefined && entry.packageName !== filter.packageName) return false;
  if (filter.versionRange !== undefined && entry.versionRange !== filter.versionRange) return false;
  if (filter.docUrl !== undefined && entry.docUrl !== filter.docUrl) return false;
  return true;
}

function assertFilter(filter: ResearchCacheFilter): void {
  if (filter.packageName === undefined && filter.versionRange === undefined && filter.docUrl === undefined) {
    throw new DocFetchError("CACHE_FILTER", "research cache invalidation needs package, versionRange, or docUrl");
  }
}

function mapEntry(row: Record<string, unknown>): ResearchCacheEntry {
  return {
    packageName: requiredText(row, "package"),
    versionRange: requiredText(row, "version_range"),
    docUrl: requiredText(row, "doc_url"),
    pageVersion: optionalText(row, "page_version"),
    artifactHash: requiredText(row, "artifact_hash"),
    fetchedAt: requiredInt(row, "fetched_at"),
    expiresAt: requiredInt(row, "expires_at"),
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") throw new DocFetchError("CACHE_ROW", "research cache row was not an object");
  return value as Record<string, unknown>;
}

function requiredText(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  if (typeof value !== "string" || value.length === 0) throw new DocFetchError("CACHE_ROW", `missing ${key}`);
  return value;
}

function optionalText(row: Record<string, unknown>, key: string): string | null {
  const value = row[key];
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") throw new DocFetchError("CACHE_ROW", `invalid ${key}`);
  return value;
}

function requiredInt(row: Record<string, unknown>, key: string): number {
  const value = row[key];
  if (typeof value === "bigint") {
    const asNumber = Number(value);
    if (Number.isSafeInteger(asNumber)) return asNumber;
  }
  if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  throw new DocFetchError("CACHE_ROW", `invalid ${key}`);
}
