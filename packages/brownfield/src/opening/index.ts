export { BrownfieldOpeningController, type BrownfieldOpeningControllerDeps } from "./brownfield-opening-controller.js";
export { ContributorDocIngestion, isHostileContributorDoc } from "./contributor-doc-ingestion.js";
export { ExistingConventionsExtractor } from "./existing-conventions-extractor.js";
export {
  MeasurablePerfInterviewFlow,
  SqliteExplainAnalyzeRunner,
} from "./measurable-perf-interview-flow.js";
export { MixedRequestWorkItemSplitter, dbKindForDraft } from "./mixed-request-work-item-splitter.js";
export { ObservedStackPresettler } from "./observed-stack-presettler.js";
export { AntiRewriteScopeFence } from "./scope-fence.js";
export { TodayVsChangeConfirmationBuilder } from "./today-vs-change-confirmation-builder.js";
export { InMemoryWorkItemStore } from "./work-item-store.js";
export { BROWNFIELD_QUICK_PROMPTS, estimateTokens, mapBrownfieldKindToDb } from "./types.js";
export type {
  BrownfieldConfirmationCard,
  BrownfieldOpeningSummary,
  BrownfieldQuickPromptId,
  BrownfieldWorkItemDraft,
  BrownfieldWorkItemRow,
  BrownfieldWorkKind,
  CanvasModuleOverlay,
  CanvasLayer,
  ConventionsCard,
  ContributorDocHint,
  ObservedCriterionSettlement,
  PerfBaselineCapture,
  PerfInterviewState,
  PerfSurfaceSpec,
  PerfTargetThreshold,
  ScopeFenceModule,
  TodayChangeCanvasProjection,
  WorkItemDbKind,
} from "./types.js";
export type {
  BrownfieldL0RepoScannerPort,
  CodeMapModule,
  CompactCodeMapQueryServicePort,
  DiscoverySessionCoordinatorPort,
  GitLogPort,
  L0StackSnapshot,
  ModuleCardCacheEnginePort,
  ModuleCardSummary,
  RepoFileReaderPort,
  SqlExplainPort,
  StaleDocFinding,
  StaleDocsDetectorPort,
  TimingBenchmarkPort,
  WorkItemPersistencePort,
} from "./contracts.js";