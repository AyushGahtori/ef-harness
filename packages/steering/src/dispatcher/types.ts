export const STOP_STATE_DEADLINE_MS = 100;
export const QUERY_DEADLINE_MS = 2_000;
export const JOB_KILL_DEADLINE_MS = 500;
export const PAUSE_GRACE_MS = 15_000;
export const STOP_INTERRUPT_GRACE_MS = 40;

export const DELTA_TASK_CEILING = 5;
export const DELTA_COST_CEILING_MICRO_USD = 1_000_000n;
export const DELTA_WINDOW_CEILING_PPM = 20_000;

export const USER_PAUSED_REASON = "user_paused";
export const REQUIREMENT_CHANGE_REASON = "requirement_change";

export const CLAUSE_RANK = {
  stop: 0,
  control: 0,
  answer: 1,
  edit: 2,
  add: 3,
  query: 4,
} as const;

export type RouteNumber = 1 | 2 | 3 | 4;
export type ChangeClass = "cosmetic" | "clarifying" | "compatible" | "breaking";
export type ClauseKind = keyof typeof CLAUSE_RANK;
export type FeatureStatus = "active" | "building" | "deferred" | "undone" | "discovering" | "archived";
export type WorkerKind = "native" | "foreign" | "rehearsal";
export type WorkerState = "running" | "held" | "interrupted" | "checkpointed" | "cancelled" | "skipped";
export type ControlState = "RUNNING" | "PAUSED" | "STOPPED";

export type ExecutionControlName =
  | "stop_now"
  | "pause_build"
  | "pause_feature"
  | "resume"
  | "cancel_task"
  | "retry_task"
  | "switch_preset"
  | "skip_optional_task";

export class SteeringError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "SteeringError";
  }
}

export class StoppedEpochMismatchError extends SteeringError {
  constructor(message = "candidate merge rejected because control_epoch no longer matches") {
    super("STOPPED_EPOCH_MISMATCH", message);
    this.name = "StoppedEpochMismatchError";
  }
}

export class ReadOnlyViolationError extends SteeringError {
  constructor(message = "read-only query mutated steering state") {
    super("READ_ONLY_VIOLATION", message);
    this.name = "ReadOnlyViolationError";
  }
}

export class RouteLatencyError extends SteeringError {
  constructor(code: string, message: string) {
    super(code, message);
    this.name = "RouteLatencyError";
  }
}

export class JobLeakError extends SteeringError {
  constructor(readonly survivingPids: readonly number[]) {
    super("JOB_LEAK", `stop left ${survivingPids.join(", ")} child processes alive`);
    this.name = "JobLeakError";
  }
}

export class TaskControlError extends SteeringError {
  constructor(code: string, message: string) {
    super(code, message);
    this.name = "TaskControlError";
  }
}

export interface Citation {
  readonly kind: "node" | "task" | "file" | "receipt";
  readonly id: string;
  readonly label: string;
  readonly href: string;
}

export interface OwnerAnswer {
  readonly text: string;
  readonly citations: readonly Citation[];
  readonly grounded: boolean;
  readonly guessed: false;
  readonly llmCalls: 0;
}

export interface RevisionEdit {
  readonly targetId: string;
  readonly beforeText: string;
  readonly afterText: string;
  readonly requestedClass?: ChangeClass;
  readonly destructiveMigration?: boolean;
  readonly unresolvedMustAsk?: boolean;
  readonly unresolvedConflict?: boolean;
  readonly newPackages?: readonly string[];
  readonly externalEffects?: readonly string[];
  readonly estimatedCostMicroUsd?: bigint;
  readonly estimatedWindowPpm?: number;
}

export interface ClassifiedChange {
  readonly changeClass: ChangeClass;
  readonly reasons: readonly string[];
  readonly floorApplied: boolean;
}

export interface ImpactedSubgraph {
  readonly affectedActiveTasks: readonly string[];
  readonly affectedDecisions: readonly string[];
  readonly affectedRequirements: readonly string[];
  readonly affectedContracts: readonly string[];
  readonly affectedScreens: readonly string[];
  readonly affectedMergedTasks: readonly string[];
  readonly affectedChecks: readonly string[];
}

export interface RevisionBatchRecord {
  readonly revisionId: string;
  readonly changeClass: ChangeClass;
  readonly holdTaskIds: readonly string[];
  readonly llmCalls: 0;
}

