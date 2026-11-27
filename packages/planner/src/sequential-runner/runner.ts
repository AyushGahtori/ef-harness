import { NativeWorkerLoop } from "@ef-harness/worker-loop";

import { AttemptBriefMaterializer, LocalKnowledgePacketSlicer } from "./brief.js";
import { KernelEventBus } from "./event-bus.js";
import { GitWorkspace } from "./git-workspace.js";
import {
  FinalWaveAdvancement,
  HarnessCleanVerifier,
  HarnessStaticAudit,
  LocalDiffAutoTagDetector,
  LocalFeatureDoneGate,
  LocalFeatureIntegrator,
  writeScopeViolation,
} from "./ports.js";
import { ExplicitFirstReadyQueue } from "./ready-queue.js";
import { PostMergeSmokeChecker } from "./smoke.js";
import { StateDb } from "./state-db.js";
import type { HighRiskDiffReviewer } from "../specialists/high-risk-diff-reviewer.js";
import {
  BudgetReservationError,
  SANDBOX_PROFILE,
  WORKER_TOOLS,
  type AttemptReceipt,
  type CleanVerifierHarnessPort,
  type CompletionWavePort,
  type DiffAutoTagDetectorPort,
  type FeatureDoneGatePort,
  type FeatureIntegratorPort,
  type InfrastructureActionCard,
  type KnowledgePacketSlicerPort,
  type NativeWorkerLoopPort,
  type PhaseEvent,
  type PhaseName,
  type PlannerRepairPort,
  type ReadyTask,
  type RunOptions,
  type RunReport,
  type RunnerStatus,
  type StaticAuditPort,
  type WaveAdvancementPort,
  type WorkerResult,
} from "./types.js";

interface OpenAttempt {
  task: ReadyTask;
  attemptId: string;
  epoch: number;
  reservationId: string;
  claimedAt: number;
}

interface Hint {
  step: number;
  text: string;
}

export interface SequentialRunnerDependencies {
  db: StateDb;
  git: GitWorkspace;
  worker: NativeWorkerLoopPort;
  bus?: KernelEventBus;
  slicer?: KnowledgePacketSlicerPort;
  verifier?: CleanVerifierHarnessPort;
  audit?: StaticAuditPort;
  tags?: DiffAutoTagDetectorPort;
  smoke?: PostMergeSmokeChecker;
  integrator?: FeatureIntegratorPort;
  doneGate?: FeatureDoneGatePort;
  wave?: WaveAdvancementPort;
  completion?: CompletionWavePort;
  repair?: PlannerRepairPort;
  reviewer?: HighRiskDiffReviewer;
  now?: () => number;
  leaseMs?: number;
  reserveMicroUsd?: number;
  smokeTimeoutMs?: number;
  /**
   * Renders the commit message the runner writes for a worker attempt and for landing an
   * accepted candidate. Callers use it to attach the harness EF-* trailers to every commit.
   */
  commitMessage?: (input: {
    readonly kind: "attempt" | "land" | "checkpoint";
    readonly taskId: string;
    readonly attemptId: string;
    readonly step?: number;
  }) => string;
}

export class SequentialBuildRunner {
  readonly queue: ExplicitFirstReadyQueue;
  readonly briefs: AttemptBriefMaterializer;
  readonly bus: KernelEventBus;
  /** Idle waits on the kernel bus. This stays 0 because the dispatcher does not poll. */
  readonly pollTicks = 0;
  idleWaits = 0;

