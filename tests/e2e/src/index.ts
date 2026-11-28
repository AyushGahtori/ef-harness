export const packageName = "@ef-harness/e2e" as const;
export const layer = 5 as const;

export function packageIdentity(): {
  readonly name: typeof packageName;
  readonly layer: typeof layer;
} {
  return { name: packageName, layer };
}

export {
  KitchenHiddenAcceptanceSuite,
  runHiddenSuite,
} from "../m2-exit-gate/hidden-suite.js";
export {
  FORENSICS_DIR,
  M2KitchenE2eBenchmarkRunner,
  OPENING_PREFIX,
  evaluateExitGate,
  harnessRoot,
  leakedPidProbe,
  oracleAuthorVisibleExample,
  paperworkPct,
  renderReport,
  runCertifiedReplay,
  runDefectCutoff,
  runEmailMismatch,
  runForensicsDrill,
  runLiveCertification,
  traceDigest,
} from "../m2-exit-gate/runner.js";
export { executePipeline } from "../m2-exit-gate/pipeline.js";
export type {
  BaselineMetrics,
  ContradictionLayer,
  GateDecision,
  HiddenCheckResult,
  LiveCertification,
  M2ExitGateReport,
  PipelineTrace,
  SettledDiscovery,
  SuiteOutcome,
  SuiteTarget,
  TokenSplit,
} from "../m2-exit-gate/types.js";
export {
  M3ParallelBenchmarkRunner,
  M3ScaleAndLatencyCertifier,
  M3SteeringAndUndoScenarioSuite,
} from "../m3-exit-gate/index.js";
export { M3_EXIT_GATE_REPORT_SCHEMA } from "../m3-exit-gate/report.js";
