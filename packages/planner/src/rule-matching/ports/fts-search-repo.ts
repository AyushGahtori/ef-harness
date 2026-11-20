import { isSealedOracle } from "../oracle.js";
import { snippetAround, tokenize } from "../text.js";
import type { KnowledgeNode } from "../types.js";

export interface FtsSearchQuery {
  readonly query: string;
  readonly types: readonly string[];
  readonly limit: number;
}

export interface FtsSearchHit {
  readonly nodeId: string;
  readonly kind: string;
  readonly title: string;
  readonly snippet: string;
  readonly score: number;
  readonly version: number;
  readonly couldIndex: boolean;
  readonly band: KnowledgeNode["band"];
  readonly tokenCost: number;
}

export interface FtsSearchPage {
  readonly hits: readonly FtsSearchHit[];
  readonly hiddenMatchCount: number;
  readonly revision: number;
}

/**
 * Local port of Task 018.
 * Task 018 exports `KnowledgeSearchService` (`kb_words` BM25 title weight 2.0, body weight 1.0,
 * plus `kb_ident` substring/trigram). This in-memory repo keeps that ranking contract until the
 * sibling branch is wired.
 */
export interface FtsSearchRepo {
  revision(): number;
  getNode(nodeId: string): KnowledgeNode | null;
  search(query: FtsSearchQuery): FtsSearchPage;
}

const TITLE_WEIGHT = 2;
const BODY_WEIGHT = 1;
const IDENT_BOOST = 5;

export class InMemoryFtsSearchRepo implements FtsSearchRepo {
  private readonly byId = new Map<string, KnowledgeNode>();
  private readonly corpusRev: number;

  constructor(nodes: readonly KnowledgeNode[], corpusRev?: number) {
    let rev = corpusRev ?? 1;
    for (const node of nodes) {
      this.byId.set(node.id, node);
      if (node.rev > rev) rev = node.rev;
    }
    this.corpusRev = rev;
  }

  revision(): number {
    return this.corpusRev;
  }

  getNode(nodeId: string): KnowledgeNode | null {
    return this.byId.get(nodeId) ?? null;
  }

  search(query: FtsSearchQuery): FtsSearchPage {
    const terms = tokenize(query.query);
    const needle = query.query.trim().toLowerCase();
    const types = new Set(query.types);
    const visible: { hit: FtsSearchHit; id: string }[] = [];
    let hiddenMatchCount = 0;
    for (const node of this.byId.values()) {
      if (node.status !== "active") continue;
      if (types.size > 0 && !types.has(node.kind)) continue;
      const score = scoreNode(node, terms, needle);
      if (score <= 0) continue;
      if (isSealedOracle(node)) {
        hiddenMatchCount += 1;
        continue;
      }
      visible.push({
        id: node.id,
        hit: {
          nodeId: node.id,
          kind: node.kind,
          title: node.title,
          snippet: snippetAround(node.prose, terms),
          score,
          version: node.version,
          couldIndex: node.couldIndex || node.band === "COULD",
          band: node.band,
          tokenCost: node.tokenCost,
        },
      });
    }
    visible.sort((left, right) => {
      if (right.hit.score !== left.hit.score) return right.hit.score - left.hit.score;
      return left.id.localeCompare(right.id);
    });
    const limit = query.limit;
    return {
      hits: visible.slice(0, limit).map((row) => row.hit),
      hiddenMatchCount,
      revision: this.corpusRev,
    };
  }
}

function scoreNode(node: KnowledgeNode, terms: readonly string[], needle: string): number {
  const titleTokens = tokenize(node.title);
  const bodyTokens = tokenize(`${node.prose} ${node.tags.join(" ")}`);
  let score = 0;
  if (terms.length === 0) {
    if (needle.length >= 2 && identMatch(node, needle)) return IDENT_BOOST;
    return 0;
  }
  for (const term of terms) {
    score += TITLE_WEIGHT * countTerm(titleTokens, term);
    score += BODY_WEIGHT * countTerm(bodyTokens, term);
  }
  if (needle.length >= 2 && identMatch(node, needle)) score += IDENT_BOOST;
  return score;
}

function countTerm(tokens: readonly string[], term: string): number {
  let count = 0;
  for (const token of tokens) {
    if (token === term) count += 1;
  }
  return count;
}

/** Ident index: raw substring (`C-01` hits `C-014`) and compact alphanumerics. */
function identMatch(node: KnowledgeNode, needle: string): boolean {
  const id = node.id.toLowerCase();
  if (id.includes(needle)) return true;
  const compactNeedle = needle.replace(/[^a-z0-9]/g, "");
  const compactId = id.replace(/[^a-z0-9]/g, "");
  return compactNeedle.length >= 2 && compactId.includes(compactNeedle);
}