export interface RevisionCandidate {
  readonly revisionId: string;
  readonly deltaTasks: number;
  readonly deltaCostMicroUsd: bigint;
  readonly deltaPlanWindowPpm: number;
  readonly breakingContract: boolean;
  readonly destructiveMigration: boolean;
  readonly unresolvedMustAsk: boolean;
  readonly unresolvedConflict: boolean;
  readonly newPackages: readonly string[];
  readonly externalEffects: readonly string[];
  readonly nowMs: number;
}

export interface AutoStartDecision {
  readonly autoStart: boolean;
  readonly openPlanPreview: boolean;
  readonly triggers: readonly string[];
  readonly reasons: readonly string[];
  readonly undoable: boolean;
}

export interface TaskHold {
  readonly taskId: string;
  readonly reason: string;
  readonly source: string;
  readonly createdAtMs: number;
}

export interface DiscoveryAnswer {
  readonly id: string;
  readonly text: string;
}

export interface FeatureRecord {
  readonly featureId: string;
  readonly slug: string;
  readonly title: string;
  readonly status: FeatureStatus;
  readonly scope: string;
  readonly settledAnswers: readonly DiscoveryAnswer[];
  readonly wave: number | null;
  readonly priorStatus: FeatureStatus | null;
  readonly originMsgSeq: string | null;
  readonly emptyStub: boolean;
}

export interface FeatureMatch {
  readonly feature: FeatureRecord;
  readonly score: number;
}

export interface EvidenceRecord {
  readonly id: string;
  readonly kind: string;
  readonly title: string;
  readonly text: string;
  readonly featureId: string | null;
  readonly taskId: string | null;
  readonly file: string | null;
}

export interface WorkerRecord {
  readonly id: string;
  readonly featureId: string;
  readonly taskId: string;
  readonly kind: WorkerKind;
  readonly state: WorkerState;
  readonly checkpointRef: string;
  readonly atCheckpointBoundary: boolean;
  readonly worktreePath: string | null;
  readonly worktreeStatus: "dirty" | "reset" | null;
  readonly pid: number | null;
  readonly jobId: string | null;
}

export interface TaskRecord {
  readonly taskId: string;
  readonly featureId: string;
  readonly title: string;
  readonly state: string;
  readonly optional: boolean;
  readonly attempt: number;
  readonly active: boolean;
}

export interface BudgetSnapshot {
  readonly spentMicroUsd: bigint;
  readonly capMicroUsd: bigint;
  readonly windowUsedPpm: number;
  readonly windowCapPpm: number;
}

export interface FeatureCostEstimate {
  readonly costMicroUsd: bigint;
  readonly windowPpm: number;
}

export interface MiniDiscoverySession {
  readonly sessionId: string;
  readonly featureId: string;
  readonly criteria: readonly string[];
  readonly preservedAnswerIds: readonly string[];
  readonly haltUnrelatedWorkers: false;
}

export interface SteeringClause {
  readonly id: string;
  readonly kind: ClauseKind;
  readonly text: string;
  readonly targetId: string | null;
  readonly index: number;
}

export interface JobHandle {
  readonly id: string;
  readonly name: string;
}

export interface SpawnedProcess {
  readonly pid: number;
  readonly jobId: string;
}

export interface JobTermination {
  readonly jobId: string;
  readonly interruptedPids: readonly number[];
  readonly escalatedPids: readonly number[];
  readonly survivingPids: readonly number[];
  readonly elapsedMs: number;
}

export interface CandidateAcceptInput {
  readonly workerId: string;
  readonly featureId: string;
  readonly taskId: string;
  readonly commitRef: string;
  readonly artifactRef: string;
  readonly observedEpoch?: number;
}

export interface QuarantinedSubmission {
  readonly workerId: string;
  readonly featureId: string;
  readonly taskId: string;
  readonly commitRef: string;
  readonly artifactRef: string;
  readonly observedEpoch: number;
  readonly controlEpoch: number;
  readonly code: "STOPPED_EPOCH_MISMATCH";
}

export interface ProjectRuntimeView {
  readonly phase: string;
  readonly state: string;
  readonly controlState: ControlState;
  readonly controlEpoch: number;
  readonly paused: boolean;
  readonly claimNewTasks: boolean;
  readonly integrationHead: string;
  readonly featureHeads: Readonly<Record<string, string>>;
  readonly presetId: string;
  readonly currentWave: number;
  readonly productionStamp: string;
  readonly demoStamp: string;
  readonly llmCalls: number;
}

