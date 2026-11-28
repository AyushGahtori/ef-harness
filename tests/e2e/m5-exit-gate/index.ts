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
} from "./brownfield.js";
export {
  BENCHMARK_FILE,
  DOC_COUNT,
  EXPECTED_OFFICE_TAG,
  PINNED_COMMIT,
  PLAN_FILE_COUNT,
  PLAN_LINE_COUNT,
  REPORT_SCHEMA,
  ROOM_IDS,
} from "./constants.js";
export { loadResumeChangerManifest } from "./manifest.js";
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
} from "./office.js";
export { formatAgentOfficeTag } from "./office-tag.js";
export { M5ExitGateReport, collectReasons, signReport } from "./report.js";
export { runLiveCertification, runM5Certification } from "./runner.js";
export { resolveFaults } from "./types.js";
export type { GateFacts, M5Faults, SignedReport } from "./types.js";
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
} from "./ux.js";
