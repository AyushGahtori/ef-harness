export { UiConsistencyPipeline } from "./ui-consistency-pipeline.js";
export type { UiConsistencyPipelineDeps } from "./ui-consistency-pipeline.js";
export { DuplicateComponentDetector, splitUiSources } from "./duplicate-component-detector.js";
export { ThreeWidthLayoutAndTapTargetChecker } from "./three-width-tap-target-checker.js";
export { CrossScreenRhythmAuditor } from "./cross-screen-rhythm-auditor.js";
export {
  ApprovedScreenshotRegressionRunner,
  solidFrame,
} from "./approved-screenshot-regression-runner.js";
export type { ScreenshotRegressionInput } from "./approved-screenshot-regression-runner.js";
export { runTokenDisciplineStage } from "./token-discipline-stage.js";
export { axeGatePassed, runAxeAccessibilityGate } from "./axe-accessibility-gate.js";
export { InMemoryCasStore } from "./cas-store.js";
export {
  CANONICAL_VIEWPORTS,
  DUPLICATE_SIMILARITY_THRESHOLD,
  MIN_TAP_TARGET_PX,
  SCREENSHOT_TOLERANCE,
  STAGE_ORDER,
  UNAPPROVED_IMAGE_HOSTS,
} from "./constants.js";
export type { CanonicalViewportId } from "./constants.js";
export {
  LandedBeforeAfterBaseline,
  LandedBrandAssetRegistry,
  LandedCasStore,
  LandedDesignTokenLint,
  LandedStaticAuditGate,
  LandedTasteReviewer,
  defaultConsumedPorts,
  openLandedCas,
} from "./local-ports.js";
export type {
  BeforeAfterBaselinePort,
  BrandAssetRegistryPort,
  CasStorePort,
  DesignTokenLintPort,
  StaticAuditGatePort,
  TasteReviewerPort,
} from "./ports.js";
export {
  buildMaskedPixelSet,
  compareRasterFrames,
  findingFromVisualDiff,
  packageVisualDiffArtifacts,
} from "./visual-diff-artifacts.js";
export type {
  ApprovedBaselineRef,
  AxeViolation,
  BoundingBox,
  CasArtifactRecord,
  RasterFrame,
  RenderedElement,
  RenderedRouteAudit,
  RepoFileSlice,
  ScreenRhythmMetrics,
  SourceLocation,
  TasteReviewResult,
  ThemeMode,
  UiConsistencyFinding,
  UiConsistencyPipelineInput,
  UiConsistencyPipelineResult,
  UiConsistencyStageId,
  UiConsistencyStageResult,
  UiConsistencyStageStatus,
  UiProjectKind,
} from "./types.js";