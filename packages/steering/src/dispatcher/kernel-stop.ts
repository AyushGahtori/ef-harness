import type {
  ForeignRuntimeAdapterPort,
  NativeWorkerLoopPort,
  TaskHoldsManagerPort,
  WindowsJobSupervisorPort,
} from "./ports.js";
import type { SteeringRuntime } from "./runtime.js";
import {
  JOB_KILL_DEADLINE_MS,
  JobLeakError,
  PAUSE_GRACE_MS,
  STOP_INTERRUPT_GRACE_MS,
  STOP_STATE_DEADLINE_MS,
  StoppedEpochMismatchError,
  TaskControlError,
  USER_PAUSED_REASON,
  type CandidateAcceptInput,
  type Clock,
  type ExecutionControlInput,
  type ExecutionControlName,
  type JobTermination,
  type ProjectRuntimeView,
  type QuarantinedSubmission,
  type Sleeper,
  type WorkerRecord,
} from "./types.js";

export interface ControlOutcome {
  readonly control: ExecutionControlName;
  readonly llmCalls: 0;
  readonly stateFlipMs: number;
  readonly latencyMs: number;
  readonly runtime: ProjectRuntimeView;
  readonly holdsAdded: readonly string[];
  readonly checkpointRefs: readonly string[];
  readonly workersStillRunning: number;
  readonly jobTerminations: readonly JobTermination[];
  readonly rehearsalsReset: readonly string[];
  readonly quarantined: boolean;
}

export class ImmediateKernelStopController {
  constructor(
    private readonly runtime: SteeringRuntime,
    private readonly holds: TaskHoldsManagerPort,
    private readonly jobs: WindowsJobSupervisorPort,
    private readonly nativeWorkers: NativeWorkerLoopPort,
    private readonly foreignAdapters: ForeignRuntimeAdapterPort,
    private readonly sleeper: Sleeper,
    private readonly clock: Clock,
  ) {}

  projectRuntime(): ProjectRuntimeView {
    return this.runtime.projectRuntime();
  }

  submissionPending(): readonly QuarantinedSubmission[] {
    return [...this.runtime.quarantined];
  }

  holdsActive(): readonly { readonly taskId: string; readonly reason: string }[] {
    return this.holds.listActiveHolds();
  }

  workers(): readonly WorkerRecord[] {
    return this.runtime.listWorkers();
  }

  armCommitBarrier(barrier: () => Promise<void>): void {
    this.runtime.armCommitBarrier(barrier);
  }

  async execute(input: ExecutionControlInput): Promise<ControlOutcome> {
    switch (input.control) {
      case "stop_now":
        return this.stop(input.interruptGraceMs ?? STOP_INTERRUPT_GRACE_MS);
      case "pause_build":
        return this.pauseBuild(input.graceMs ?? PAUSE_GRACE_MS);
      case "pause_feature":
        return this.pauseFeature(requireFeature(input), input.msgSeq);
      case "resume":
        return input.featureId ? this.resumeFeature(input.featureId) : this.resume();
      case "cancel_task":
        return this.cancelTask(requireTask(input));
      case "retry_task":
        return this.retryTask(requireTask(input));
      case "switch_preset":
        return this.switchPreset(input.presetId ?? "standard");
      case "skip_optional_task":
        return this.skipOptionalTask(requireTask(input));
      default:
        return assertNever(input.control);
    }
  }

  applyStop(): ControlOutcome {
    const flipped = this.flipStopped();
    return this.outcome(
      "stop_now",
      flipped.started,
      flipped.stateFlipMs,
      [],
      flipped.checkpoints,
      [],
      [],
      false,
    );
  }

  async stop(interruptGraceMs = STOP_INTERRUPT_GRACE_MS): Promise<ControlOutcome> {
    const flipped = this.flipStopped();
    const jobTerminations = await this.jobs.terminateAll(interruptGraceMs);
    const surviving = jobTerminations.flatMap((job) => job.survivingPids);
    if (surviving.length > 0) throw new JobLeakError(surviving);
    const killElapsed = performance.now() - flipped.started;
    if (jobTerminations.some((job) => job.escalatedPids.length > 0) && killElapsed >= JOB_KILL_DEADLINE_MS) {
      throw new TaskControlError("JOB_KILL_LATENCY", `job termination took ${killElapsed.toString()} ms`);
    }
    const rehearsalsReset = this.runtime.resetRehearsals();
    return this.outcome(
      "stop_now",
      flipped.started,
      flipped.stateFlipMs,
      [],
      flipped.checkpoints,
      jobTerminations,
      rehearsalsReset,
      false,
    );
  }

