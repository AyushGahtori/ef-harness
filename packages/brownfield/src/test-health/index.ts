export type {
  BaselineTestClassification,
  BaselineTestHealthReceipt,
  BaselineTestRecord,
  BrokenBuildChoice,
  BrokenBuildGateResult,
  CharacterizationSafetyNetPlan,
  CharacterizationTestSpec,
  CommandReceipt,
  DetectedRepoScripts,
  FlakeClassification,
  ParsedTestCase,
  QuarantinedTestRow,
  RegressionGateResult,
  TestOutcomeStatus,
} from "./types.js";

export type {
  BaselineTestHealthStorePort,
  BrownfieldL0RepoScannerPort,
  GitStatusLine,
  GitWorktreeInspectorPort,
  HarnessCommandResult,
  HarnessRunEnginePort,
  QuarantinedTestsStorePort,
  WorktreeSlot,
  WorktreeSlotPoolPort,
} from "./ports.js";

export {
  BaselineTestHealthRunner,
  type BaselineRunOutcome,
  type BaselineRunRequest,
  type BaselineTestHealthRunnerOptions,
} from "./baseline-test-health-runner.js";
export { BaselineHealthCache, buildBaselineCacheKey } from "./baseline-cache.js";
export { BrokenBuildEntryGate } from "./broken-build-entry-gate.js";
export { CharacterizationSafetyNetPlanner } from "./characterization-safety-net-planner.js";
export { checkWorktreeClean, parseGitPorcelainLine } from "./dirty-tree-check.js";
export { KnownFailingQuarantineStore, type QuarantineTransparencyReceipt } from "./known-failing-quarantine-store.js";
export { ThreeRunFlakeDetector, type FlakeRunFn, type ThreeRunFlakeDetectorOptions } from "./three-run-flake-detector.js";
export {
  errorFingerprint,
  parseTestReporterOutput,
  stableTestId,
  type ReporterParseResult,
} from "./test-reporter-parser.js";

export {
  InMemoryBaselineTestHealthStore,
  InMemoryGitWorktreeInspector,
  InMemoryQuarantinedTestsStore,
  InMemoryWorktreeSlotPool,
  ScriptedHarnessRunEngine,
  StubBrownfieldL0RepoScanner,
  type ScriptedCommand,
} from "./in-memory.js";