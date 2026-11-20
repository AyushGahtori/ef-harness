export const packageName = "@ef-harness/sim" as const;
export const layer = 1 as const;

export function packageIdentity(): {
  readonly name: typeof packageName;
  readonly layer: typeof layer;
} {
  return { name: packageName, layer };
}

export {
  ClientStateSyncer,
  CrashFaultInjector,
  CrashSignal,
  DeterministicSeededRng,
  DiskCasStore,
  FAULT_POINTS,
  FakeDualClock,
  FakeModelAdapter,
  KernelSession,
  M0KernelSimulator,
  M0_EXIT_REPORT_PATH,
  MODEL_OUTCOMES,
  MemoryCasStore,
  ReserveRefused,
  SimEventLoop,
  SimTrace,
  checkInvariants,
  exerciseNamedPipe,
  faultForSeed,
  measureBoardQuery,
  measureM0Performance,
  measureWriteLatency,
  minimizeFailingSeed,
  percentile,
  planFromSeed,
  renderM0ExitReport,
  replaySeed,
  runM0ExitCertification,
  runReplayCli,
  runSimulation,
  runSweep,
  scriptedCompletion,
  summarize,
  writeM0ExitReport,
} from "./m0/index.js";
export type {
  CasStore,
  ClientSnapshot,
  DbHandle,
  FaultPoint,
  InvariantInput,
  LeaseInterval,
  MinimizeResult,
  ModelCompletion,
  ModelOutcomeKind,
  ModelRequest,
  OutboxProjection,
  PerfResult,
  PruneRecord,
  SimPlan,
  SimRunOptions,
  SimRunResult,
  SimStats,
  SweepOptions,
  SweepReport,
  TaskProjection,
} from "./m0/index.js";