  private readonly db: StateDb;
  private readonly git: GitWorkspace;
  private readonly worker: NativeWorkerLoopPort;
  private readonly verifier: CleanVerifierHarnessPort;
  private readonly audit: StaticAuditPort;
  private readonly tags: DiffAutoTagDetectorPort;
  private readonly smoke: PostMergeSmokeChecker;
  private readonly integrator: FeatureIntegratorPort;
  private readonly doneGate: FeatureDoneGatePort;
  private readonly wave: WaveAdvancementPort;
  private readonly completion: CompletionWavePort;
  private readonly repair: PlannerRepairPort;
  private readonly reviewer: HighRiskDiffReviewer | null;
  private readonly now: () => number;
  private readonly leaseMs: number;
  private readonly reserveMicroUsd: number;
  private readonly smokeTimeoutMs: number;
  private readonly commitMessage: SequentialRunnerDependencies["commitMessage"];

  private statusValue: RunnerStatus = "idle";
  private statusWaiters: Array<{ status: RunnerStatus; resolve: () => void }> = [];
  private events: PhaseEvent[] = [];
  private claimed: string[] = [];
  private merged: string[] = [];
  private leavesMerged: string[] = [];
  private featureDone: string[] = [];
  private integratorCalls: string[] = [];
  private jitWaves: number[] = [];
  private card: InfrastructureActionCard | null = null;
  private completionLaunched = false;
  private repairInvoked = false;
  private hints = new Map<string, Hint>();
  private infraStreak: { fingerprint: string; count: number } | null = null;
  private integrated = new Set<string>();
  private advancedWaves = new Set<number>();
  private suspended: OpenAttempt | null = null;
  private attemptAbort: AbortController | null = null;
  private stopRequested = false;
  private budgetWindDown = false;
  private infraPaused = false;
  private terminal = false;

  constructor(deps: SequentialRunnerDependencies) {
    this.db = deps.db;
    this.git = deps.git;
    this.worker = deps.worker instanceof NativeWorkerLoop ? adaptNativeWorker(deps.worker) : deps.worker;
    this.bus = deps.bus ?? new KernelEventBus();
    this.verifier = deps.verifier ?? new HarnessCleanVerifier();
    this.audit = deps.audit ?? new HarnessStaticAudit();
    this.tags = deps.tags ?? new LocalDiffAutoTagDetector();
    this.smoke = deps.smoke ?? new PostMergeSmokeChecker();
    this.integrator = deps.integrator ?? new LocalFeatureIntegrator(deps.db, deps.git);
    this.doneGate = deps.doneGate ?? new LocalFeatureDoneGate(deps.db, deps.git);
    this.wave = deps.wave ?? new FinalWaveAdvancement();
    this.completion = deps.completion ?? { launch: () => ({ launched: true, name: "Task-101" }) };
    this.repair = deps.repair ?? { repair: () => ({ invoked: true, bounded: true }) };
    this.reviewer = deps.reviewer ?? null;
    this.now = deps.now ?? (() => Date.now());
    this.leaseMs = deps.leaseMs ?? 30 * 60 * 1000;
    this.reserveMicroUsd = deps.reserveMicroUsd ?? 1_000;
    this.smokeTimeoutMs = deps.smokeTimeoutMs ?? 30_000;
    this.commitMessage = deps.commitMessage;
    this.queue = new ExplicitFirstReadyQueue(deps.db);
    this.briefs = new AttemptBriefMaterializer(deps.db, deps.slicer ?? new LocalKnowledgePacketSlicer());
  }

  get status(): RunnerStatus {
    return this.statusValue;
  }

  whenStatus(status: RunnerStatus): Promise<void> {
    if (this.statusValue === status) return Promise.resolve();
    return new Promise((resolve) => {
      this.statusWaiters.push({ status, resolve });
    });
  }

