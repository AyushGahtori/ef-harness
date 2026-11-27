import {
  CasBlobMissingError,
  CasBlobStore,
  type GlobalBrokerDb,
  type KnowledgeGraphRepo,
} from "@ef-harness/db";
import type { FactBodyStore } from "./research-fact-cache.js";
import type {
  KnowledgeChangeSet,
  KnowledgeCommitResult,
  KnowledgeGraphPort,
  KnowledgeNodeWrite,
  ResearchCacheEntry,
  ResearchCacheFilter,
  ResearchCacheKey,
  ResearchCacheWrite,
  GlobalResearchCachePort,
} from "./ports.js";

/** `global.db.research_cache` through `GlobalBrokerDb`. */
export class BrokerResearchCache implements GlobalResearchCachePort {
  constructor(private readonly broker: GlobalBrokerDb) {}

  putResearchCache(input: ResearchCacheWrite): ResearchCacheEntry {
    return this.broker.putResearchCache(input);
  }

  lookupResearchCache(key: ResearchCacheKey, now: number): ResearchCacheEntry | null {
    return this.broker.lookupResearchCache(key, now);
  }

  readResearchCache(key: ResearchCacheKey): ResearchCacheEntry | null {
    const row = this.broker.writer
      .prepare(
        `SELECT package, version_range, doc_url, page_version, artifact_hash, fetched_at, expires_at
           FROM research_cache
          WHERE package = ? AND version_range = ? AND doc_url = ?`,
      )
      .get([key.packageName, key.versionRange, key.docUrl]);
    return cacheRow(row);
  }

  invalidateResearchCache(filter: ResearchCacheFilter): number {
    return this.broker.invalidateResearchCache(filter);
  }
}

/** Fact bodies in `CasBlobStore`, keyed by the research-cache artifact hash. */
export function casFactBodies(cas: CasBlobStore): FactBodyStore {
  return {
    async putBody(bytes, holderId) {
      const receipt = await cas.put(bytes, { holderKind: "research", holderId, format: "raw" });
      return { hash: receipt.hash };
    },
    async getBody(hash) {
      try {
        return await cas.getBlob(hash, "evidence");
      } catch (error) {
        if (error instanceof CasBlobMissingError) return null;
        throw error;
      }
    },
  };
}

/** `KnowledgeGraphRepo` adapter that records `informs` edges and skips repeats. */
export class ProjectStateKnowledgeGraph implements KnowledgeGraphPort {
  constructor(private readonly repo: KnowledgeGraphRepo) {}

  commitChangeSet(proposal: KnowledgeChangeSet): KnowledgeCommitResult {
    const creates = proposal.nodes.filter((node) => this.repo.getNode(node.id) === null);
    const known = new Set(proposal.nodes.map((node) => node.id));
    for (const node of this.listFactIds()) known.add(node);
    const edges = proposal.edges.filter((edge) => {
      if (!known.has(edge.src) || this.repo.getNode(edge.dst) === null) return false;
      return !this.edgeExists(edge.src, edge.dst);
    });
    if (creates.length === 0 && edges.length === 0) {
      return { rev: this.repo.currentRevision(), changeSetId: "research-noop" };
    }
    const result = this.repo.commitChangeSet({
      origin: "research",
      author: proposal.author,
      summary: proposal.summary,
      nodes: creates.map((node) => ({
        op: "create",
        id: node.id,
        kind: node.kind,
        title: node.title,
        text: node.text,
        status: node.status,
        fields: node.fields,
      })),
      edges: edges.map((edge) => ({ op: "create", src: edge.src, type: edge.type, dst: edge.dst })),
    });
    return { rev: result.rev, changeSetId: result.changeSetId ?? "research" };
  }

  authoritativeFacts(): readonly KnowledgeNodeWrite[] {
    const facts: KnowledgeNodeWrite[] = [];
    for (const id of this.listFactIds()) {
      const node = this.repo.getNode(id);
      const written = node ? toWrite(node.id, node.title, node.text, node.fields) : null;
      if (written) facts.push(written);
    }
    return facts;
  }

  private listFactIds(): string[] {
    const rows = this.repo.connection
      .prepare("SELECT id FROM nodes WHERE kind = 'research_fact' AND status = 'active' ORDER BY id")
      .all({});
    const ids: string[] = [];
    for (const row of rows) {
      if (isRecord(row) && typeof row.id === "string") ids.push(row.id);
    }
    return ids;
  }

  private edgeExists(src: string, dst: string): boolean {
    const row = this.repo.connection
      .prepare(
        `SELECT 1 AS present FROM edges
          WHERE src = :src AND type = 'informs' AND dst = :dst AND valid_to_rev IS NULL`,
      )
      .get({ src, dst });
    return isRecord(row);
  }
}

function cacheRow(value: unknown): ResearchCacheEntry | null {
  if (!isRecord(value)) return null;
  const packageName = text(value.package);
  const versionRange = text(value.version_range);
  const docUrl = text(value.doc_url);
  const artifactHash = text(value.artifact_hash);
  const fetchedAt = integer(value.fetched_at);
  const expiresAt = integer(value.expires_at);
  if (!packageName || !versionRange || !docUrl || !artifactHash || fetchedAt === null || expiresAt === null) {
    return null;
  }
  const pageVersion = value.page_version;
  return {
    packageName,
    versionRange,
    docUrl,
    pageVersion: typeof pageVersion === "string" ? pageVersion : null,
    artifactHash,
    fetchedAt,
    expiresAt,
  };
}

function toWrite(id: string, title: string, text: string, fields: unknown): KnowledgeNodeWrite | null {
  if (!isRecord(fields)) return null;
  const verifiedBy = fields.verifiedBy;
  if (
    fields.basis !== "observed" ||
    fields.authoritative !== true ||
    typeof fields.claim !== "string" ||
    typeof fields.exactQuote !== "string" ||
    typeof fields.sourceUrl !== "string" ||
    typeof fields.docVersion !== "string" ||
    typeof fields.fetchedAt !== "string" ||
    typeof fields.topicHash !== "string" ||
    (verifiedBy !== "quote_matcher" && verifiedBy !== "installed_types" && verifiedBy !== "both")
  ) {
    return null;
  }
  const feature = fields.feature;
  const libraryName = fields.libraryName;
  const majorMinor = fields.majorMinor;
  return {
    id,
    kind: "research_fact",
    title,
    text,
    status: "active",
    fields: {
      basis: "observed",
      feature: typeof feature === "string" ? feature : null,
      claim: fields.claim,
      exactQuote: fields.exactQuote,
      sourceUrl: fields.sourceUrl,
      docVersion: fields.docVersion,
      fetchedAt: fields.fetchedAt,
      verifiedBy,
      authoritative: true,
      libraryName: typeof libraryName === "string" ? libraryName : null,
      majorMinor: typeof majorMinor === "string" ? majorMinor : null,
      topicHash: fields.topicHash,
    },
  };
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function integer(value: unknown): number | null {
  if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  if (typeof value === "bigint" && value <= BigInt(Number.MAX_SAFE_INTEGER)) return Number(value);
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
