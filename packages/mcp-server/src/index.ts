export const packageName = "@ef-harness/mcp-server" as const;
export const layer = 1 as const;

export function packageIdentity(): {
  readonly name: typeof packageName;
  readonly layer: typeof layer;
} {
  return { name: packageName, layer };
}

export { AttemptMcpServer, responseText } from "./server.js";
export { MCP_TOOL_NAMES, HARNESS_TOOL_NAMES, KB_TOOL_NAMES, resolveVisibleTools } from "./names.js";
export type { McpToolName, HarnessToolName, KbToolName } from "./names.js";
export { CandidateV1Schema } from "./candidate.js";
export { LeaseFencedError, MCP_ERROR_LEASE_FENCED, NOT_FOUND, PULL_QUOTA_MESSAGE } from "./errors.js";
export { MemoryReadSetStore, SqliteReadSetStore, openReadSetDatabase, canonicalSearchQuery, hashSearchResults } from "./read-sets.js";
export { readGitChangedPaths, snapshotWorktreeDiff, pathInWriteScope, globMatch } from "./scope.js";
export {
  bindCommandArtifactPort,
  bindKnowledgeService,
  bindReadResultArtifacts,
  createKernelAttemptMcpDeps,
  ruleMatchesTags,
} from "./kernel-deps.js";
export type { KernelAttemptPorts } from "./kernel-deps.js";
export { generateSearchSnippet, parseIdAtVersion, pinnedVersion } from "./redaction.js";
export { parseDataEnvelope, wrapDataEnvelope } from "./provenance.js";
export type { AttemptMcpDependencies, KbPullPort } from "./types.js";
export type {
  ArtifactManager,
  AskOwner,
  AttemptLease,
  AttemptMcpServerOptions,
  AttemptQuotas,
  BlockedReporter,
  CodeLookup,
  DependencyIntentAppender,
  DisputeTest,
  EpochAuthority,
  HarnessRunEngine,
  KnowledgeNode,
  KnowledgeSearchService,
  LoopbackEndpoint,
  ProgressTelemetry,
  PullPatternLog,
  ReadSetStore,
  SecureDocFetcher,
  SecurityAnomalyLog,
  ShutdownReason,
  StartService,
  TaskHoldAndSubmissionRepo,
  TaskPacketV1,
  WorktreeSnapshotter,
} from "./types.js";