  async run(options: RunOptions = {}): Promise<RunReport> {
    const maxTasks = options.maxTasks ?? 40;
    const blockOnIdle = options.blockOnIdle === true;
    const unsubscribe = this.bus.subscribe((event) => {
      if (event.type === "stop") {
        this.stopRequested = true;
        this.attemptAbort?.abort();
      } else if (event.type === "budget_wind_down") {
        this.budgetWindDown = true;
      }
    });
    this.setStatus("running");
    try {
      let started = 0;
      while (started < maxTasks) {
        if (this.stopRequested) {
          this.setStatus("stopped");
          break;
        }
        if (this.infraPaused) {
          this.setStatus("paused_infrastructure");
          break;
        }
        if (this.terminal) break;
        if (this.suspended) {
          if (this.budgetWindDown) {
            this.setStatus("paused_budget");
            break;
          }
          if (this.db.hasActiveHold(this.suspended.task.id)) {
            const idle = await this.idleForUser(blockOnIdle);
            if (idle !== "resume") break;
            continue;
          }
          const open = this.suspended;
          this.suspended = null;
          await this.dispatch(open.task, open);
          await this.completeFeatures();
          continue;
        }
        if (this.budgetWindDown) {
          this.setStatus("paused_budget");
          break;
        }
        const next = this.queue.list()[0];
        if (!next) {
          const progressed = await this.advanceWaves();
          if (this.terminal || this.stopRequested) break;
          if (progressed) continue;
          if (this.db.waitingOnUser()) {
            const idle = await this.idleForUser(blockOnIdle);
            if (idle !== "resume") break;
            continue;
          }
          this.setStatus(this.statusValue === "running" ? "idle" : this.statusValue);
          break;
        }
        started += 1;
        await this.dispatch(next);
        await this.completeFeatures();
      }
    } finally {
      unsubscribe();
    }
    if (this.statusValue === "running") this.setStatus("idle");
    return this.report();
  }

  private async dispatch(task: ReadyTask, existing?: OpenAttempt): Promise<void> {
    const opened = existing ?? this.claim(task);
    if (!opened) return;
    const controller = new AbortController();
    this.attemptAbort = controller;
    if (this.stopRequested) controller.abort();
    const slot = this.git.checkout(task.branch, opened.attemptId);
    let reservationClose: "settle" | "release" | "keep" = "release";
    let cost = 0;
    try {
      const outcome = await this.execute(opened, slot, controller.signal);
      reservationClose = outcome.close;
      cost = outcome.cost;
    } finally {
      this.attemptAbort = null;
      this.git.removeSlot(slot);
      if (reservationClose !== "keep") {
        this.db.closeReservation(opened.reservationId, this.now(), cost, reservationClose === "settle");
      }
    }
  }

  private claim(task: ReadyTask): OpenAttempt | null {
    const now = this.now();
    try {
      const claimed = this.db.claim({
        taskId: task.id,
        expectedBrief: task.version,
        baseCommit: this.git.head(task.branch),
        now,
        amount: this.reserveMicroUsd,
        leaseMs: this.leaseMs,
      });
      if (!claimed) return null;
      this.claimed.push(task.id);
      this.emit(task.id, "CLAIMED", claimed.attemptId, task.branch, task.branch);
      return {
        task,
        attemptId: claimed.attemptId,
        epoch: claimed.epoch,
        reservationId: claimed.reservationId,
        claimedAt: now,
      };
    } catch (error) {
      if (error instanceof BudgetReservationError) {
        this.budgetWindDown = true;
        this.setStatus("paused_budget");
        return null;
      }
      throw error;
    }
  }

