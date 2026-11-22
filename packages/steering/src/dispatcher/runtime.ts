import type {
  BudgetSnapshot,
  ControlState,
  DispatcherSeed,
  EvidenceRecord,
  FeatureRecord,
  FeatureStatus,
  ProjectRuntimeView,
  QuarantinedSubmission,
  TaskHold,
  TaskRecord,
  WorkerRecord,
  WorkerState,
} from "./types.js";

const DEFAULT_BUDGET: BudgetSnapshot = {
  spentMicroUsd: 1_000_000n,
  capMicroUsd: 10_000_000n,
  windowUsedPpm: 10_000,
  windowCapPpm: 100_000,
};

function featureFromSeed(seed: NonNullable<DispatcherSeed["features"]>[number]): FeatureRecord {
  const slug = seed.slug ?? slugify(seed.title);
  return {
    featureId: seed.featureId,
    slug,
    title: seed.title,
    status: seed.status ?? "active",
    scope: seed.scope ?? seed.title,
    settledAnswers: seed.settledAnswers ?? [],
    wave: seed.wave === undefined ? null : seed.wave,
    priorStatus: null,
    originMsgSeq: null,
    emptyStub: false,
  };
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export class SteeringRuntime {
  readonly phase: string;
  controlState: ControlState = "RUNNING";
  controlEpoch = 1;
  paused = false;
  claimNewTasks = true;
  integrationHead: string;
  readonly featureHeads = new Map<string, string>();
  presetId: string;
  currentWave: number;
  readonly productionStamp: string;
  readonly demoStamp: string;
  llmCalls = 0;
  readonly workers = new Map<string, WorkerRecord>();
  readonly tasks = new Map<string, TaskRecord>();
  readonly features = new Map<string, FeatureRecord>();
  readonly evidence = new Map<string, EvidenceRecord>();
  readonly holds: TaskHold[] = [];
  readonly quarantined: QuarantinedSubmission[] = [];
  readonly impact: Map<string, readonly string[]>;
  budget: BudgetSnapshot;
  graphWrites = 0;
  private commitBarrier: () => Promise<void> = async () => undefined;

  constructor(seed: DispatcherSeed = {}) {
    this.phase = seed.phase ?? "WAVES";
    this.integrationHead = seed.integrationHead ?? "refs/harness/integration";
    this.presetId = seed.presetId ?? "standard";
    this.currentWave = seed.currentWave ?? 1;
    this.productionStamp = seed.productionStamp ?? "prod-intact";
    this.demoStamp = seed.demoStamp ?? "demo-intact";
    this.budget = seed.budget ?? DEFAULT_BUDGET;
    this.impact = new Map(Object.entries(seed.impact ?? {}));
    for (const worker of seed.workers ?? []) {
      const record: WorkerRecord = {
        id: worker.id,
        featureId: worker.featureId,
        taskId: worker.taskId,
        kind: worker.kind ?? "native",
        state: "running",
        checkpointRef: worker.checkpointRef,
        atCheckpointBoundary: worker.atCheckpointBoundary ?? false,
        worktreePath: worker.worktreePath ?? null,
        worktreeStatus: worker.worktreePath ? "dirty" : null,
        pid: null,
        jobId: null,
      };
      this.workers.set(record.id, record);
      this.featureHeads.set(record.featureId, `refs/harness/f/${record.featureId}`);
    }
    for (const task of seed.tasks ?? []) {
      this.tasks.set(task.taskId, {
        taskId: task.taskId,
        featureId: task.featureId,
        title: task.title,
        state: task.state ?? "CODING",
        optional: task.optional ?? false,
        attempt: task.attempt ?? 1,
        active: task.active ?? true,
      });
    }
    for (const feature of seed.features ?? []) {
      this.features.set(feature.featureId, featureFromSeed(feature));
      if (!this.featureHeads.has(feature.featureId)) {
        this.featureHeads.set(feature.featureId, `refs/harness/f/${feature.featureId}`);
      }
    }
    for (const item of seed.evidence ?? []) {
      this.evidence.set(item.id, {
        id: item.id,
        kind: item.kind ?? "node",
        title: item.title,
        text: item.text,
        featureId: item.featureId ?? null,
        taskId: item.taskId ?? null,
        file: item.file ?? null,
      });
    }
  }

  projectRuntime(): ProjectRuntimeView {
    return {
      phase: this.phase,
      state: this.controlState === "STOPPED" ? "STOPPED" : this.phase,
      controlState: this.controlState,
      controlEpoch: this.controlEpoch,
      paused: this.paused,
      claimNewTasks: this.claimNewTasks,
      integrationHead: this.integrationHead,
      featureHeads: Object.fromEntries(this.featureHeads),
      presetId: this.presetId,
      currentWave: this.currentWave,
      productionStamp: this.productionStamp,
      demoStamp: this.demoStamp,
      llmCalls: this.llmCalls,
    };
  }

  fingerprint(): string {
    const workers = [...this.workers.values()].map((worker) =>
      [worker.id, worker.state, worker.checkpointRef, worker.worktreeStatus, worker.pid].join(":"),
    );
    const tasks = [...this.tasks.values()].map((task) => [task.taskId, task.state, task.attempt].join(":"));
    const features = [...this.features.values()].map((feature) =>
      [feature.featureId, feature.status, feature.scope, feature.settledAnswers.map((answer) => answer.id).join(",")].join(":"),
    );
    const evidence = [...this.evidence.values()].map((item) => [item.id, item.text].join(":"));
    const holds = this.holds.map((hold) => [hold.taskId, hold.reason, hold.source].join(":"));
    const runtime = this.projectRuntime();
    return JSON.stringify({
      workers,
      tasks,
      features,
      evidence,
      holds,
      state: runtime.state,
      epoch: runtime.controlEpoch,
      paused: runtime.paused,
      integrationHead: runtime.integrationHead,
      featureHeads: runtime.featureHeads,
      budget: {
        spent: this.budget.spentMicroUsd.toString(),
        cap: this.budget.capMicroUsd.toString(),
        windowUsedPpm: this.budget.windowUsedPpm,
        windowCapPpm: this.budget.windowCapPpm,
      },
      productionStamp: this.productionStamp,
      demoStamp: this.demoStamp,
      graphWrites: this.graphWrites,
    });
  }

  listWorkers(): readonly WorkerRecord[] {
    return [...this.workers.values()];
  }

  replaceWorker(next: WorkerRecord): void {
    this.workers.set(next.id, next);
  }

  markWorker(workerId: string, state: WorkerState): void {
    const current = this.workers.get(workerId);
    if (!current) return;
    this.replaceWorker({ ...current, state });
  }

  attachWorkerProcess(workerId: string, pid: number, jobId: string): void {
    const current = this.workers.get(workerId);
    if (!current) return;
    this.replaceWorker({ ...current, pid, jobId });
  }

  placeHold(hold: TaskHold): TaskHold {
    const exists = this.holds.some(
      (row) => row.taskId === hold.taskId && row.reason === hold.reason && row.source === hold.source,
    );
    if (!exists) {
      this.holds.push(hold);
      this.graphWrites += 1;
    }
    return hold;
  }

  releaseHold(taskId: string, reason: string): number {
    const before = this.holds.length;
    const next = this.holds.filter((hold) => !(hold.taskId === taskId && hold.reason === reason));
    const removed = before - next.length;
    if (removed > 0) this.graphWrites += 1;
    this.holds.length = 0;
    this.holds.push(...next);
    return removed;
  }

  listHolds(taskId?: string): readonly TaskHold[] {
    if (taskId === undefined) return [...this.holds];
    return this.holds.filter((hold) => hold.taskId === taskId);
  }

  upsertFeature(feature: FeatureRecord): void {
    this.features.set(feature.featureId, feature);
    if (!this.featureHeads.has(feature.featureId)) {
      this.featureHeads.set(feature.featureId, `refs/harness/f/${feature.featureId}`);
    }
    this.graphWrites += 1;
  }

  archiveEmptyStub(featureId: string): FeatureRecord | null {
    const feature = this.features.get(featureId);
    if (!feature) return null;
    if (!feature.emptyStub) {
      if (feature.priorStatus) {
        const restored: FeatureRecord = {
          ...feature,
          status: feature.priorStatus,
          priorStatus: null,
          originMsgSeq: null,
        };
        this.upsertFeature(restored);
        return restored;
      }
      return feature;
    }
    const archived: FeatureRecord = {
      ...feature,
      status: "archived",
      scope: "",
      wave: null,
      emptyStub: true,
    };
    this.upsertFeature(archived);
    return archived;
  }

  setTask(next: TaskRecord): void {
    this.tasks.set(next.taskId, next);
    this.graphWrites += 1;
  }

  bumpEpoch(next: ControlState): void {
    this.controlEpoch += 1;
    this.controlState = next;
    this.paused = next !== "RUNNING";
    this.claimNewTasks = next === "RUNNING";
    this.graphWrites += 1;
  }

  armCommitBarrier(barrier: () => Promise<void>): void {
    this.commitBarrier = barrier;
  }

  async beforeCandidateCommit(): Promise<void> {
    await this.commitBarrier();
  }

  quarantine(input: Omit<QuarantinedSubmission, "code">): QuarantinedSubmission {
    const row: QuarantinedSubmission = { ...input, code: "STOPPED_EPOCH_MISMATCH" };
    this.quarantined.push(row);
    return row;
  }

  advanceIntegration(featureId: string, commitRef: string): void {
    this.integrationHead = commitRef;
    this.featureHeads.set(featureId, commitRef);
    this.graphWrites += 1;
  }

  resetRehearsals(): readonly string[] {
    const reset: string[] = [];
    for (const worker of this.workers.values()) {
      if (worker.kind !== "rehearsal" || !worker.worktreePath) continue;
      this.replaceWorker({ ...worker, worktreeStatus: "reset", state: "interrupted" });
      reset.push(worker.worktreePath);
    }
    return reset;
  }

  workersForFeature(featureId: string): readonly WorkerRecord[] {
    return this.listWorkers().filter((worker) => worker.featureId === featureId);
  }

  runningWorkersOutside(featureId: string): readonly WorkerRecord[] {
    return this.listWorkers().filter((worker) => worker.featureId !== featureId && worker.state === "running");
  }
}

export function emptyImpact(): {
  affectedActiveTasks: readonly string[];
  affectedDecisions: readonly string[];
  affectedRequirements: readonly string[];
  affectedContracts: readonly string[];
  affectedScreens: readonly string[];
  affectedMergedTasks: readonly string[];
  affectedChecks: readonly string[];
} {
  return {
    affectedActiveTasks: [],
    affectedDecisions: [],
    affectedRequirements: [],
    affectedContracts: [],
    affectedScreens: [],
    affectedMergedTasks: [],
    affectedChecks: [],
  };
}

export function isRevivalStatus(status: FeatureStatus): status is "deferred" | "undone" {
  return status === "deferred" || status === "undone";
}
