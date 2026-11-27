export const WORKER_TOOLS = ["kb.get_fact", "kb.contract", "kb.code", "harness.run"] as const;

export const SANDBOX_PROFILE = {
  network: "deny" as const,
  owner: "task-045" as const,
};

export const BASIS_ORDER = ["explicit", "derived", "observed", "proposed", "delegated", "defaulted"] as const;

export type RequirementBasis = (typeof BASIS_ORDER)[number];

export type RunnerStatus =
  | "running"
  | "idle"
  | "idle_waiting_on_user"
  | "paused_infrastructure"
  | "paused_budget"
  | "stopped"
  | "submission_pending"
  | "wave_transition_halted"
  | "completion_wave_launched";

export type PhaseName =
  | "CLAIMED"
  | "WORKING"
  | "VERIFYING"
  | "ACCEPTED"
  | "MERGED"
  | "RETRY_HINT_1"
  | "RETRY_HINT_2"
  | "RETRY_HINT_3"
  | "ESCALATED"
  | "PARKED"
  | "SUBMISSION_PENDING"
  | "SUSPENDED"
  | "WRITE_SCOPE_REJECTED"
  | "SMOKE_ROLLBACK"
  | "LEAVES_MERGED"
  | "FEATURE_DONE"
  | "INFRA_PAUSE"
  | "WAVE_HALTED"
  | "COMPLETION_WAVE";

export interface PhaseEvent {
  taskId: string;
  phase: PhaseName;
  attemptId: string;
  featureSha: string;
  detail: string;
}

export interface CompiledPlanSnapshot {
  snapshotId: string;
  compiler?: string;
}

export interface TaskFields {
  feature?: string;
  basis?: string;
  phase?: string;
  tags?: string[];
  critical_path?: boolean;
  task_type?: string;
  compiled_plan_snapshot?: CompiledPlanSnapshot;
  level?: string;
}

export interface ReadyTask {
  id: string;
  feature: string;
  title: string;
  text: string;
  level: string;
  version: number;
  contentHash: string;
  fields: TaskFields;
  wave: number;
  branch: string;
  basis: string;
  basisRank: number;
  depth: number;
  blocker: boolean;
}

export interface BriefNodePin {
  id: string;
  version: number;
  contentHash: string;
}

export interface BriefManifest {
  taskId: string;
  attemptId: string;
  level: string;
  tokens: number;
  sliceSha256: string;
  nodes: BriefNodePin[];
  tools: readonly string[];
  hint: string;
}

export interface MaterializedBrief {
  text: string;
  tokens: number;
  sliceSha256: string;
  manifest: BriefManifest;
}

export interface SliceCompileInput {
  task: ReadyTask;
  attemptId: string;
  hint: string;
  nodes: BriefNodePin[];
  requirementLines: readonly string[];
}

export interface KnowledgePacketSlicerPort {
  compile(input: SliceCompileInput): MaterializedBrief;
}

export interface ClaimedAttempt {
  attemptId: string;
  epoch: number;
  reservationId: string;
  baseCommit: string;
}

export type CheckpointDecision = "continue" | "suspend" | "interrupt";

export interface WorkerContext {
  taskId: string;
  attemptId: string;
  worktree: string;
  briefText: string;
  sliceSha256: string;
  hint: string;
  hintStep: number;
  tools: readonly string[];
  sandbox: typeof SANDBOX_PROFILE;
  signal: AbortSignal;
  checkpoint: (step: number) => Promise<CheckpointDecision>;
}

export type WorkerErrorClass =
  | "code"
  | "infrastructure"
  | "dispute"
  | "budget"
  | "interrupted"
  | "suspended";

export interface WorkerResult {
  ok: boolean;
  turns: number;
  costMicroUsd: number;
  errorClass?: WorkerErrorClass;
  errorCode?: string;
  message?: string;
}

export interface NativeWorkerLoopPort {
  run(context: WorkerContext): Promise<WorkerResult>;
}

export interface AuditResult {
  pass: boolean;
  fingerprint: string;
  findings: string[];
}