  private async execute(
    open: OpenAttempt,
    slot: string,
    signal: AbortSignal,
  ): Promise<{ close: "settle" | "release" | "keep"; cost: number }> {
    const task = open.task;
    const hint = this.hints.get(task.id);
    const hintText = hint ? `Hint ${hint.step}: ${hint.text}` : "";
    const brief = this.briefs.materialize(task, open.attemptId, hintText, this.now());
    this.db.markCoding(task.id, open.attemptId);
    const receipt = this.blankReceipt(open, brief.tokens, hint?.step ?? 0);
    this.persist(receipt, "WORKING");
    this.emit(task.id, "WORKING", open.attemptId, task.branch, brief.sliceSha256);
    let suspendStep = 0;
    let checkpointSuspended = false;
    const result = await this.worker.run({
      taskId: task.id,
      attemptId: open.attemptId,
      worktree: slot,
      briefText: brief.text,
      sliceSha256: brief.sliceSha256,
      hint: hintText,
      hintStep: hint?.step ?? 0,
      tools: WORKER_TOOLS,
      sandbox: SANDBOX_PROFILE,
      signal,
      checkpoint: async (step) => {
        if (this.stopRequested || signal.aborted) return "interrupt";
        if (this.budgetWindDown || this.db.hasActiveHold(task.id)) {
          suspendStep = step;
          checkpointSuspended = true;
          return "suspend";
        }
        this.db.writeCheckpoint({
          attemptId: open.attemptId,
          step,
          wipRef: null,
          manifestJson: JSON.stringify(brief.manifest),
          briefText: brief.text,
          now: this.now(),
        });
        return "continue";
      },
    });
    receipt.workerTurns = result.turns;
    receipt.costMicroUsd = result.costMicroUsd;
    if (this.stopRequested || result.errorClass === "interrupted") {
      const wip = this.saveWip(slot, open.attemptId, suspendStep || 1, brief);
      this.db.park(task.id, open.attemptId, this.now());
      this.persist(receipt, "PARKED", wip || "stopped");
      this.emit(task.id, "PARKED", open.attemptId, task.branch, wip);
      this.setStatus("stopped");
      return { close: "settle", cost: result.costMicroUsd };
    }
    if (checkpointSuspended || result.errorClass === "suspended") {
      const wip = this.saveWip(slot, open.attemptId, suspendStep || 1, brief);
      this.db.suspendCoding(task.id, open.attemptId);
      this.suspended = open;
      this.persist(receipt, "SUSPENDED", wip || "suspended");
      this.emit(task.id, "SUSPENDED", open.attemptId, task.branch, wip);
      return { close: "keep", cost: result.costMicroUsd };
    }
    if (result.errorClass === "infrastructure" || (!result.ok && isInfra(result))) {
      const code = result.errorCode ?? "";
      const message = result.message ?? "infrastructure failure";
      this.db.releaseToReady(task.id, open.attemptId, this.now(), "infrastructure");
      const paused = this.noteInfra(task, open.attemptId, code, message);
      this.persist(receipt, paused ? "INFRA_PAUSE" : "WORKING", message);
      return { close: "release", cost: result.costMicroUsd };
    }
    if (result.errorClass === "budget") {
      this.infraStreak = null;
      this.db.escalate(task.id, open.attemptId, open.epoch, this.now(), "budget");
      this.persist(receipt, "ESCALATED", result.message ?? "budget hit");
      this.emit(task.id, "ESCALATED", open.attemptId, task.branch, "budget hit");
      return { close: "settle", cost: result.costMicroUsd };
    }
    const candidate = result.ok
      ? this.git.commitAll(
          slot,
          this.commitMessage?.({ kind: "attempt", taskId: task.id, attemptId: open.attemptId }) ??
            `attempt ${open.attemptId}`,
        )
      : null;
    if (!candidate) {
      this.failCode(open, receipt, result.message ?? "worker produced an empty diff");
      return { close: "settle", cost: result.costMicroUsd };
    }
    const paths = this.git.changedPaths(candidate);
    const diff = this.git.showPatch(candidate);
    const detected = this.tags.detect(diff, paths);
    if (writeScopeViolation(task.fields.tags, detected)) {
      this.infraStreak = null;
      this.db.escalate(task.id, open.attemptId, open.epoch, this.now(), "write_scope");
      const detail = "write-scope violation: sql migration outside declared tags";
      this.persist(receipt, "WRITE_SCOPE_REJECTED", detail);
      this.emit(task.id, "WRITE_SCOPE_REJECTED", open.attemptId, task.branch, detail);
      return { close: "settle", cost: result.costMicroUsd };
    }
    this.db.beginVerification(task.id, open.attemptId, open.epoch);
    const verifySlot = this.git.checkout(candidate, `verify-${open.attemptId}`);
    try {
      const audit = await this.audit.audit({ taskId: task.id, diff, worktree: verifySlot });
      if (!audit.pass) {
        const count = this.db.bumpStaticFailure(task.id, task.version, this.now());
        receipt.staticAudit = "fail";
        if (count >= 3) {
          this.db.escalate(task.id, open.attemptId, open.epoch, this.now(), "static_audit");
          this.persist(receipt, "ESCALATED", audit.findings.join("; "));
          this.emit(task.id, "ESCALATED", open.attemptId, task.branch, "static audit");
          return { close: "settle", cost: result.costMicroUsd };
        }
        this.db.releaseToReady(task.id, open.attemptId, this.now(), "static_audit");
        this.persist(receipt, "WORKING", audit.findings.join("; ") || "static audit");
        return { close: "settle", cost: result.costMicroUsd };
      }
      receipt.staticAudit = "pass";
      if (this.reviewer !== null) {
        const taskTags = task.fields.tags ?? [];
        const review = await this.reviewer.review({
          taskId: task.id,
          attemptId: open.attemptId,
          touches: taskTags,
          hintRetryLevel: hint?.step ?? 0,
          tagDrift: detected.tags.some((tag) => !taskTags.includes(tag)),
          diff,
          must: [{ id: task.id, text: task.text || task.title }],
          rules: [],
          staticAudit: {
            taskId: task.id,
            passed: audit.pass,
            fingerprint: audit.fingerprint,
            hardFindingCount: 0,
            softFindingCount: 0,
          },
          workerFamily: "native",
        });
        if (review.status === "blocked_merge") {
          this.failCode(open, receipt, review.hint);
          return { close: "settle", cost: result.costMicroUsd };
        }
        if (review.status === "escalated_to_user") {
          this.infraStreak = null;
          this.db.escalate(task.id, open.attemptId, open.epoch, this.now(), "reviewer_escalation");
          this.persist(receipt, "ESCALATED", review.concern);
          this.emit(task.id, "ESCALATED", open.attemptId, task.branch, review.concern);
          return { close: "settle", cost: result.costMicroUsd };
        }
      }
      this.db.markCleanVerify(task.id, open.epoch);
      this.persist(receipt, "VERIFYING");
      this.emit(task.id, "VERIFYING", open.attemptId, task.branch, candidate);
      const verdict = await this.verifier.verify({ taskId: task.id, worktree: verifySlot, diff });
      if (verdict.verdict === "dispute" || result.errorClass === "dispute") {
        this.infraStreak = null;
        this.db.escalate(task.id, open.attemptId, open.epoch, this.now(), "dispute");
        this.persist(receipt, "ESCALATED", "DisputeTest");
        this.emit(task.id, "ESCALATED", open.attemptId, task.branch, "DisputeTest");
        return { close: "settle", cost: result.costMicroUsd };
      }
      if (verdict.verdict !== "pass") {
        this.failCode(open, receipt, verdict.errors.join("; ") || "verification failed");
        return { close: "settle", cost: result.costMicroUsd };
      }
      receipt.verifierVerdict = "pass";
      const held = await this.waitForHolds(task, open.attemptId);
      if (held === "stop") {
        const wip = this.saveWip(slot, open.attemptId, 1, brief);
        this.db.park(task.id, open.attemptId, this.now());
        this.persist(receipt, "PARKED", wip || "stopped");
        this.emit(task.id, "PARKED", open.attemptId, task.branch, "stopped during submission_pending");
        return { close: "settle", cost: result.costMicroUsd };
      }
      const landed = this.acceptAndLand(open, candidate, diff);
      if (!landed.ok) {
        this.db.releaseToReady(task.id, open.attemptId, this.now(), "cas_rejected");
        this.persist(receipt, "WORKING", landed.message);
        return { close: "settle", cost: result.costMicroUsd };
      }
      this.persist(receipt, "ACCEPTED", landed.sha);
      this.emit(task.id, "ACCEPTED", open.attemptId, task.branch, landed.sha);
      const smokeSlot = this.git.checkout(task.branch, `smoke-${open.attemptId}`);
      try {
        const smoke = await this.smoke.run(smokeSlot, this.smokeTimeoutMs);
        receipt.smokeMs = smoke.smokeMs;
        if (!smoke.ok) {
          const restored = this.git.rollback(task.branch, landed.previous, landed.sha);
          if (!restored) throw new Error(`smoke rollback CAS failed for ${task.branch}`);
          this.failCode(open, receipt, smoke.error);
          this.emit(task.id, "SMOKE_ROLLBACK", open.attemptId, task.branch, smoke.error);
          return { close: "settle", cost: result.costMicroUsd };
        }
      } finally {
        this.git.removeSlot(smokeSlot);
      }
      this.infraStreak = null;
      this.db.markMerged(task.id, open.attemptId, this.now());
      receipt.mergedCommitSha = landed.sha;
      receipt.verifierVerdict = "pass";
      this.merged.push(task.id);
      this.persist(receipt, "MERGED", landed.sha);
      this.emit(task.id, "MERGED", open.attemptId, task.branch, landed.sha);
      return { close: "settle", cost: result.costMicroUsd };
    } finally {
      this.git.removeSlot(verifySlot);
    }
  }

