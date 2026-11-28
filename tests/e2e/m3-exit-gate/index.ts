export { harnessRoot, loadM3Fixtures } from "./fixtures.js";
export { checkOwner, plantNeedle, promptsLeakHidden, scanTreeForSecrets, secretNeedles } from "./kitchen.js";
export { bisectHalves, landFeatures, trackedViews } from "./merge-queue.js";
export { evaluateM3ExitGate, M3_EXIT_GATE_REPORT_SCHEMA, renderScorecard, signReport } from "./report.js";
export { M3ParallelBenchmarkRunner, runLiveCertification } from "./runner.js";
export { M3ScaleAndLatencyCertifier, certifyBoard, certifyInjectedBoard, certifyInjectedDb, storeWithRealVault } from "./scale.js";
export { M3SteeringAndUndoScenarioSuite, runAdditiveCcr, runFeatureUndo, runGovernorStress, runStopAndResume, runSurgicalHold } from "./scenarios.js";
export { mergesOverlap, scheduleKitchen, scheduleKitchenOn, scheduleWithRetry, speedupAgainst } from "./schedule.js";
export type {
  BaselineMetrics,
  BoardCertificate,
  DbCertificate,
  HiddenSuiteDoc,
  LatencyCurve,
  LiveCertification,
  M3ExitGateReport,
  M3RunSlice,
  MachineProfile,
  MergeCommitRecord,
  MergeReport,
  QueueFeature,
  ScenarioResult,
  ScheduleResult,
  StopProbe,
  WorkGraph,
} from "./types.js";
