import type { ResearchFact } from "./domain.js";

/**
 * Local stand-in for Task 045 `SecureDocFetcher` (the Task 082 text cites Task 047;
 * the producer that actually exports this API is Task 045). The real fetcher throws.
 * This port returns a diagnostic so discovery and planning keep running.
 */
export interface DocFetchResult {
  readonly url: string;
  readonly finalUrl: string;
  readonly fetchedAt: string;
  readonly detectedVersion: string | null;
  readonly sha256: string;
  readonly truncated: boolean;
  readonly originalChars: number;
  readonly markdown: string;
  readonly wrappedDataBlock: string;
  readonly fromCache: boolean;
  readonly html?: string;
}

export interface FetchDocsOptions {
  readonly role?: "researcher" | "worker";
  readonly packageName?: string;
  readonly version?: string;
}

export type FetchFailureReason = "http_404" | "off_allowlist_redirect" | "unreachable";

export type DocFetchOutcome =
  | { readonly ok: true; readonly result: DocFetchResult }
  | {
      readonly ok: false;
      readonly code: "fetch_failed";
      readonly reason: FetchFailureReason;
      readonly url: string;
      readonly detail?: string;
    };

export interface SecureDocFetcherPort {
  fetchDocs(urlOrPkg: string, options?: FetchDocsOptions): Promise<DocFetchOutcome>;
}

/** Local stand-in for Task 014 `GlobalBrokerDb` research_cache methods. */
export interface ResearchCacheKey {
  readonly packageName: string;
  readonly versionRange: string;
  readonly docUrl: string;
}

export interface ResearchCacheEntry extends ResearchCacheKey {
  readonly pageVersion: string | null;
  readonly artifactHash: string;
  readonly fetchedAt: number;
  readonly expiresAt: number;
}

export interface ResearchCacheWrite {
  readonly packageName: string;
  readonly versionRange: string;
  readonly docUrl: string;
  readonly pageVersion?: string | null;
  readonly artifactHash: string;
  readonly fetchedAt: number;
}

export interface ResearchCacheFilter {
  readonly packageName?: string;
  readonly versionRange?: string;
  readonly docUrl?: string;
}

export interface GlobalResearchCachePort {
  putResearchCache(input: ResearchCacheWrite): ResearchCacheEntry;
  lookupResearchCache(key: ResearchCacheKey, now: number): ResearchCacheEntry | null;
  readResearchCache(key: ResearchCacheKey): ResearchCacheEntry | null;
  invalidateResearchCache(filter: ResearchCacheFilter): number;
}

export interface KnowledgeNodeWrite {
  readonly id: string;
  readonly kind: "research_fact";
  readonly title: string;
  readonly text: string;
  readonly status: "active";
  readonly fields: {
    readonly basis: "observed";
    readonly feature: string | null;
    readonly claim: string;
    readonly exactQuote: string;
    readonly sourceUrl: string;
    readonly docVersion: string;
    readonly fetchedAt: string;
    readonly verifiedBy: ResearchFact["verifiedBy"];
    readonly authoritative: true;
    readonly libraryName: string | null;
    readonly majorMinor: string | null;
    readonly topicHash: string;
  };
}

export interface KnowledgeEdgeWrite {
  readonly src: string;
  readonly type: "informs";
  readonly dst: string;
}

export interface KnowledgeChangeSet {
  readonly origin: "research";
  readonly author: string;
  readonly summary: string;
  readonly nodes: readonly KnowledgeNodeWrite[];
  readonly edges: readonly KnowledgeEdgeWrite[];
}

export interface KnowledgeCommitResult {
  readonly rev: number;
  readonly changeSetId: string;
}

/** Local stand-in for Task 017 `KnowledgeGraphRepo.commitChangeSet`. */
export interface KnowledgeGraphPort {
  commitChangeSet(proposal: KnowledgeChangeSet): KnowledgeCommitResult;
  authoritativeFacts(): readonly KnowledgeNodeWrite[];
}

export interface FeatureResearcherPrompt {
  readonly role: "feature-researcher@1";
  readonly topic: string;
  readonly stack: readonly { readonly name: string; readonly version: string }[];
  readonly relatedSpecItems: readonly { readonly id: string; readonly text: string }[];
  readonly untrustedDataBlocks: readonly string[];
  readonly tools: readonly [];
  readonly toolAuthority: "none";
  readonly shell: false;
  readonly networkTools: false;
  readonly writeTools: false;
}

export interface FeatureResearcherCompletion {
  readonly output: unknown;
  readonly tokens: number;
}

/** Model call with an empty tool list. The orchestrator never grants shell, write, or network tools. */
export interface FeatureResearcherModel {
  complete(prompt: FeatureResearcherPrompt): Promise<FeatureResearcherCompletion>;
}
