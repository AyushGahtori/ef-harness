import {
  bindKnowledgeGraph,
  bindKnowledgeSearch,
  type KnowledgeGraphRepo,
  type KnowledgeSearchService,
  type NodeRecord,
  type ProjectStateDb,
} from "@ef-harness/db";
import { isSealedOracle } from "./oracle.js";
import type { FtsSearchHit, FtsSearchPage, FtsSearchQuery, FtsSearchRepo } from "./ports/fts-search-repo.js";
import { countTokens } from "./text.js";
import type { ContractLink, KnowledgeBand, KnowledgeNode } from "./types.js";

/**
 * `kb.*` reads over the shared `ProjectStateDb`.
 * Sealed checks and `oracle_only` nodes stay out of search hits.
 */
export class ProjectStateFtsSearchRepo implements FtsSearchRepo {
  constructor(
    private readonly graph: KnowledgeGraphRepo,
    private readonly searchService: KnowledgeSearchService,
  ) {}

  revision(): number {
    return this.graph.currentRevision();
  }

  getNode(nodeId: string): KnowledgeNode | null {
    const node = this.graph.getNode(nodeId);
    return node ? toPullNode(node) : null;
  }

  search(query: FtsSearchQuery): FtsSearchPage {
    const page = this.searchService.searchNodes(
      query.types.length > 0
        ? { query: query.query, kinds: query.types, limit: query.limit }
        : { query: query.query, limit: query.limit },
    );
    const hits: FtsSearchHit[] = [];
    let hiddenMatchCount = 0;
    for (const item of page.items) {
      const node = this.getNode(item.id);
      if (!node || node.status !== "active") continue;
      if (isSealedOracle(node)) {
        hiddenMatchCount += 1;
        continue;
      }
      hits.push({
        nodeId: node.id,
        kind: node.kind,
        title: node.title,
        snippet: item.snippet,
        score: item.score,
        version: node.version,
        couldIndex: node.couldIndex || node.band === "COULD",
        band: node.band,
        tokenCost: node.tokenCost,
      });
    }
    return {
      hits,
      hiddenMatchCount,
      revision: this.revision(),
    };
  }
}

export function projectStateFtsRepo(state: ProjectStateDb): ProjectStateFtsSearchRepo {
  return new ProjectStateFtsSearchRepo(bindKnowledgeGraph(state), bindKnowledgeSearch(state));
}

function toPullNode(node: NodeRecord): KnowledgeNode {
  const fields = asRecord(node.fields);
  const visibility = typeof fields.visibility === "string" ? fields.visibility : "visible";
  const sealed =
    fields.sealed === true || fields.hidden_check === true || fields.sealed_oracle === true;
  const hidden = isSealedOracle({ hidden: sealed, kind: node.kind, visibility });
  const band = bandOf(fields.band);
  return {
    id: node.id,
    kind: node.kind,
    title: node.title,
    prose: node.text,
    tags: stringList(fields.tags),
    status: node.status === "active" ? "active" : "retired",
    hidden,
    visibility,
    canonical: asRecord(fields.canonical),
    outgoingContractLinks: contractLinks(fields.outgoingContractLinks),
    schemas: arrayOf(fields.schemas),
    seams: arrayOf(fields.seams),
    errorCodes: stringList(fields.errorCodes),
    version: node.version,
    rev: node.updatedRev,
    couldIndex: fields.couldIndex === true || band === "COULD",
    band,
    tokenCost: finiteNumber(fields.tokenCost) ?? countTokens(`${node.title} ${node.text}`),
  };
}

function bandOf(value: unknown): KnowledgeBand {
  const raw = typeof value === "string" ? value.trim().toUpperCase() : "";
  if (raw === "MUST" || raw === "SHOULD" || raw === "COULD") return raw;
  return "COULD";
}

function contractLinks(value: unknown): ContractLink[] {
  if (!Array.isArray(value)) return [];
  const links: ContractLink[] = [];
  for (const item of value) {
    const record = asRecord(item);
    if (typeof record.contractId !== "string" || typeof record.relation !== "string") continue;
    links.push({ contractId: record.contractId, relation: record.relation });
  }
  return links;
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

function arrayOf(value: unknown): unknown[] {
  return Array.isArray(value) ? [...value] : [];
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const record: Record<string, unknown> = {};
  for (const key of Object.keys(value)) record[key] = Reflect.get(value, key);
  return record;
}
