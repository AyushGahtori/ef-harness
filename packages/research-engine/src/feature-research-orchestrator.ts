import { urlAllowed } from "./allowlist.js";
import { majorMinor, sha256Hex, type ResearchBudget, type ResearchFact, type StackPackage, type TopicSignal } from "./domain.js";
import { quarantineWebDoc } from "./doc-quarantine.js";
import { parseFeatureResearcherV1, type ResearchClaim } from "./feature-researcher-v1.js";
import { InstalledTypeApiVerifier, type InstalledExport } from "./installed-type-api-verifier.js";
import type {
  DocFetchOutcome,
  DocFetchResult,
  FeatureResearcherModel,
  FeatureResearcherPrompt,
  KnowledgeGraphPort,
  SecureDocFetcherPort,
} from "./ports.js";
import { ResearchFactCache } from "./research-fact-cache.js";
import { RiskTriggeredTopicGenerator, type GeneratedTopic, type TopicPlan } from "./risk-triggered-topic-generator.js";
import { TokenBasedQuoteMatcher } from "./token-based-quote-matcher.js";

export interface InstalledPackageRef {
  readonly packageName: string;
  readonly root: string;
}

export interface ResearchRunRequest {
  readonly projectId: string;
  readonly stack: readonly StackPackage[];
  readonly signals: readonly TopicSignal[];
  readonly budget: ResearchBudget;
  readonly network: "enabled" | "denied";
  readonly now: number;
  readonly approvedPackages: readonly string[];
  readonly specItems?: readonly { readonly id: string; readonly text: string }[];
  readonly installedPackages?: readonly InstalledPackageRef[];
  readonly extraAllowHosts?: readonly string[];
}

export interface PublishedFact extends ResearchFact {
  readonly cache_hit: boolean;
  readonly tokens: number;
  readonly topicId: string;
  readonly nodeId: string;
  readonly status: "observed" | "stale_offline_fallback";
  readonly authoritative: boolean;
}

export interface UnverifiedFinding {
  readonly topicId: string;
  readonly claim: string;
  readonly status: "unverified_quote" | "version_mismatch" | "package_not_allowlisted" | "open_contradiction";
  readonly reason: string;
}

export interface ResearchDiagnostic {
  readonly code:
    | "fetch_failed"
    | "research_unavailable"
    | "version_mismatch"
    | "unverified_quote"
    | "package_not_allowlisted"
    | "open_contradiction"
    | "schema_rejected"
    | "blocked"
    | "deferred_to_installed_types";
  readonly topicId: string;
  readonly reason: string;
  readonly url?: string;
}

export interface ResearchRunResult {
  readonly facts: readonly PublishedFact[];
  readonly unverified: readonly UnverifiedFinding[];
  readonly diagnostics: readonly ResearchDiagnostic[];
  readonly topics: TopicPlan;
  readonly tokens: number;
  readonly modelCalls: number;
}

export interface OrchestratorPorts {
  readonly fetcher: SecureDocFetcherPort;
  readonly model: FeatureResearcherModel;
  readonly cache: ResearchFactCache;
  readonly graph: KnowledgeGraphPort;
  readonly topics?: RiskTriggeredTopicGenerator;
  readonly quotes?: TokenBasedQuoteMatcher;
  readonly types?: InstalledTypeApiVerifier;
}

const EMPTY_TOOLS: readonly [] = [];

export class FeatureResearchOrchestrator {
  private readonly topics: RiskTriggeredTopicGenerator;
  private readonly quotes: TokenBasedQuoteMatcher;
  private readonly types: InstalledTypeApiVerifier;

  constructor(private readonly ports: OrchestratorPorts) {
    this.topics = ports.topics ?? new RiskTriggeredTopicGenerator();
    this.quotes = ports.quotes ?? new TokenBasedQuoteMatcher();
    this.types = ports.types ?? new InstalledTypeApiVerifier();
  }

