import type {
  AutoStartDecision,
  BudgetSnapshot,
  ClassifiedChange,
  EvidenceRecord,
  FeatureCostEstimate,
  FeatureMatch,
  FeatureRecord,
  ImpactedSubgraph,
  JobHandle,
  JobTermination,
  MiniDiscoverySession,
  OwnerAnswer,
  RevisionBatchRecord,
  RevisionCandidate,
  RevisionEdit,
  SpawnedProcess,
  SteeringClause,
  TaskHold,
  WorkerRecord,
} from "./types.js";

/** Local stand-in for Task 102 `AskOwnerResponderEngine.answerQuestion`. */
export interface AskOwnerResponderEnginePort {
  answerQuestion(question: string): OwnerAnswer | Promise<OwnerAnswer>;
}

/** Local stand-in for Task 087 `ChangeClassifier.classify`. */
export interface ChangeClassifierPort {
  classify(edit: RevisionEdit): ClassifiedChange;
}

/** Local stand-in for Task 087 `ReverseImpactWalker.walkCombined`. */
export interface ReverseImpactWalkerPort {
  walkCombined(startIds: readonly string[]): ImpactedSubgraph;
}

/** Local stand-in for Task 087 `DebouncedRevisionPropagator.apply`. */
export interface DebouncedRevisionPropagatorPort {
  apply(input: {
    readonly targetId: string;
    readonly changeClass: ClassifiedChange["changeClass"];
    readonly impactedTaskIds: readonly string[];
    readonly msgSeq: string;
  }): RevisionBatchRecord;
}

/** Local stand-in for Task 108 `RevisionAutoStartPolicy.evaluate`. */
export interface RevisionAutoStartPolicyPort {
  evaluate(candidate: RevisionCandidate): AutoStartDecision;
}

/**
 * Local stand-in for Task 021 `TaskHoldAndSubmissionRepo`.
 * The task text names this dependency `TaskHoldsManager`.
 */
export interface TaskHoldsManagerPort {
  placeHold(taskId: string, reason: string, source: string, createdAtMs: number): TaskHold;
  releaseHold(taskId: string, reason: string): number;
  listActiveHolds(taskId?: string): readonly TaskHold[];
}

/** Local stand-in for Task 017 `KnowledgeGraphRepo` feature and evidence reads. */
export interface KnowledgeGraphRepoPort {
  listFeatures(): readonly FeatureRecord[];
  getFeature(featureId: string): FeatureRecord | null;
  searchFeatures(query: string): readonly FeatureMatch[];
  upsertFeature(feature: FeatureRecord): void;
  readEvidence(query: string): readonly EvidenceRecord[];
  getEvidence(id: string): EvidenceRecord | null;
}

/** Local stand-in for Task 069 discovery. The task text names `DiscoverySessionCoordinator`. */
export interface DiscoverySessionCoordinatorPort {
  openMiniDiscovery(input: {
    readonly featureId: string;
    readonly criteria: readonly string[];
    readonly preservedAnswerIds: readonly string[];
    readonly haltUnrelatedWorkers: false;
  }): MiniDiscoverySession;
  listSessions(): readonly MiniDiscoverySession[];
}

/** Local stand-in for Task 023 remaining project budget. */
export interface ProjectBudgetPort {
  snapshot(): BudgetSnapshot;
  estimate(input: {
    readonly text: string;
    readonly costMicroUsd?: bigint;
    readonly windowPpm?: number;
  }): FeatureCostEstimate;
}

/** Local stand-in for Task 113 `OrderedMultiClauseExecutor`. */
export interface OrderedMultiClauseExecutorPort {
  execute<T>(
    clauses: readonly SteeringClause[],
    run: (clause: SteeringClause) => T | Promise<T>,
  ): Promise<readonly T[]>;
}

/** Local stand-in for Task 041 Windows Job Object supervision (`TerminateJobObject`). */
export interface WindowsJobSupervisorPort {
  createJob(name: string): JobHandle;
  assignProcess(jobId: string, pid: number): void;
  spawnInJob(jobId: string): SpawnedProcess;
  terminateJob(jobId: string, graceMs: number): Promise<JobTermination>;
  terminateAll(graceMs: number): Promise<readonly JobTermination[]>;
  pidAlive(pid: number): boolean;
}

/** Local stand-in for Task 053 native worker interrupt. */
export interface NativeWorkerLoopPort {
  interrupt(workerId: string): void;
  interrupted(): readonly string[];
}

/** Local stand-in for Task 142 foreign runtime interrupt. */
export interface ForeignRuntimeAdapterPort {
  interrupt(workerId: string): void;
  interrupted(): readonly string[];
}

export interface WorkerDirectoryPort {
  list(): readonly WorkerRecord[];
  get(workerId: string): WorkerRecord | null;
}
