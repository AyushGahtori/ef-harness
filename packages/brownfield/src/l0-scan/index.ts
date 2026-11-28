export type {
  L0ScanResult,
  L0SnapshotCache,
  StackDetection,
  ChurnAnalysis,
  MonorepoFacts,
  ScopePickerOption,
  DocInventoryEntry,
  SensitivePathMeta,
} from "./types.js";

export {
  BrownfieldL0RepoScanner,
  StackAndFrameworkDetector,
  GitChurnHotspotAnalyzer,
  MonorepoWorkspacePicker,
  ObservedRepoFactsPersister,
  SafetyScanner,
  createMinGitRepoInspector,
  InMemoryKnowledgeGraphRepo,
  InMemoryStateMetaStore,
} from "./brownfield-l0-repo-scanner.js";

export type { BrownfieldL0ScanOptions } from "./brownfield-l0-repo-scanner.js";
export type {
  KnowledgeGraphRepoPort,
  StateMetaStore,
  ObservedNodeInput,
} from "./knowledge-graph-port.js";
export type { MinGitRepoInspectorPort, MinGitCommandRunner } from "./git-exec.js";
export { openSqliteObservedFacts, type SqliteObservedFacts } from "./sqlite-observed-store.js";
export { isSensitivePath } from "./sensitive.js";