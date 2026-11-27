export { LOCAL_RESEARCHER_DOC_HOSTS, hostAllowed, urlAllowed } from "./allowlist.js";
export {
  DAY_MS,
  QUOTE_MIN_ALIGNMENT_PERCENT,
  QUOTE_MIN_CHARS,
  RESEARCH_BUDGET_DENOMINATOR,
  RESEARCH_BUDGET_NUMERATOR,
  RESEARCH_CACHE_TTL_MS,
  RESEARCHER_ROLE,
  RESEARCHER_TOOL_AUTHORITY,
  canonicalTopicHash,
  majorMinor,
  researchMicroUsdCap,
  researchTokenCap,
  sha256Hex,
  topicCacheDocUrl,
} from "./domain.js";
export type {
  ResearchBudget,
  ResearchFact,
  StackPackage,
  TopicDisposition,
  TopicKind,
  TopicSignal,
  VerifiedBy,
} from "./domain.js";
export { quarantineWebDoc, stripInvisibleUnicode } from "./doc-quarantine.js";
export type { QuarantineMeta, QuarantineResult } from "./doc-quarantine.js";
export { parseFeatureResearcherV1 } from "./feature-researcher-v1.js";
export type {
  FeatureResearcherBlocked,
  FeatureResearcherOutput,
  FeatureResearcherSuccess,
  ResearchClaim,
  ResearchNote,
} from "./feature-researcher-v1.js";
export {
  FeatureResearchOrchestrator,
} from "./feature-research-orchestrator.js";
export type {
  InstalledPackageRef,
  OrchestratorPorts,
  PublishedFact,
  ResearchDiagnostic,
  ResearchRunRequest,
  ResearchRunResult,
  UnverifiedFinding,
} from "./feature-research-orchestrator.js";
export {
  INSTALLED_TYPES_COMPILER,
  InstalledTypeApiVerifier,
} from "./installed-type-api-verifier.js";
export type {
  ApiClaim,
  ApiProofStatus,
  InstalledApiProof,
  InstalledExport,
  InstalledSurface,
} from "./installed-type-api-verifier.js";
export { MemoryKnowledgeGraph } from "./memory-knowledge-graph.js";
export type {
  DocFetchOutcome,
  DocFetchResult,
  FeatureResearcherModel,
  FeatureResearcherPrompt,
  FetchFailureReason,
  GlobalResearchCachePort,
  KnowledgeGraphPort,
  ResearchCacheEntry,
  ResearchCacheWrite,
  SecureDocFetcherPort,
} from "./ports.js";
export { MemoryGlobalResearchCache, ResearchFactCache } from "./research-fact-cache.js";
export type {
  CacheLookup,
  CachePutInput,
  CacheStatus,
  CachedResearchRecord,
  FactBodyStore,
  ResearchFactCacheOptions,
} from "./research-fact-cache.js";
export { adaptSecureDocFetcher, fetchCleanDoc } from "./clean-doc.js";
export { BrokerResearchCache, ProjectStateKnowledgeGraph, casFactBodies } from "./project-state.js";
export { RiskTriggeredTopicGenerator } from "./risk-triggered-topic-generator.js";
export type { GeneratedTopic, TopicPlan } from "./risk-triggered-topic-generator.js";
export { TokenBasedQuoteMatcher } from "./token-based-quote-matcher.js";
export type { QuoteFlag, QuoteMatch, QuoteStatus } from "./token-based-quote-matcher.js";