  async research(request: ResearchRunRequest): Promise<ResearchRunResult> {
    const plan = this.topics.generate({
      stack: request.stack,
      signals: request.signals,
      budget: request.budget,
    });
    const facts: PublishedFact[] = [];
    const unverified: UnverifiedFinding[] = [];
    const diagnostics: ResearchDiagnostic[] = [];
    let tokens = 0;
    let modelCalls = 0;
    let spentEstimate = 0;

    for (const topic of plan.topics) {
      if (topic.disposition === "skipped_trivial") continue;
      if (topic.disposition === "deferred_to_installed_types") {
        diagnostics.push({
          code: "deferred_to_installed_types",
          topicId: topic.id,
          reason: "topic is outside the 3% research envelope and is deferred to installed types",
        });
        this.collectInstalled(request, topic, facts, diagnostics);
        continue;
      }
      if (spentEstimate + topic.estimatedTokens > plan.tokenCap) {
        diagnostics.push({
          code: "deferred_to_installed_types",
          topicId: topic.id,
          reason: "remaining research token cap cannot fund another feature-researcher@1 call",
        });
        this.collectInstalled(request, topic, facts, diagnostics);
        continue;
      }
      const outcome = await this.researchTopic(request, topic);
      tokens += outcome.tokens;
      modelCalls += outcome.modelCalls;
      spentEstimate += outcome.modelCalls > 0 ? topic.estimatedTokens : 0;
      facts.push(...outcome.facts);
      unverified.push(...outcome.unverified);
      diagnostics.push(...outcome.diagnostics);
    }

    return { facts, unverified, diagnostics, topics: plan, tokens, modelCalls };
  }

  private async researchTopic(
    request: ResearchRunRequest,
    topic: GeneratedTopic,
  ): Promise<{
    readonly facts: readonly PublishedFact[];
    readonly unverified: readonly UnverifiedFinding[];
    readonly diagnostics: readonly ResearchDiagnostic[];
    readonly tokens: number;
    readonly modelCalls: number;
  }> {
    const facts: PublishedFact[] = [];
    const unverified: UnverifiedFinding[] = [];
    const diagnostics: ResearchDiagnostic[] = [];
    const libraryName = topic.libraryName ?? "stack";
    const version = topic.majorMinor ?? "0.0";
    const cached = await this.ports.cache.getDurable({
      topicHash: topic.topicHash,
      libraryName,
      version,
      now: request.now,
      offline: request.network === "denied",
      projectId: request.projectId,
    });
    if (cached.cache_hit && cached.record) {
      this.publish(request, topic, cached.record.facts, true, "observed", facts);
      return { facts, unverified, diagnostics, tokens: 0, modelCalls: 0 };
    }
    if (cached.status === "stale_offline_fallback" && cached.record) {
      this.publish(request, topic, cached.record.facts, false, "stale_offline_fallback", facts);
      diagnostics.push({
        code: "research_unavailable",
        topicId: topic.id,
        reason: "stale_offline_fallback",
      });
      return { facts, unverified, diagnostics, tokens: 0, modelCalls: 0 };
    }
    if (request.network === "denied") {
      const installed = this.collectInstalled(request, topic, facts, diagnostics);
      if (!installed) {
        diagnostics.push({
          code: "research_unavailable",
          topicId: topic.id,
          reason: "network is denied, the 90-day cache missed, and no installed types proved an API",
        });
      }
      return { facts, unverified, diagnostics, tokens: 0, modelCalls: 0 };
    }
    if (!topic.docUrl) {
      const installed = this.collectInstalled(request, topic, facts, diagnostics);
      if (!installed) {
        diagnostics.push({
          code: "research_unavailable",
          topicId: topic.id,
          reason: "topic has no allowlisted documentation URL and no installed type proof",
        });
      }
      return { facts, unverified, diagnostics, tokens: 0, modelCalls: 0 };
    }
    if (!urlAllowed(topic.docUrl, request.extraAllowHosts ?? [])) {
      diagnostics.push({
        code: "fetch_failed",
        topicId: topic.id,
        reason: "off_allowlist_redirect",
        url: topic.docUrl,
      });
      return { facts, unverified, diagnostics, tokens: 0, modelCalls: 0 };
    }

    let fetched: DocFetchResult | null = null;
    try {
      const outcome = await readCleanDoc(this.ports.fetcher, topic.docUrl);
      if (!outcome.ok) {
        diagnostics.push({
          code: "fetch_failed",
          topicId: topic.id,
          reason: outcome.reason,
          url: outcome.url,
        });
        if (!this.collectInstalled(request, topic, facts, diagnostics)) {
          diagnostics.push({
            code: "research_unavailable",
            topicId: topic.id,
            reason: `fetch_failed:${outcome.reason}`,
          });
        }
        return { facts, unverified, diagnostics, tokens: 0, modelCalls: 0 };
      }
      if (!urlAllowed(outcome.result.finalUrl, request.extraAllowHosts ?? [])) {
        diagnostics.push({
          code: "fetch_failed",
          topicId: topic.id,
          reason: "off_allowlist_redirect",
          url: outcome.result.finalUrl,
        });
        return { facts, unverified, diagnostics, tokens: 0, modelCalls: 0 };
      }
      fetched = outcome.result;
    } catch (error) {
      diagnostics.push({
        code: "fetch_failed",
        topicId: topic.id,
        reason: "unreachable",
        url: topic.docUrl,
      });
      void error;
      return { facts, unverified, diagnostics, tokens: 0, modelCalls: 0 };
    }

    const page = fetched.html ?? fetched.markdown;
    const clean = quarantineWebDoc(page, {
      url: fetched.finalUrl,
      fetchedAt: fetched.fetchedAt,
      pageVersion: fetched.detectedVersion ?? version,
    });
    const installedRef = findInstalled(request, libraryName);
    const pageVersion = majorMinor(fetched.detectedVersion);
    const installedVersion = installedRef ? readInstalledVersion(this.types, installedRef.root) : null;
    if (installedRef && pageVersion !== null && installedVersion !== null && pageVersion !== installedVersion) {
      diagnostics.push({
        code: "version_mismatch",
        topicId: topic.id,
        reason: `web docs ${pageVersion} disagree with installed ${installedVersion}; installed .d.ts wins`,
      });
      const grounded = this.installedFacts(request, topic, installedRef);
      if (grounded.length > 0) {
        await this.remember(request, topic, libraryName, installedVersion, grounded, page, fetched.fetchedAt);
        this.publish(request, topic, grounded, false, "observed", facts);
      }
      return { facts, unverified, diagnostics, tokens: 0, modelCalls: 0 };
    }
    const prompt = researcherPrompt(topic, request, clean.wrappedDataBlock);
    const completion = await this.ports.model.complete(prompt);
    const parsed = parseFeatureResearcherV1(completion.output);
    if (!parsed.ok) {
      diagnostics.push({
        code: "schema_rejected",
        topicId: topic.id,
        reason: parsed.errors.join("; "),
      });
      return { facts, unverified, diagnostics, tokens: completion.tokens, modelCalls: 1 };
    }
    if (parsed.value.blocked === true) {
      diagnostics.push({ code: "blocked", topicId: topic.id, reason: parsed.value.reason });
      return { facts, unverified, diagnostics, tokens: completion.tokens, modelCalls: 1 };
    }
    if (parsed.value.open_contradictions.length > 0) {
      diagnostics.push({
        code: "open_contradiction",
        topicId: topic.id,
        reason: "open_contradictions must be empty before a fact becomes observed",
      });
      unverified.push({
        topicId: topic.id,
        claim: parsed.value.topic,
        status: "open_contradiction",
        reason: parsed.value.open_contradictions.map((item) => item.text).join("; "),
      });
      return { facts, unverified, diagnostics, tokens: completion.tokens, modelCalls: 1 };
    }

    const accepted: ResearchFact[] = [];
    for (const claim of parsed.value.claims) {
      const decision = this.decideClaim(request, topic, claim, clean.plainText, fetched, installedRef);
      if (decision.fact) accepted.push(decision.fact);
      if (decision.unverified) unverified.push(decision.unverified);
      if (decision.diagnostic) diagnostics.push(decision.diagnostic);
    }
    if (accepted.length > 0) {
      await this.remember(request, topic, libraryName, version, accepted, page, fetched.fetchedAt);
      this.publish(request, topic, accepted, false, "observed", facts);
    } else if (facts.length === 0 && !this.collectInstalled(request, topic, facts, diagnostics)) {
      diagnostics.push({
        code: "research_unavailable",
        topicId: topic.id,
        reason: "no claim was grounded in the fetched page or the installed types",
      });
    }
    return { facts, unverified, diagnostics, tokens: completion.tokens, modelCalls: 1 };
  }