  private acceptAndLand(
    open: OpenAttempt,
    candidate: string,
    diff: string,
  ): { ok: true; sha: string; previous: string } | { ok: false; message: string } {
    const inserted = this.db.insertCandidate({
      id: `C-${open.attemptId}`,
      taskId: open.task.id,
      attemptId: open.attemptId,
      epoch: open.epoch,
      commitSha: candidate,
      payload: JSON.stringify({ sliceSha256: this.hints.get(open.task.id)?.text ?? "", paths: diff.length }),
      now: this.now(),
    });
    if (!inserted) return { ok: false, message: "candidate rejected" };
    this.db.markAccepted(open.task.id, open.attemptId, open.epoch, this.now());
    return this.git.land(
      open.task.branch,
      candidate,
      this.commitMessage?.({ kind: "land", taskId: open.task.id, attemptId: open.attemptId }) ??
        `land ${open.attemptId}`,
    );
  }

  private failCode(open: OpenAttempt, receipt: AttemptReceipt, message: string): void {
    this.infraStreak = null;
    const step = this.db.recordHiddenFailure(open.task.id, open.task.version, message, this.now());
    this.hints.set(open.task.id, { step, text: message });
    receipt.hintStep = step;
    receipt.verifierVerdict = "fail";
    if (step >= 3) {
      this.db.escalate(open.task.id, open.attemptId, open.epoch, this.now(), "hint_exhausted");
      this.persist(receipt, "ESCALATED", message);
      this.emit(open.task.id, "ESCALATED", open.attemptId, open.task.branch, message);
      return;
    }
    this.db.releaseToReady(open.task.id, open.attemptId, this.now(), `hint_${step}`);
    const phase: PhaseName = step <= 1 ? "RETRY_HINT_1" : "RETRY_HINT_2";
    this.persist(receipt, phase, message);
    this.emit(open.task.id, phase, open.attemptId, open.task.branch, message);
  }

