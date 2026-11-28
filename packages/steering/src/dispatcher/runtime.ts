import { DatabaseSync } from "node:sqlite";
import { isHoldReason } from "@ef-harness/db";
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
  private stateDb: DatabaseSync | null = null;
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

  attachState(db: DatabaseSync): void {
    this.stateDb = db;
    db.exec(
      "INSERT OR IGNORE INTO project_runtime(id, state, current_wave, paused, updated_rev) VALUES (1, 'WAVES', 1, 0, 0)",
    );
    this.persistControl();
  }

  placeHold(hold: TaskHold): TaskHold {
    const exists = this.holds.some(
      (row) => row.taskId === hold.taskId && row.reason === hold.reason && row.source === hold.source,
    );
    if (!exists) {
      this.holds.push(hold);
      this.graphWrites += 1;
      this.persistHold(hold);
    }
    return hold;
  }

  releaseHold(taskId: string, reason: string): number {
    const before = this.holds.length;
    const next = this.holds.filter((hold) => !(hold.taskId === taskId && hold.reason === reason));
    const removed = before - next.length;
    if (removed > 0) {
      this.graphWrites += 1;
      this.stateDb
        ?.prepare("DELETE FROM task_holds WHERE task = :task AND reason = :reason")
        .run({ task: taskId, reason });
    }
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
    this.persistControl();
  }

  private persistControl(): void {
    const db = this.stateDb;
    if (!db) return;
    const paused = this.paused || this.controlState === "PAUSED" ? 1 : 0;
    db.prepare(
      "UPDATE project_runtime SET paused = :paused, current_wave = :wave, updated_rev = updated_rev + 1 WHERE id = 1",
    ).run({ paused, wave: this.currentWave });
    db.prepare(
      "INSERT INTO meta(key, value) VALUES ('steering.control_state', :value) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    ).run({ value: this.controlState });
  }

  private persistHold(hold: TaskHold): void {
    const db = this.stateDb;
    if (!db || !isHoldReason(hold.reason)) return;
    this.ensureTaskRow(hold.taskId);
    db.prepare(
      "INSERT OR IGNORE INTO task_holds(task, reason, source, created_at) VALUES (:task, :reason, :source, :created)",
    ).run({
      task: hold.taskId,
      reason: hold.reason,
      source: hold.source,
      created: hold.createdAtMs,
    });
  }

  private ensureTaskRow(taskId: string): void {
    const db = this.stateDb;
    if (!db) return;
    const existing = db.prepare("SELECT 1 AS ok FROM task_runtime WHERE task = :task").get({ task: taskId });
    if (existing) return;
    const worker = [...this.workers.values()].find((item) => item.taskId === taskId);
    const feature = this.tasks.get(taskId)?.featureId ?? worker?.featureId ?? "unscoped";
    const changeSet = `cs-steering-${taskId}`;
    db.prepare(
      `INSERT OR IGNORE INTO change_sets(id, rev, origin, origin_ref, author, created_at, summary)
       VALUES (:id, NULL, 'kernel', NULL, 'steering', :now, 'steering hold')`,
    ).run({ id: changeSet, now: Date.now() });
    db.prepare(
      `INSERT OR IGNORE INTO nodes(
         id, kind, version, content_hash, title, text, fields, status, owner_role, change_set, created_rev, updated_rev
       ) VALUES (
         :id, 'task', 1, :hash, :title, '', :fields, 'active', NULL, :change_set, 0, 0
       )`,
    ).run({
      id: taskId,
      hash: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
      title: taskId,
      fields: JSON.stringify({ steeringCatalog: 0 }),
      change_set: changeSet,
    });
    db.prepare(
      `INSERT OR IGNORE INTO task_runtime(task, feature, state, level, epoch, submission_pending, updated_rev)
       VALUES (:task, :feature, 'CODING', 'standard', 0, 0, 0)`,
    ).run({ task: taskId, feature });
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
