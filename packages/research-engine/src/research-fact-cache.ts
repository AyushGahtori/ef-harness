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
  KnowledgeGraphPort,
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
  readonly informs?: readonly string[];
}

/** Durable fact bodies. The hash is the CAS digest of the serialized record. */
export interface FactBodyStore {
  putBody(bytes: Uint8Array, holderId: string): Promise<{ readonly hash: string }>;
  getBody(hash: string): Promise<Uint8Array | null>;
}

export interface ResearchFactCacheOptions {
  readonly bodies?: FactBodyStore;
  readonly graph?: KnowledgeGraphPort;
}

/**
 * 90-day content-addressed fact cache.
 * Logical key: (canonical_topic_hash, library_name, major_minor_version).
 * Physical `research_cache` row: package, version_range, doc_url = ef-topic:<hash>.
 */
export class ResearchFactCache {
  private readonly bodies = new Map<string, CachedResearchRecord>();
  private readonly factBodies: FactBodyStore | undefined;
  private readonly graph: KnowledgeGraphPort | undefined;

  constructor(
    private readonly store: GlobalResearchCachePort,
    options: ResearchFactCacheOptions = {},
  ) {
    this.factBodies = options.bodies;
    this.graph = options.graph;
  }

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

  /**
   * Writes the fact body to the configured body store and rewrites `artifact_hash`
   * so a later cache instance can load it. Metadata stays on the research-cache port.
   * Optional `informs` targets become `research_fact` nodes and `informs` edges.
   */
  async putDurable(input: CachePutInput): Promise<CachedResearchRecord> {
    const record = this.put(input);
    const version = record.majorMinor;
    const key = bodyKey(input.topicHash, input.libraryName, version);
    let stored = record;
    if (this.factBodies) {
      const payload = encodeBody(record);
      const holderId = input.projectId ?? input.libraryName;
      const written = await this.factBodies.putBody(payload, holderId);
      const schemaRow = this.store.putResearchCache({
        packageName: record.schemaRow.packageName,
        versionRange: record.schemaRow.versionRange,
        docUrl: record.schemaRow.docUrl,
        pageVersion: record.schemaRow.pageVersion,
        artifactHash: written.hash,
        fetchedAt: record.schemaRow.fetchedAt,
      });
      stored = { ...record, schemaRow };
      this.bodies.set(key, stored);
    }
    if (this.graph && input.informs && input.informs.length > 0 && stored.facts.length > 0) {
      this.graph.commitChangeSet(factChangeSet(stored, input.informs));
    }
    return stored;
  }