  private async waitForHolds(task: ReadyTask, attemptId: string): Promise<"clear" | "stop"> {
    while (this.db.hasActiveHold(task.id)) {
      this.setStatus("submission_pending");
      this.emit(task.id, "SUBMISSION_PENDING", attemptId, task.branch, "task_holds");
      const event = await this.bus.wait(
        (item) =>
          item.type === "stop" ||
          item.type === "budget_wind_down" ||
          (item.type === "task_hold_released" && item.taskId === task.id) ||
          (item.type === "user_replied" && item.taskId === task.id),
      );
      if (event.type === "stop") {
        this.stopRequested = true;
        this.setStatus("stopped");
        return "stop";
      }
      if (event.type === "budget_wind_down") this.budgetWindDown = true;
    }
    if (this.statusValue === "submission_pending") this.setStatus("running");
    return "clear";
  }

  private saveWip(
    slot: string,
    attemptId: string,
    step: number,
    brief: { text: string; manifest: unknown },
  ): string {
    const sha = this.git.commitAll(
      slot,
      this.commitMessage?.({ kind: "checkpoint", taskId: attemptId, attemptId, step }) ??
        `checkpoint ${attemptId} ${step}`,
    );
    const ref = `refs/harness/checkpoints/${attemptId}/${step}`;
    if (sha) this.git.point(ref, sha);
    this.db.writeCheckpoint({
      attemptId,
      step,
      wipRef: sha ? ref : null,
      manifestJson: JSON.stringify(brief.manifest),
      briefText: brief.text,
      now: this.now(),
    });
    return sha ? ref : "";
  }