  private decideClaim(
    request: ResearchRunRequest,
    topic: GeneratedTopic,
    claim: ResearchClaim,
    plainText: string,
    fetched: DocFetchResult,
    installedRef: InstalledPackageRef | null,
  ): {
    readonly fact: ResearchFact | null;
    readonly unverified: UnverifiedFinding | null;
    readonly diagnostic: ResearchDiagnostic | null;
  } {
    const unapproved = unapprovedPackage(claim.text, request.approvedPackages);
    if (unapproved) {
      return {
        fact: null,
        unverified: {
          topicId: topic.id,
          claim: claim.text,
          status: "package_not_allowlisted",
          reason: `${unapproved} is not an approved package`,
        },
        diagnostic: {
          code: "package_not_allowlisted",
          topicId: topic.id,
          reason: `${unapproved} is not an approved package`,
        },
      };
    }
    if (claim.source.url !== fetched.url && claim.source.url !== fetched.finalUrl) {
      return {
        fact: null,
        unverified: {
          topicId: topic.id,
          claim: claim.text,
          status: "unverified_quote",
          reason: "claim source URL was not the fetched document",
        },
        diagnostic: {
          code: "unverified_quote",
          topicId: topic.id,
          reason: "claim cited a URL that was not fetched",
        },
      };
    }
    const quote = this.quotes.match(claim.source.quote, plainText);
    const mentions = apiMentions(`${claim.text}\n${claim.source.quote}`);
    const proofs =
      installedRef && mentions.length > 0
        ? this.types.verifyPackage({
            packageRoot: installedRef.root,
            approvedPackages: request.approvedPackages,
            claims: mentions.map((functionName) => ({
              functionName,
              ...(fetched.detectedVersion ? { docVersion: fetched.detectedVersion } : {}),
            })),
          })
        : [];
    const mismatch = proofs.find((proof) => proof.status === "version_mismatch" || proof.status === "unapproved_package");
    if (mismatch) {
      return {
        fact: null,
        unverified: {
          topicId: topic.id,
          claim: claim.text,
          status: mismatch.status === "unapproved_package" ? "package_not_allowlisted" : "version_mismatch",
          reason: mismatch.reason,
        },
        diagnostic: {
          code: mismatch.status === "unapproved_package" ? "package_not_allowlisted" : "version_mismatch",
          topicId: topic.id,
          reason: mismatch.installedSignature
            ? `${mismatch.reason} Installed signature: ${mismatch.installedSignature}`
            : mismatch.reason,
        },
      };
    }
    const confirmed = proofs.some((proof) => proof.status === "confirmed");
    if (!quote.accepted && !confirmed) {
      return {
        fact: null,
        unverified: {
          topicId: topic.id,
          claim: claim.text,
          status: "unverified_quote",
          reason: quote.reason,
        },
        diagnostic: { code: "unverified_quote", topicId: topic.id, reason: quote.reason },
      };
    }
    const verifiedBy = quote.accepted && confirmed ? "both" : confirmed ? "installed_types" : "quote_matcher";
    return {
      fact: {
        claim: claim.text,
        exactQuote: claim.source.quote.trim(),
        sourceUrl: fetched.finalUrl,
        docVersion: majorMinor(fetched.detectedVersion) ?? topic.majorMinor ?? "0.0",
        fetchedAt: fetched.fetchedAt,
        verifiedBy,
      },
      unverified: null,
      diagnostic: null,
    };
  }