export interface ReadOnlyQueryInput {
  readonly msgSeq: string;
  readonly text: string;
}

export interface ExistingFeatureChangeInput {
  readonly msgSeq: string;
  readonly targetId: string;
  readonly edit: RevisionEdit;
  readonly nowMs?: number;
}

export interface NewFeatureAdditionInput {
  readonly msgSeq: string;
  readonly text: string;
  readonly openCriteria?: readonly string[];
  readonly completelyDisjoint?: boolean;
  readonly estimatedCostMicroUsd?: bigint;
  readonly estimatedWindowPpm?: number;
  readonly nowMs?: number;
}

export interface ExecutionControlInput {
  readonly msgSeq: string;
  readonly control: ExecutionControlName;
  readonly featureId?: string;
  readonly featureTitle?: string;
  readonly taskId?: string;
  readonly presetId?: string;
  readonly graceMs?: number;
  readonly interruptGraceMs?: number;
}

export interface WrongRouteChoice {
  readonly receiptId: string;
  readonly route: 2;
  readonly targetId: string;
}

export interface ReceiptDetail {
  readonly answer: string | null;
  readonly citations: readonly Citation[];
  readonly holdsAdded: readonly string[];
  readonly warning: string | null;
  readonly planDeltaPreview: boolean;
  readonly autoStarted: boolean;
  readonly undoable: boolean;
  readonly featureId: string | null;
  readonly featureTitle: string | null;
  readonly revived: boolean;
  readonly preservedAnswerIds: readonly string[];
  readonly scheduledWave: number | null;
  readonly llmCalls: number;
  readonly latencyMs: number;
  readonly stateFlipMs: number | null;
  readonly control: ExecutionControlName | null;
  readonly workersStillRunning: number;
  readonly checkpointRefs: readonly string[];
  readonly changeClass: ChangeClass | null;
  readonly revisionId: string | null;
  readonly discoverySessionId: string | null;
  readonly quarantined: boolean;
  readonly originalText: string | null;
}

export interface RouteTrace {
  askOwnerCalls: number;
  classifierCalls: number;
  walkerCalls: number;
  propagatorCalls: number;
  policyCalls: number;
  discoveryCalls: number;
  llmCalls: number;
}

export interface Sleeper {
  sleep(ms: number): Promise<void>;
}

export interface Clock {
  now(): number;
}

export interface LlmPort {
  complete(prompt: string): string;
}

export interface WorkerSeed {
  readonly id: string;
  readonly featureId: string;
  readonly taskId: string;
  readonly kind?: WorkerKind;
  readonly checkpointRef: string;
  readonly atCheckpointBoundary?: boolean;
  readonly worktreePath?: string;
}

export interface TaskSeed {
  readonly taskId: string;
  readonly featureId: string;
  readonly title: string;
  readonly state?: string;
  readonly optional?: boolean;
  readonly attempt?: number;
  readonly active?: boolean;
}

export interface FeatureSeed {
  readonly featureId: string;
  readonly slug?: string;
  readonly title: string;
  readonly status?: FeatureStatus;
  readonly scope?: string;
  readonly settledAnswers?: readonly DiscoveryAnswer[];
  readonly wave?: number | null;
}

export interface EvidenceSeed {
  readonly id: string;
  readonly kind?: string;
  readonly title: string;
  readonly text: string;
  readonly featureId?: string | null;
  readonly taskId?: string | null;
  readonly file?: string | null;
}

export interface BudgetSeed {
  readonly spentMicroUsd: bigint;
  readonly capMicroUsd: bigint;
  readonly windowUsedPpm: number;
  readonly windowCapPpm: number;
}

export interface DispatcherSeed {
  readonly phase?: string;
  readonly currentWave?: number;
  readonly integrationHead?: string;
  readonly presetId?: string;
  readonly workers?: readonly WorkerSeed[];
  readonly tasks?: readonly TaskSeed[];
  readonly features?: readonly FeatureSeed[];
  readonly evidence?: readonly EvidenceSeed[];
  readonly impact?: Readonly<Record<string, readonly string[]>>;
  readonly budget?: BudgetSeed;
  readonly productionStamp?: string;
  readonly demoStamp?: string;
  readonly sleeper?: Sleeper;
  readonly clock?: Clock;
  readonly llm?: LlmPort;
}