  private flipStopped(): { readonly started: number; readonly stateFlipMs: number; readonly checkpoints: readonly string[] } {
    const started = performance.now();
    this.runtime.bumpEpoch("STOPPED");
    const checkpoints = this.preserveCheckpoints().map((worker) => worker.checkpointRef);
    this.signalEveryone();
    const stateFlipMs = performance.now() - started;
    if (stateFlipMs >= STOP_STATE_DEADLINE_MS) {
      throw new TaskControlError("STOP_LATENCY", `STOP state flip took ${stateFlipMs.toString()} ms`);
    }
    return { started, stateFlipMs, checkpoints };
  }

  async pauseBuild(graceMs = PAUSE_GRACE_MS): Promise<ControlOutcome> {
    const started = performance.now();
    this.runtime.bumpEpoch("PAUSED");
    const ready = this.runtime.listWorkers().filter((worker) => worker.atCheckpointBoundary && worker.state === "running");
    for (const worker of ready) this.runtime.markWorker(worker.id, "checkpointed");
    if (graceMs > 0) await this.sleeper.sleep(graceMs);
    const stillRunning = this.runtime.listWorkers().filter((worker) => worker.state === "running");
    for (const worker of stillRunning) {
      this.interruptWorker(worker);
      this.runtime.markWorker(worker.id, "interrupted");
    }
    const checkpoints = this.preserveCheckpoints();
    return this.outcome("pause_build", started, performance.now() - started, [], checkpoints.map((row) => row.checkpointRef), [], [], false);
  }

  pauseFeature(featureId: string, msgSeq: string): ControlOutcome {
    const started = performance.now();
    const holdsAdded: string[] = [];
    for (const worker of this.runtime.workersForFeature(featureId)) {
      if (worker.state !== "running" && worker.state !== "checkpointed") continue;
      this.holds.placeHold(worker.taskId, USER_PAUSED_REASON, `msg:${msgSeq}`, this.clock.now());
      this.runtime.markWorker(worker.id, "held");
      holdsAdded.push(worker.taskId);
    }
    const others = this.runtime.runningWorkersOutside(featureId).length;
    return this.outcome(
      "pause_feature",
      started,
      performance.now() - started,
      holdsAdded,
      [],
      [],
      [],
      false,
      others,
    );
  }

  resume(): ControlOutcome {
    const started = performance.now();
    this.runtime.bumpEpoch("RUNNING");
    for (const worker of this.runtime.listWorkers()) {
      if (worker.state === "interrupted" || worker.state === "checkpointed") {
        const stillHeld = this.holds.listActiveHolds(worker.taskId).length > 0;
        this.runtime.markWorker(worker.id, stillHeld ? "held" : "running");
      }
    }
    return this.outcome("resume", started, performance.now() - started, [], [], [], [], false);
  }

  resumeFeature(featureId: string): ControlOutcome {
    const started = performance.now();
    for (const worker of this.runtime.workersForFeature(featureId)) {
      this.holds.releaseHold(worker.taskId, USER_PAUSED_REASON);
      if (this.runtime.projectRuntime().controlState === "RUNNING" && worker.state === "held") {
        this.runtime.markWorker(worker.id, "running");
      }
    }
    return this.outcome("resume", started, performance.now() - started, [], [], [], [], false);
  }

  cancelTask(taskId: string): ControlOutcome {
    const started = performance.now();
    const task = this.requireTask(taskId);
    this.runtime.setTask({ ...task, state: "CANCELLED", active: false });
    for (const worker of this.runtime.listWorkers()) {
      if (worker.taskId !== taskId) continue;
      this.interruptWorker(worker);
      this.runtime.markWorker(worker.id, "cancelled");
    }
    return this.outcome("cancel_task", started, performance.now() - started, [], [], [], [], false);
  }

  retryTask(taskId: string): ControlOutcome {
    const started = performance.now();
    const task = this.requireTask(taskId);
    this.runtime.setTask({ ...task, state: "READY", active: true, attempt: task.attempt + 1 });
    for (const worker of this.runtime.listWorkers()) {
      if (worker.taskId !== taskId) continue;
      if (worker.state !== "running") this.runtime.markWorker(worker.id, "running");
    }
    return this.outcome("retry_task", started, performance.now() - started, [], [this.checkpointFor(taskId)], [], [], false);
  }

  switchPreset(presetId: string): ControlOutcome {
    const started = performance.now();
    this.runtime.presetId = presetId;
    return this.outcome("switch_preset", started, performance.now() - started, [], [], [], [], false);
  }

