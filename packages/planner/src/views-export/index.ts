export { LocalArchDocumentSharder, FEATURE_SHARD_TOKEN_CEILING, estimateTokens, slugify, splitShardGroup } from "./arch-document-sharder.js";
export type { ArchDocumentSharder, ShardAssignment } from "./arch-document-sharder.js";
export { ATOMIC_RENAME_ATTEMPTS, atomicWriteFile, renameReplacing, retryDelayMs } from "./atomic-write.js";
export type { AtomicWriteDeferred, AtomicWriteResult } from "./atomic-write.js";
export { CanonicalizationError, computeNodeContentHash, digestSha256, normalizeLf } from "./canonical-hash.js";
export {
  EF_NODE_CLOSER,
  EfNodeMarkerFormatter,
  escapeMarkerText,
  extractNumericBounds,
  extractTouches,
  parseEfNodeBlocks,
  unescapeMarkerText,
} from "./ef-node-marker.js";
export type { EfNodeBlockInput, ParsedEfNode } from "./ef-node-marker.js";
export { KnowledgeViewExporter } from "./exporter.js";
export type { DbHeadNode, DeferredView, ExportResult, KnowledgeViewExporterOptions, PausedView } from "./exporter.js";
export { GIT_EXCLUDE_ENTRY, GitExcludeGuard, hasExcludeEntry } from "./git-exclude-guard.js";
export type { GitRunner } from "./git-exclude-guard.js";
export { VIEW_WATCH_DEBOUNCE_MS, ViewManifestHashScanner } from "./hash-scanner.js";
export type { ColdOpenReport, DirtyView } from "./hash-scanner.js";
export { MemoryKnowledgeViewSource } from "./knowledge-graph-port.js";
export type { KnowledgeViewSource, ViewEdge, ViewNode } from "./knowledge-graph-port.js";
export { ExportPauseLock, ExportWriteLease } from "./locks.js";
export type { LeaseToken } from "./locks.js";
export { parseManifest, serializeManifest } from "./manifest.js";
export type { ManifestRecord, ViewManifest } from "./manifest.js";
export { renderViewTree } from "./render-views.js";
export { createParcelWatchBackend, loadParcelWatcher } from "./watch-backend.js";
export type { WatchBackend, WatchEvent } from "./watch-backend.js";