export interface StaticAuditPort {
  audit(input: { taskId: string; diff: string; worktree: string }): Promise<AuditResult> | AuditResult;
}

export interface TagReport {
  tags: string[];
  sqlMigration: boolean;
}

export interface DiffAutoTagDetectorPort {
  detect(diff: string, paths: readonly string[]): TagReport;
}

export type VerifierVerdict = "pass" | "fail" | "dispute";

export interface VerifierResult {
  verdict: VerifierVerdict;
  errors: string[];
}

export interface CleanVerifierHarnessPort {
  verify(input: { taskId: string; worktree: string; diff: string }): Promise<VerifierResult> | VerifierResult;
}

export interface SmokeResult {
  ok: boolean;
  error: string;
  smokeMs: number;
  timedOut: boolean;
}

export interface AttemptReceipt {
  attemptId: string;
  taskId: string;
  claimedAt: number;
  briefTokens: number;
  workerTurns: number;
  costMicroUsd: number;
  verifierVerdict: string;
  mergedCommitSha: string | null;
  smokeMs: number | null;
  phase: string;
  hintStep: number;
  staticAudit: string;
  detail: string;
}

export interface InfrastructureActionCard {
  kind: "infrastructure";
  message: string;
  fingerprint: string;
  pausedAt: number;
}

export interface FeatureIntegrationResult {
  featureId: string;
  merged: boolean;
  mergedSha: string | null;
  journeyPassed: boolean;
  a11yClean: boolean;
  message: string;
}

export interface FeatureIntegratorPort {
  integrate(input: { featureId: string; branch: string; headSha: string }): Promise<FeatureIntegrationResult>;
}

export interface SevenConditionReport {
  ok: boolean;
  failing: string[];
}

export interface FeatureDoneGatePort {
  evaluate(featureId: string, integration: FeatureIntegrationResult): SevenConditionReport;
}

export interface CompiledLeafSpec {
  id: string;
  feature: string;
  title: string;
  text?: string;
  basis: RequirementBasis;
  tags?: string[];
  criticalPath?: boolean;
  phase?: string;
  dependsOn?: readonly string[];
  snapshotId: string;
  level?: string;
}

export interface CompiledFeatureSpec {
  id: string;
  title: string;
  wave: number;
  branch: string;
}

export type WaveCompileResult =
  | { status: "compiled"; features: CompiledFeatureSpec[]; tasks: CompiledLeafSpec[] }
  | { status: "architecture_mismatch"; message: string }
  | { status: "final_wave" };

export interface WaveAdvancementPort {
  compile(input: { completedWave: number }): WaveCompileResult | Promise<WaveCompileResult>;
}

export interface CompletionWavePort {
  launch(input: { afterWave: number }): { launched: boolean; name: "Task-101" };
}

export interface PlannerRepairPort {
  repair(input: { wave: number; message: string }): { invoked: true; bounded: true };
}

export type KernelEvent =
  | { type: "task_hold_added"; taskId: string; reason: string }
  | { type: "task_hold_released"; taskId: string }
  | { type: "user_replied"; taskId: string }
  | { type: "stop" }
  | { type: "budget_wind_down" }
  | { type: "feature_done"; featureId: string };

export interface RunOptions {
  blockOnIdle?: boolean;
  maxTasks?: number;
}

export interface RunReport {
  status: RunnerStatus;
  claimed: string[];
  merged: string[];
  events: PhaseEvent[];
  card: InfrastructureActionCard | null;
  completionLaunched: boolean;
  repairInvoked: boolean;
  integratorCalls: string[];
  jitWaves: number[];
  leavesMerged: string[];
  featureDone: string[];
}

export class CompiledPlanMissingError extends Error {
  readonly taskId: string;

  constructor(taskId: string) {
    super(`compiled_plan_snapshot missing for ${taskId}`);
    this.name = "CompiledPlanMissingError";
    this.taskId = taskId;
  }
}

export class BudgetReservationError extends Error {
  readonly taskId: string;

  constructor(taskId: string) {
    super(`budget pre-reservation failed for ${taskId}`);
    this.name = "BudgetReservationError";
    this.taskId = taskId;
  }
}
