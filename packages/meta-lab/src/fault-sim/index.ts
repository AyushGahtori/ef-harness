export { Xoshiro256ssRng } from "./rng.js";
export { FakeDualClock } from "./clock.js";
export {
  TX_BOUNDARY_HOOKS,
  FAULT_CLASSES,
  type TxBoundaryHook,
  type FaultClass,
  type ScheduledFault,
  type FaultEvent,
  type FaultCoverageMatrix,
  type ChaosRunResult,
  type ChaosSweepResult,
  type ChaosInvariantSnapshot,
} from "./types.js";
export { TxBoundaryCrashInjector, type CrashFaultPoint } from "./tx-boundary-crash-injector.js";
export { CrashSignal } from "./crash-signal.js";
export { SeededChaosScenarioMatrix } from "./scenario-matrix.js";
export {
  emptyCoverageMatrix,
  recordFaultHit,
  mergeCoverage,
  coverageReportJson,
} from "./coverage-matrix.js";
export { ChaosInvariantOracle } from "./chaos-invariant-oracle.js";
export {
  FullDaemonFaultSimulator,
  CI_CHAOS_SEED_COUNT,
  NIGHTLY_CHAOS_SEED_COUNT,
  faultTraceIdentical,
  type ChaosRunOptions,
} from "./full-daemon-fault-simulator.js";
export { MinimalFaultReproducerExporter, type MinimizeResult } from "./minimal-reproducer.js";
export { writeChaosTrendReceipt, type ChaosTrendReceipt } from "./trend-recorder.js";
export { SimulatedDaemonStack, makeEphemeralRoot, removeEphemeralRoot } from "./daemon-stack.js";