  /**
   * Same lookup as `get`, and when the process map is empty it reloads the body
   * from the body store using the research-cache artifact hash.
   */
  async getDurable(input: {
    readonly topicHash: string;
    readonly libraryName: string;
    readonly version: string;
    readonly now: number;
    readonly offline?: boolean;
    readonly projectId?: string;
  }): Promise<CacheLookup> {
    const version = majorMinor(input.version);
    if (!version) return { cache_hit: false, tokens: 0, status: "miss", record: null };
    const key = bodyKey(input.topicHash, input.libraryName, version);
    let body = this.bodies.get(key) ?? null;
    if (!body && this.factBodies) {
      const row = this.store.readResearchCache({
        packageName: input.libraryName,
        versionRange: version,
        docUrl: topicCacheDocUrl(input.topicHash),
      });
      if (row) {
        const bytes = await this.factBodies.getBody(row.artifactHash);
        const decoded = bytes ? decodeBody(bytes, row) : null;
        if (decoded) {
          body = decoded;
          this.bodies.set(key, decoded);
        }
      }
    }
    if (!body) return { cache_hit: false, tokens: 0, status: "miss", record: null };
    if (body.expiresAt > input.now) {
      const served = rememberProject(body, input.projectId);
      this.bodies.set(key, served);
      return { cache_hit: true, tokens: 0, status: "fresh", record: served };
    }
    if (input.offline) {
      return { cache_hit: false, tokens: 0, status: "stale_offline_fallback", record: body };
    }
    return { cache_hit: false, tokens: 0, status: "expired", record: null };
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

function encodeBody(record: CachedResearchRecord): Uint8Array {
  const payload = {
    topicHash: record.topicHash,
    libraryName: record.libraryName,
    majorMinor: record.majorMinor,
    facts: record.facts,
    sourceExcerpt: record.sourceExcerpt,
    sourceHash: record.sourceHash,
    fetchedAt: record.fetchedAt,
    expiresAt: record.expiresAt,
    servedProjects: record.servedProjects,
  };
  return Buffer.from(JSON.stringify(payload), "utf8");
}

function decodeBody(bytes: Uint8Array, schemaRow: ResearchCacheEntry): CachedResearchRecord | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(bytes).toString("utf8")) as unknown;
  } catch (error) {
    void error;
    return null;
  }
  if (!isRecord(parsed)) return null;
  const facts = decodeFacts(parsed.facts);
  const servedProjects = decodeProjects(parsed.servedProjects);
  if (
    facts === null ||
    servedProjects === null ||
    typeof parsed.topicHash !== "string" ||
    typeof parsed.libraryName !== "string" ||
    typeof parsed.majorMinor !== "string" ||
    typeof parsed.sourceExcerpt !== "string" ||
    typeof parsed.sourceHash !== "string" ||
    typeof parsed.fetchedAt !== "number" ||
    typeof parsed.expiresAt !== "number"
  ) {
    return null;
  }
  return {
    topicHash: parsed.topicHash,
    libraryName: parsed.libraryName,
    majorMinor: parsed.majorMinor,
    facts,
    sourceExcerpt: parsed.sourceExcerpt,
    sourceHash: parsed.sourceHash,
    fetchedAt: parsed.fetchedAt,
    expiresAt: parsed.expiresAt,
    schemaRow,
    servedProjects,
  };
}

function decodeFacts(value: unknown): ResearchFact[] | null {
  if (!Array.isArray(value)) return null;
  const facts: ResearchFact[] = [];
  for (const item of value) {
    if (!isRecord(item)) return null;
    const verifiedBy = item.verifiedBy;
    if (
      typeof item.claim !== "string" ||
      typeof item.exactQuote !== "string" ||
      typeof item.sourceUrl !== "string" ||
      typeof item.docVersion !== "string" ||
      typeof item.fetchedAt !== "string" ||
      (verifiedBy !== "quote_matcher" && verifiedBy !== "installed_types" && verifiedBy !== "both")
    ) {
      return null;
    }
    facts.push({
      claim: item.claim,
      exactQuote: item.exactQuote,
      sourceUrl: item.sourceUrl,
      docVersion: item.docVersion,
      fetchedAt: item.fetchedAt,
      verifiedBy,
    });
  }
  return facts;
}

function decodeProjects(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const projects: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") return null;
    projects.push(item);
  }
  return projects;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function factChangeSet(record: CachedResearchRecord, informs: readonly string[]) {
  const feature = informs[0] ?? null;
  const nodes = record.facts.map((fact, index) => ({
    id: `RF-${record.sourceHash.slice(0, 12)}-${String(index)}`,
    kind: "research_fact" as const,
    title: fact.claim.slice(0, 120),
    text: fact.claim,
    status: "active" as const,
    fields: {
      basis: "observed" as const,
      feature,
      claim: fact.claim,
      exactQuote: fact.exactQuote,
      sourceUrl: fact.sourceUrl,
      docVersion: fact.docVersion,
      fetchedAt: fact.fetchedAt,
      verifiedBy: fact.verifiedBy,
      authoritative: true as const,
      libraryName: record.libraryName,
      majorMinor: record.majorMinor,
      topicHash: record.topicHash,
    },
  }));
  return {
    origin: "research" as const,
    author: "feature-researcher@1",
    summary: record.libraryName,
    nodes,
    edges: nodes.flatMap((node) => informs.map((dst) => ({ src: node.id, type: "informs" as const, dst }))),
  };
}
