import {
  RESEARCH_CACHE_TTL_MS,
  majorMinor,
  sha256Hex,
  topicCacheDocUrl,
  type ResearchFact,
} from "./domain.js";
import { quarantineWebDoc, stripInvisibleUnicode } from "./doc-quarantine.js";
import type {
  GlobalResearchCachePort,
  ResearchCacheEntry,
  ResearchCacheFilter,
  ResearchCacheKey,
  ResearchCacheWrite,
} from "./ports.js";

export interface CachedResearchRecord {
  readonly topicHash: string;
  readonly libraryName: string;
  readonly majorMinor: string;
  readonly facts: readonly ResearchFact[];
  readonly sourceExcerpt: string;
  readonly sourceHash: string;
  readonly fetchedAt: number;
  readonly expiresAt: number;
  readonly schemaRow: ResearchCacheEntry;
  readonly servedProjects: readonly string[];
}

export type CacheStatus = "fresh" | "expired" | "miss" | "stale_offline_fallback";

export interface CacheLookup {
  readonly cache_hit: boolean;
  readonly tokens: number;
  readonly status: CacheStatus;
  readonly record: CachedResearchRecord | null;
}

export interface CachePutInput {
  readonly topicHash: string;
  readonly libraryName: string;
  readonly version: string;
  readonly facts: readonly ResearchFact[];
  readonly sourceHtml: string;
  readonly fetchedAt: number;
  readonly projectId?: string;
  readonly url?: string;
  readonly pageVersion?: string;
}

/**
 * 90-day content-addressed fact cache.
 * Logical key: (canonical_topic_hash, library_name, major_minor_version).
 * Physical `research_cache` row: package, version_range, doc_url = ef-topic:<hash>.
 */
export class ResearchFactCache {
  private readonly bodies = new Map<string, CachedResearchRecord>();

  constructor(private readonly store: GlobalResearchCachePort) {}

  put(input: CachePutInput): CachedResearchRecord {
    const version = majorMinor(input.version);
    if (!version) throw new Error("research cache version must include major.minor");
    const clean = quarantineWebDoc(input.sourceHtml, {
      url: input.url ?? topicCacheDocUrl(input.topicHash),
      fetchedAt: new Date(input.fetchedAt).toISOString(),
      pageVersion: input.pageVersion ?? version,
    });
    const facts = input.facts.flatMap((fact) => {
      const exactQuote = stripInvisibleUnicode(quarantineWebDoc(fact.exactQuote, {
        url: fact.sourceUrl,
        fetchedAt: fact.fetchedAt,
        pageVersion: fact.docVersion,
      }).plainText);
      if (exactQuote.trim().length < 10) return [];
      return [{ ...fact, exactQuote }];
    });
    const sourceExcerpt = clean.plainText;
    const sourceHash = sha256Hex(sourceExcerpt);
    const expiresAt = input.fetchedAt + RESEARCH_CACHE_TTL_MS;
    const schemaRow = this.store.putResearchCache({
      packageName: input.libraryName,
      versionRange: version,
      docUrl: topicCacheDocUrl(input.topicHash),
      pageVersion: input.pageVersion ?? version,
      artifactHash: sourceHash,
      fetchedAt: input.fetchedAt,
    });
    const record: CachedResearchRecord = {
      topicHash: input.topicHash,
      libraryName: input.libraryName,
      majorMinor: version,
      facts,
      sourceExcerpt,
      sourceHash,
      fetchedAt: input.fetchedAt,
      expiresAt,
      schemaRow,
      servedProjects: input.projectId ? [input.projectId] : [],
    };
    this.bodies.set(bodyKey(input.topicHash, input.libraryName, version), record);
    return record;
  }

