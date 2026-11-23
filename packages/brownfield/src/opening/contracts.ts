import type { ObservedCriterionSettlement, PerfBaselineCapture, PerfSurfaceSpec } from "./types.js";

/** Minimal L0 facts consumed from Task 166 `BrownfieldL0RepoScanner`. */
export interface L0StackSnapshot {
  readonly languagePrimary: string | null;
  readonly frameworks: readonly string[];
  readonly orms: readonly string[];
  readonly uiKits: readonly string[];
  readonly testRunners: readonly string[];
  readonly testFileCount: number;
  readonly authLibraries: readonly string[];
  readonly stackSummaryLine: string;
  readonly configFiles: readonly string[];
  readonly contributorDocPaths: readonly string[];
}

export interface BrownfieldL0RepoScannerPort {
  scanSummary(repoRoot: string): L0StackSnapshot;
}

export interface CodeMapModule {
  readonly id: string;
  readonly label: string;
  readonly paths: readonly string[];
  readonly hubScore: number;
}

/** Consumed from Task 167 `CompactCodeMapQueryService`. */
export interface CompactCodeMapQueryServicePort {
  listModulesForPaths(paths: readonly string[]): readonly CodeMapModule[];
  entryRoutes(): readonly string[];
}

export interface ModuleCardSummary {
  readonly moduleId: string;
  readonly purpose: string;
  readonly keyExports: readonly string[];
}

export interface StaleDocFinding {
  readonly path: string;
  readonly reason: string;
}

/** Consumed from Task 168 `ModuleCardCacheEngine` and `StaleDocsDetector`. */
export interface ModuleCardCacheEnginePort {
  cardsForModuleIds(moduleIds: readonly string[]): readonly ModuleCardSummary[];
}

export interface StaleDocsDetectorPort {
  detectStaleDocs(): readonly StaleDocFinding[];
}

export interface DiscoveryPreSettlementInput {
  readonly workItemId: string;
  readonly settlements: readonly ObservedCriterionSettlement[];
}

/** Consumed from Task 069 `DiscoverySessionCoordinator`. */
export interface DiscoverySessionCoordinatorPort {
  preSettleObservedCriteria(input: DiscoveryPreSettlementInput): {
    readonly applied: number;
    readonly skippedGreenfieldStackQuestions: true;
  };
}

export interface WorkItemPersistencePort {
  insertWorkItem(row: {
    readonly id: string;
    readonly dbKind: import("./types.js").WorkItemDbKind;
    readonly kind: import("./types.js").BrownfieldWorkKind;
    readonly title: string;
    readonly status: "discovering";
    readonly createdAtMs: number;
  }): void;
  listWorkItems(): readonly import("./types.js").BrownfieldWorkItemRow[];
}

export interface SqlExplainPort {
  explainAnalyze(query: string, params?: readonly unknown[]): PerfBaselineCapture;
}

export interface TimingBenchmarkPort {
  measureP95(surface: PerfSurfaceSpec): number;
}

export interface RepoFileReaderPort {
  readText(relativePath: string): string | null;
  listPathsMatching(globPrefix: string): readonly string[];
}

export interface GitLogPort {
  recentCommitSubjects(limit: number): readonly string[];
}