  private noteInfra(task: ReadyTask, attemptId: string, code: string, message: string): boolean {
    const fingerprint = `${code}:${message}`;
    if (this.infraStreak?.fingerprint === fingerprint) this.infraStreak.count += 1;
    else this.infraStreak = { fingerprint, count: 1 };
    if ((this.infraStreak?.count ?? 0) < 2) return false;
    const cardMessage =
      code === "503" || /\b5\d\d\b/.test(`${code} ${message}`)
        ? "Provider temporarily unavailable"
        : message || "Infrastructure action required";
    this.card = { kind: "infrastructure", message: cardMessage, fingerprint, pausedAt: this.now() };
    this.infraPaused = true;
    this.setStatus("paused_infrastructure");
    this.emit(task.id, "INFRA_PAUSE", attemptId, task.branch, cardMessage);
    return true;
  }

  private async advanceWaves(): Promise<boolean> {
    await this.completeFeatures();
    const wave = this.db.currentWave();
    const features = this.db.featuresInWave(wave);
    if (features.length === 0 || features.some((feature) => feature.state !== "DONE")) return false;
    if (this.advancedWaves.has(wave)) return false;
    this.advancedWaves.add(wave);
    if (this.db.featuresInWave(wave + 1).length > 0) {
      this.db.setCurrentWave(wave + 1);
      return true;
    }
    const compiled = await this.wave.compile({ completedWave: wave });
    this.jitWaves.push(wave);
    if (compiled.status === "architecture_mismatch") {
      this.repair.repair({ wave: wave + 1, message: compiled.message });
      this.repairInvoked = true;
      this.terminal = true;
      this.setStatus("wave_transition_halted");
      this.emit("wave", "WAVE_HALTED", "", "", compiled.message);
      return false;
    }
    if (compiled.status === "final_wave") {
      const launched = this.completion.launch({ afterWave: wave });
      this.completionLaunched = launched.launched;
      this.terminal = true;
      this.setStatus("completion_wave_launched");
      this.emit("wave", "COMPLETION_WAVE", "", "", launched.name);
      return false;
    }
    for (const feature of compiled.features) this.git.branch(feature.branch, "harness/integration");
    this.db.installWave(compiled.features, compiled.tasks);
    this.db.setCurrentWave(wave + 1);
    return true;
  }

