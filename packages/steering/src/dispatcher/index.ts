import { FourRouteSteeringDispatcher, RouteTelemetry } from "./dispatcher.js";
import { NewFeatureDedupSpawner } from "./dedup-spawner.js";
import { ImmediateKernelStopController } from "./kernel-stop.js";
import {
  LocalAskOwnerResponderEngine,
  LocalChangeClassifier,
  LocalDebouncedRevisionPropagator,
  LocalDiscoverySessionCoordinator,
  LocalForeignRuntimeAdapter,
  LocalKnowledgeGraphRepo,
  LocalNativeWorkerLoop,
  LocalOrderedMultiClauseExecutor,
  LocalProjectBudget,
  LocalReverseImpactWalker,
  LocalRevisionAutoStartPolicy,
  LocalTaskHoldsManager,
  LocalWindowsJobSupervisor,
} from "./local-ports.js";
import { SteeringRuntime } from "./runtime.js";
import type { Clock, DispatcherSeed, Sleeper } from "./types.js";

export { FourRouteSteeringDispatcher, RouteTelemetry } from "./dispatcher.js";
export { NewFeatureDedupSpawner } from "./dedup-spawner.js";
export type { NewFeaturePlan } from "./dedup-spawner.js";
export { ImmediateKernelStopController } from "./kernel-stop.js";
export type { ControlOutcome } from "./kernel-stop.js";
export {
  LocalAskOwnerResponderEngine,
  LocalChangeClassifier,
  LocalDebouncedRevisionPropagator,
  LocalDiscoverySessionCoordinator,
  LocalForeignRuntimeAdapter,
  LocalKnowledgeGraphRepo,
  LocalNativeWorkerLoop,
  LocalOrderedMultiClauseExecutor,
  LocalProjectBudget,
  LocalReverseImpactWalker,
  LocalRevisionAutoStartPolicy,
  LocalTaskHoldsManager,
  LocalWindowsJobSupervisor,
  contentTokens,
  displayTitle,
  featureIdFromTitle,
} from "./local-ports.js";
export { SteeringRuntime } from "./runtime.js";
export {
  MidBuildRouteReceipt,
  addedFeaturePill,
  pauseFeaturePill,
  revivalPill,
} from "./route-receipt.js";
export type { RouteDispatchResult } from "./route-receipt.js";
export type {
  AskOwnerResponderEnginePort,
  ChangeClassifierPort,
  DebouncedRevisionPropagatorPort,
  DiscoverySessionCoordinatorPort,
  ForeignRuntimeAdapterPort,
  KnowledgeGraphRepoPort,
  NativeWorkerLoopPort,
  OrderedMultiClauseExecutorPort,
  ProjectBudgetPort,
  ReverseImpactWalkerPort,
  RevisionAutoStartPolicyPort,
  TaskHoldsManagerPort,
  WindowsJobSupervisorPort,
} from "./ports.js";
export {
  DELTA_COST_CEILING_MICRO_USD,
  DELTA_TASK_CEILING,
  DELTA_WINDOW_CEILING_PPM,
  JOB_KILL_DEADLINE_MS,
  PAUSE_GRACE_MS,
  QUERY_DEADLINE_MS,
  REQUIREMENT_CHANGE_REASON,
  STOP_INTERRUPT_GRACE_MS,
  STOP_STATE_DEADLINE_MS,
  USER_PAUSED_REASON,
  JobLeakError,
  ReadOnlyViolationError,
  RouteLatencyError,
  SteeringError,
  StoppedEpochMismatchError,
  TaskControlError,
} from "./types.js";
export type {
  AutoStartDecision,
  Citation,
  DispatcherSeed,
  ExecutionControlInput,
  ExistingFeatureChangeInput,
  FeatureRecord,
  NewFeatureAdditionInput,
  OwnerAnswer,
  ProjectRuntimeView,
  ReadOnlyQueryInput,
  ReceiptDetail,
  RevisionEdit,
  SteeringClause,
  WrongRouteChoice,
} from "./types.js";

const systemSleeper: Sleeper = {
  sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  },
};

const systemClock: Clock = {
  now(): number {
    return Date.now();
  },
};

export interface SteeringAssembly {
  readonly dispatcher: FourRouteSteeringDispatcher;
  readonly runtime: SteeringRuntime;
  readonly stopController: ImmediateKernelStopController;
  readonly dedup: NewFeatureDedupSpawner;
  readonly jobs: LocalWindowsJobSupervisor;
  readonly clauses: LocalOrderedMultiClauseExecutor;
  readonly nativeWorkers: LocalNativeWorkerLoop;
  readonly foreignAdapters: LocalForeignRuntimeAdapter;
  readonly discovery: LocalDiscoverySessionCoordinator;
  readonly holds: LocalTaskHoldsManager;
  readonly graph: LocalKnowledgeGraphRepo;
  readonly askOwner: LocalAskOwnerResponderEngine;
  readonly telemetry: RouteTelemetry;
}

export function createFourRouteSteeringDispatcher(seed: DispatcherSeed = {}): SteeringAssembly {
  const runtime = new SteeringRuntime(seed);
  const askOwner = new LocalAskOwnerResponderEngine(runtime);
  const classifier = new LocalChangeClassifier();
  const walker = new LocalReverseImpactWalker(runtime);
  const propagator = new LocalDebouncedRevisionPropagator();
  const policy = new LocalRevisionAutoStartPolicy();
  const holds = new LocalTaskHoldsManager(runtime);
  const graph = new LocalKnowledgeGraphRepo(runtime);
  const discovery = new LocalDiscoverySessionCoordinator();
  const budget = new LocalProjectBudget(runtime);
  const clauses = new LocalOrderedMultiClauseExecutor();
  const jobs = new LocalWindowsJobSupervisor();
  const nativeWorkers = new LocalNativeWorkerLoop();
  const foreignAdapters = new LocalForeignRuntimeAdapter();
  const stopController = new ImmediateKernelStopController(
    runtime,
    holds,
    jobs,
    nativeWorkers,
    foreignAdapters,
    seed.sleeper ?? systemSleeper,
    seed.clock ?? systemClock,
  );
  const dedup = new NewFeatureDedupSpawner(runtime, graph, discovery, budget, policy);
  const telemetry = new RouteTelemetry();
  const dispatcher = new FourRouteSteeringDispatcher(
    runtime,
    stopController,
    dedup,
    askOwner,
    classifier,
    walker,
    propagator,
    policy,
    holds,
    telemetry,
    clauses,
  );
  return {
    dispatcher,
    runtime,
    stopController,
    dedup,
    jobs,
    clauses,
    nativeWorkers,
    foreignAdapters,
    discovery,
    holds,
    graph,
    askOwner,
    telemetry,
  };
}