  private collectInstalled(
    request: ResearchRunRequest,
    topic: GeneratedTopic,
    facts: PublishedFact[],
    diagnostics: ResearchDiagnostic[],
  ): boolean {
    const libraryName = topic.libraryName;
    if (!libraryName) return false;
    const installedRef = findInstalled(request, libraryName);
    if (!installedRef) return false;
    if (!request.approvedPackages.includes(installedRef.packageName)) {
      diagnostics.push({
        code: "package_not_allowlisted",
        topicId: topic.id,
        reason: `${installedRef.packageName} is not an approved package`,
      });
      return false;
    }
    const grounded = this.installedFacts(request, topic, installedRef);
    if (grounded.length === 0) return false;
    this.remember(
      request,
      topic,
      libraryName,
      grounded[0]?.docVersion ?? libraryName,
      grounded,
      grounded.map((fact) => fact.exactQuote).join("\n"),
      new Date(request.now).toISOString(),
    );
    this.publish(request, topic, grounded, false, "observed", facts);
    return true;
  }

  private installedFacts(
    request: ResearchRunRequest,
    topic: GeneratedTopic,
    installedRef: InstalledPackageRef,
  ): ResearchFact[] {
    if (!request.approvedPackages.includes(installedRef.packageName)) return [];
    let surface;
    try {
      surface = this.types.describeInstalled(installedRef.root);
    } catch (error) {
      void error;
      return [];
    }
    if (!request.approvedPackages.includes(surface.packageName)) return [];
    const fetchedAt = new Date(request.now).toISOString();
    return surface.exports.map((item) => exportFact(surface.packageName, surface.installedVersion, item, fetchedAt));
  }

  private async remember(
    request: ResearchRunRequest,
    topic: GeneratedTopic,
    libraryName: string,
    version: string,
    facts: readonly ResearchFact[],
    sourceHtml: string,
    fetchedAt: string,
  ): Promise<void> {
    const fetchedAtMs = Date.parse(fetchedAt);
    await this.ports.cache.putDurable({
      topicHash: topic.topicHash,
      libraryName,
      version,
      facts,
      sourceHtml,
      fetchedAt: Number.isNaN(fetchedAtMs) ? request.now : fetchedAtMs,
      projectId: request.projectId,
      ...(topic.docUrl ? { url: topic.docUrl } : {}),
      ...(topic.majorMinor ? { pageVersion: topic.majorMinor } : {}),
    });
  }