  skipOptionalTask(taskId: string): ControlOutcome {
    const started = performance.now();
    const task = this.requireTask(taskId);
    if (!task.optional) {
      throw new TaskControlError("TASK_REQUIRED", `${taskId} is required and cannot be skipped`);
    }
    this.runtime.setTask({ ...task, state: "SKIPPED", active: false });
    for (const worker of this.runtime.listWorkers()) {
      if (worker.taskId === taskId) this.runtime.markWorker(worker.id, "skipped");
    }
    return this.outcome("skip_optional_task", started, performance.now() - started, [], [], [], [], false);
  }

  async acceptCandidate(input: CandidateAcceptInput): Promise<{ readonly merged: true; readonly integrationHead: string }> {
    const observedEpoch = input.observedEpoch ?? this.runtime.controlEpoch;
    const integrationBefore = this.runtime.integrationHead;
    const featureBefore = this.runtime.featureHeads.get(input.featureId) ?? `refs/harness/f/${input.featureId}`;
    await this.runtime.beforeCandidateCommit();
    const stopped = this.runtime.controlState === "STOPPED";
    const stale = this.runtime.controlEpoch !== observedEpoch;
    if (stopped || stale) {
      this.runtime.quarantine({
        workerId: input.workerId,
        featureId: input.featureId,
        taskId: input.taskId,
        commitRef: input.commitRef,
        artifactRef: input.artifactRef,
        observedEpoch,
        controlEpoch: this.runtime.controlEpoch,
      });
      if (this.runtime.integrationHead !== integrationBefore || (this.runtime.featureHeads.get(input.featureId) ?? featureBefore) !== featureBefore) {
        throw new TaskControlError("HALF_WRITTEN_COMMIT", "integration moved during a rejected merge");
      }
      throw new StoppedEpochMismatchError(
        `STOPPED_EPOCH_MISMATCH for ${input.workerId}: observed ${observedEpoch.toString()}, control_epoch ${this.runtime.controlEpoch.toString()}`,
      );
    }
    this.runtime.advanceIntegration(input.featureId, input.commitRef);
    return { merged: true, integrationHead: this.runtime.integrationHead };
  }

  private signalEveryone(): void {
    for (const worker of this.runtime.listWorkers()) {
      if (worker.state === "cancelled" || worker.state === "skipped") continue;
      this.interruptWorker(worker);
      if (worker.state === "running" || worker.state === "held" || worker.state === "checkpointed") {
        this.runtime.markWorker(worker.id, "interrupted");
      }
    }
  }

  private interruptWorker(worker: WorkerRecord): void {
    if (worker.kind === "foreign") this.foreignAdapters.interrupt(worker.id);
    else if (worker.kind === "native") this.nativeWorkers.interrupt(worker.id);
  }

  private preserveCheckpoints(): readonly WorkerRecord[] {
    return this.runtime.listWorkers().filter((worker) => worker.checkpointRef.length > 0);
  }

  private checkpointFor(taskId: string): string {
    return this.runtime.listWorkers().find((worker) => worker.taskId === taskId)?.checkpointRef ?? "";
  }

  private requireTask(taskId: string) {
    const task = this.runtime.tasks.get(taskId);
    if (!task) throw new TaskControlError("TASK_NOT_FOUND", `${taskId} is not in task_runtime`);
    return task;
  }

  private outcome(
    control: ExecutionControlName,
    started: number,
    stateFlipMs: number,
    holdsAdded: readonly string[],
    checkpointRefs: readonly string[],
    jobTerminations: readonly JobTermination[],
    rehearsalsReset: readonly string[],
    quarantined: boolean,
    workersStillRunning = this.runtime.listWorkers().filter((worker) => worker.state === "running").length,
  ): ControlOutcome {
    if (this.runtime.llmCalls !== 0) {
      throw new TaskControlError("LLM_ON_CONTROL_PATH", "execution control called the model");
    }
    return {
      control,
      llmCalls: 0,
      stateFlipMs,
      latencyMs: performance.now() - started,
      runtime: this.runtime.projectRuntime(),
      holdsAdded,
      checkpointRefs,
      workersStillRunning,
      jobTerminations,
      rehearsalsReset,
      quarantined,
    };
  }
}

function requireFeature(input: ExecutionControlInput): string {
  if (!input.featureId) throw new TaskControlError("FEATURE_REQUIRED", "pause feature needs a feature id");
  return input.featureId;
}

function requireTask(input: ExecutionControlInput): string {
  if (!input.taskId) throw new TaskControlError("TASK_REQUIRED", `${input.control} needs a task id`);
  return input.taskId;
}

function assertNever(value: never): never {
  throw new TaskControlError("UNKNOWN_CONTROL", `unknown control ${String(value)}`);
}