  get(input: {
    readonly topicHash: string;
    readonly libraryName: string;
    readonly version: string;
    readonly now: number;
    readonly offline?: boolean;
    readonly projectId?: string;
  }): CacheLookup {
    const version = majorMinor(input.version);
    if (!version) return { cache_hit: false, tokens: 0, status: "miss", record: null };
    const key = bodyKey(input.topicHash, input.libraryName, version);
    const schemaKey = {
      packageName: input.libraryName,
      versionRange: version,
      docUrl: topicCacheDocUrl(input.topicHash),
    };
    const freshRow = this.store.lookupResearchCache(schemaKey, input.now);
    const body = this.bodies.get(key) ?? null;
    if (freshRow && body && body.expiresAt > input.now) {
      const served = rememberProject(body, input.projectId);
      this.bodies.set(key, served);
      return { cache_hit: true, tokens: 0, status: "fresh", record: served };
    }
    if (body && body.expiresAt <= input.now) {
      if (input.offline) {
        return { cache_hit: false, tokens: 0, status: "stale_offline_fallback", record: body };
      }
      return { cache_hit: false, tokens: 0, status: "expired", record: null };
    }
    return { cache_hit: false, tokens: 0, status: "miss", record: null };
  }

  invalidateUpgrade(libraryName: string, previousVersion: string, nextVersion: string): number {
    const previous = majorMinor(previousVersion);
    const next = majorMinor(nextVersion);
    if (!previous || !next || previous === next) return 0;
    let removed = 0;
    for (const [key, body] of this.bodies) {
      if (body.libraryName !== libraryName || body.majorMinor !== previous) continue;
      this.bodies.delete(key);
      removed += 1;
    }
    return removed + this.store.invalidateResearchCache({ packageName: libraryName, versionRange: previous });
  }
}

export class MemoryGlobalResearchCache implements GlobalResearchCachePort {
  private readonly rows = new Map<string, ResearchCacheEntry>();

  putResearchCache(input: ResearchCacheWrite): ResearchCacheEntry {
    const entry: ResearchCacheEntry = {
      packageName: input.packageName,
      versionRange: input.versionRange,
      docUrl: input.docUrl,
      pageVersion: input.pageVersion ?? null,
      artifactHash: input.artifactHash,
      fetchedAt: input.fetchedAt,
      expiresAt: input.fetchedAt + RESEARCH_CACHE_TTL_MS,
    };
    this.rows.set(rowKey(entry), entry);
    return entry;
  }

  lookupResearchCache(key: ResearchCacheKey, now: number): ResearchCacheEntry | null {
    const found = this.rows.get(rowKey(key));
    if (!found) return null;
    if (found.expiresAt > now) return found;
    this.rows.delete(rowKey(key));
    return null;
  }

  readResearchCache(key: ResearchCacheKey): ResearchCacheEntry | null {
    return this.rows.get(rowKey(key)) ?? null;
  }

  invalidateResearchCache(filter: ResearchCacheFilter): number {
    if (!filter.packageName && !filter.versionRange && !filter.docUrl) {
      throw new Error("research cache invalidation needs package, versionRange, or docUrl");
    }
    let removed = 0;
    for (const [key, row] of this.rows) {
      if (filter.packageName && row.packageName !== filter.packageName) continue;
      if (filter.versionRange && row.versionRange !== filter.versionRange) continue;
      if (filter.docUrl && row.docUrl !== filter.docUrl) continue;
      this.rows.delete(key);
      removed += 1;
    }
    return removed;
  }
}

function bodyKey(topicHash: string, libraryName: string, version: string): string {
  return `${topicHash}\u0000${libraryName}\u0000${version}`;
}

function rowKey(key: ResearchCacheKey): string {
  return `${key.packageName}\u0000${key.versionRange}\u0000${key.docUrl}`;
}

function rememberProject(record: CachedResearchRecord, projectId: string | undefined): CachedResearchRecord {
  if (!projectId || record.servedProjects.includes(projectId)) return record;
  return { ...record, servedProjects: [...record.servedProjects, projectId] };
}