  private publish(
    request: ResearchRunRequest,
    topic: GeneratedTopic,
    sourceFacts: readonly ResearchFact[],
    cacheHit: boolean,
    status: PublishedFact["status"],
    into: PublishedFact[],
  ): void {
    const published = sourceFacts.map((fact) => toPublished(fact, topic, cacheHit, status));
    if (published.length === 0) return;
    into.push(...published);
    if (status !== "observed") return;
    const feature = topic.targetNodeIds[0] ?? null;
    this.ports.graph.commitChangeSet({
      origin: "research",
      author: "feature-researcher@1",
      summary: topic.title,
      nodes: published.map((fact) => ({
        id: fact.nodeId,
        kind: "research_fact",
        title: fact.claim.slice(0, 120),
        text: fact.claim,
        status: "active",
        fields: {
          basis: "observed",
          feature,
          claim: fact.claim,
          exactQuote: fact.exactQuote,
          sourceUrl: fact.sourceUrl,
          docVersion: fact.docVersion,
          fetchedAt: fact.fetchedAt,
          verifiedBy: fact.verifiedBy,
          authoritative: true,
          libraryName: topic.libraryName,
          majorMinor: topic.majorMinor,
          topicHash: topic.topicHash,
        },
      })),
      edges: published.flatMap((fact) =>
        topic.targetNodeIds.map((dst) => ({ src: fact.nodeId, type: "informs" as const, dst })),
      ),
    });
  }
}

function researcherPrompt(
  topic: GeneratedTopic,
  request: ResearchRunRequest,
  wrapped: string,
): FeatureResearcherPrompt {
  return {
    role: "feature-researcher@1",
    topic: topic.title,
    stack: request.stack,
    relatedSpecItems: request.specItems ?? [],
    untrustedDataBlocks: [wrapped],
    tools: EMPTY_TOOLS,
    toolAuthority: "none",
    shell: false,
    networkTools: false,
    writeTools: false,
  };
}

function findInstalled(request: ResearchRunRequest, libraryName: string): InstalledPackageRef | null {
  return request.installedPackages?.find((item) => item.packageName === libraryName) ?? null;
}

function readInstalledVersion(verifier: InstalledTypeApiVerifier, packageRoot: string): string | null {
  try {
    return verifier.describeInstalled(packageRoot).installedMajorMinor;
  } catch (error) {
    void error;
    return null;
  }
}

function exportFact(
  packageName: string,
  version: string,
  item: InstalledExport,
  fetchedAt: string,
): ResearchFact {
  return {
    claim: `${packageName} exports ${item.signature}`,
    exactQuote: item.signature,
    sourceUrl: `local:${packageName}@${version}`,
    docVersion: majorMinor(version) ?? version,
    fetchedAt,
    verifiedBy: "installed_types",
  };
}

function toPublished(
  fact: ResearchFact,
  topic: GeneratedTopic,
  cacheHit: boolean,
  status: PublishedFact["status"],
): PublishedFact {
  return {
    ...fact,
    cache_hit: cacheHit,
    tokens: 0,
    topicId: topic.id,
    nodeId: `RF-${sha256Hex(`${topic.id}\n${fact.claim}\n${fact.exactQuote}\n${fact.sourceUrl}`).slice(0, 16)}`,
    status,
    authoritative: status === "observed",
  };
}

function apiMentions(text: string): string[] {
  const found = new Set<string>();
  for (const match of text.matchAll(/\b[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+\b/g)) {
    if (match[0]) found.add(match[0]);
  }
  for (const match of text.matchAll(/\b[a-z][A-Za-z0-9]*[A-Z][A-Za-z0-9]*\b/g)) {
    if (match[0]) found.add(match[0]);
  }
  return [...found];
}

async function readCleanDoc(fetcher: SecureDocFetcherPort, url: string): Promise<DocFetchOutcome> {
  if (fetcher.fetchCleanDoc) return fetcher.fetchCleanDoc(url, { role: "researcher" });
  return fetcher.fetchDocs(url, { role: "researcher" });
}

function unapprovedPackage(text: string, approved: readonly string[]): string | null {
  const names = new Set<string>();
  for (const match of text.matchAll(/\b([a-z0-9._-]+)@\d+\.\d+(?:\.\d+)?\b/gi)) {
    const name = match[1];
    if (name) names.add(name);
  }
  for (const match of text.matchAll(/\bpackage\s+([a-z0-9._-]+)/gi)) {
    const name = match[1];
    if (name) names.add(name);
  }
  for (const name of names) {
    if (!approved.includes(name)) return name;
  }
  return null;
}
