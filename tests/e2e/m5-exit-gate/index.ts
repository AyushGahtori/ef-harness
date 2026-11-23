export {
  AiderPageRankCalculator,
  BaselineTestHealthRunner,
  BrownfieldL0RepoScanner,
  BrownfieldOpeningController,
  CodeIndexDatabase,
  EditorCoexistenceWatcher,
  ExistingConventionsExtractor,
  L2PreSpendEstimator,
  RequestDrivenFocusSelector,
  ResumeChangerBenchmarkVerifier,
  StaleDocsDetector,
  TodayVsChangeConfirmationBuilder,
  UiConsistencyPipeline,
  WasmTreeSitterIndexer,
  ZeroStashLandingExecutor,
  loadGuidedChangeFixture,
} from "./brownfield.ts";
export {
  BENCHMARK_FILE,
  DOC_COUNT,
  EXPECTED_OFFICE_TAG,
  PINNED_COMMIT,
  PLAN_FILE_COUNT,
  PLAN_LINE_COUNT,
  REPORT_SCHEMA,
  ROOM_IDS,
} from "./constants.ts";
export { loadResumeChangerManifest } from "./manifest.ts";
export {
  BurstCollapseEventQueue,
  HelperSpriteClusterManager,
  HotDeskOverflowAggregator,
  OfficeCastProjector,
  OfficeFrameBudgetMonitor,
  OfficeReducedMotionAdapter,
  OfficeSemanticMirrorTree,
  OfficeTruthfulnessCertifier,
  OrangePressureAutoBoardFallback,
  TruthfulAnimationDirector,
  seatedCast,
} from "./office.ts";
export { formatAgentOfficeTag } from "./office-tag.ts";
export { M5ExitGateReport, collectReasons, signReport } from "./report.ts";
export { runLiveCertification, runM5Certification } from "./runner.ts";
export { resolveFaults } from "./types.ts";
export type { GateFacts, M5Faults, SignedReport } from "./types.ts";
export {
  BeforeAfterBaselineApprover,
  DevOnlyJsxSourceTagPlugin,
  DictationStabilityStream,
  EditableDictationDraftController,
  IsolatedPreviewWebviewHost,
  LowConfidenceCriticalSpanHighlighter,
  M5InteractiveUxE2eSuite,
  PerTargetDraftStore,
  PersistentDemoDbManager,
  PointToFixPickerOverlay,
  PostSendChangeHighlighter,
  ProjectVerifiedSpokenIdNormalizer,
  RevisionDriftConflictPrompt,
  SavedNodePositionStore,
  SemanticZoomController,
  TargetTypeMismatchGuard,
  TwoOccurrenceCorrectionLearner,
  ZeroTokenImpactPreviewModal,
  greyThenBlack,
} from "./ux.ts";