  private async completeFeatures(): Promise<void> {
    const features = this.db.featuresInState(["IN_WAVE", "LEAVES_MERGED"]);
    for (const feature of features) {
      if (this.integrated.has(feature.id)) continue;
      if (feature.state === "IN_WAVE") {
        if (!this.db.featureHeadTasksMerged(feature.id)) continue;
        if (!this.db.advanceLeavesMerged(feature.id)) continue;
        this.leavesMerged.push(feature.id);
        this.emit(feature.id, "LEAVES_MERGED", "", feature.branch, feature.branch);
      }
      const head = this.git.head(feature.branch);
      const integration = await this.integrator.integrate({
        featureId: feature.id,
        branch: feature.branch,
        headSha: head,
      });
      this.integratorCalls.push(feature.id);
      this.integrated.add(feature.id);
      const gate = this.doneGate.evaluate(feature.id, integration);
      if (!gate.ok) continue;
      this.db.setFeatureState(feature.id, "DONE");
      if (this.db.featureHasPhase0(feature.id)) this.db.setGate0("PASSED");
      this.featureDone.push(feature.id);
      this.emit(feature.id, "FEATURE_DONE", "", feature.branch, integration.mergedSha ?? "");
    }
  }

  private async idleForUser(block: boolean): Promise<"resume" | "stop" | "return"> {
    this.idleWaits += 1;
    this.setStatus("idle_waiting_on_user");
    if (!block) return "return";
    const event = await this.bus.wait(
      (item) =>
        item.type === "stop" ||
        item.type === "budget_wind_down" ||
        item.type === "task_hold_released" ||
        item.type === "user_replied",
    );
    if (event.type === "stop") {
      this.stopRequested = true;
      this.setStatus("stopped");
      return "stop";
    }
    if (event.type === "budget_wind_down") {
      this.budgetWindDown = true;
      this.setStatus("paused_budget");
      return "stop";
    }
    if (event.type === "user_replied") this.db.resumeWaiting(event.taskId);
    this.setStatus("running");
    return "resume";
  }

  private blankReceipt(open: OpenAttempt, briefTokens: number, hintStep: number): AttemptReceipt {
    return {
      attemptId: open.attemptId,
      taskId: open.task.id,
      claimedAt: open.claimedAt,
      briefTokens,
      workerTurns: 0,
      costMicroUsd: 0,
      verifierVerdict: "pending",
      mergedCommitSha: null,
      smokeMs: null,
      phase: "CLAIMED",
      hintStep,
      staticAudit: "pending",
      detail: "",
    };
  }

  private persist(receipt: AttemptReceipt, phase: PhaseName, detail?: string): void {
    receipt.phase = phase;
    if (detail !== undefined) receipt.detail = detail;
    this.db.saveReceipt(receipt, this.now());
  }

  private emit(taskId: string, phase: PhaseName, attemptId: string, branch: string, detail: string): void {
    let featureSha = "";
    if (branch) {
      try {
        featureSha = this.git.head(branch);
      } catch {
        featureSha = "";
      }
    }
    this.events.push({ taskId, phase, attemptId, featureSha, detail });
  }

  private setStatus(status: RunnerStatus): void {
    this.statusValue = status;
    const ready = this.statusWaiters.filter((waiter) => waiter.status === status);
    this.statusWaiters = this.statusWaiters.filter((waiter) => waiter.status !== status);
    for (const waiter of ready) waiter.resolve();
  }

  private report(): RunReport {
    return {
      status: this.statusValue,
      claimed: [...this.claimed],
      merged: [...this.merged],
      events: [...this.events],
      card: this.card,
      completionLaunched: this.completionLaunched,
      repairInvoked: this.repairInvoked,
      integratorCalls: [...this.integratorCalls],
      jitWaves: [...this.jitWaves],
      leavesMerged: [...this.leavesMerged],
      featureDone: [...this.featureDone],
    };
  }
}

function adaptNativeWorker(loop: NativeWorkerLoop): NativeWorkerLoopPort {
  return {
    async run(context) {
      const result = await loop.runAttempt(context.attemptId);
      if (result.countsAsWorkerFailure) {
        return {
          ok: false,
          turns: result.step,
          costMicroUsd: result.settledUnits,
          errorClass: "code",
          message: result.reason,
        };
      }
      return { ok: true, turns: result.step, costMicroUsd: result.settledUnits };
    },
  };
}

function isInfra(result: WorkerResult): boolean {
  return result.errorClass === "infrastructure";
}
