import { ambiguousHoldExplanation, clarificationQuestion, compileBrief, joinOr, selectReadings } from "./format.js";
import { HoldStore, withImmediateTransaction, type StoredReading } from "./database.js";
import { HoldModeClassifier } from "./classifier.js";
import type { DatabaseSync } from "node:sqlite";
import type {
  AcceptCandidateInput,
  CandidateAcceptancePort,
  HoldSurfacePort,
  InboxPort,
  ReverseImpactWalkerPort,
  WorkerSessionPort,
} from "./ports.js";
import { HoldReasonStackCoordinator } from "./reason-stack.js";
import { AdditiveVsContradictoryResumer, type DeltaInspection } from "./resumer.js";
import {
  AMBIGUITY_REMINDER_AFTER_MS,
  HoldEngineError,
  type AmbiguousMidBuildMessage,
  type CheckpointView,
  type ClarificationCard,
  type CompiledBrief,
  type HoldPlacement,
  type HoldPlacementResult,
  type HoldVisibilityEntry,
  type MergeDecision,
  type QuarantineFinish,
  type ReminderPill,
  type ResolutionResult,
  type TaskResolution,
  type TaskSnapshot,
} from "./types.js";

export interface StageFault {
  readonly after: number;
  readonly message: string;
}

export interface HoldEngineOptions {
  readonly db: DatabaseSync;
  readonly walker: ReverseImpactWalkerPort;
  readonly worker?: WorkerSessionPort;
  readonly acceptance?: CandidateAcceptancePort;
  readonly inbox?: InboxPort;
  readonly surfaces?: HoldSurfacePort;
  readonly clock?: () => number;
  readonly classifier?: HoldModeClassifier;
}

interface TaskPlan {
  readonly taskId: string;
  readonly checkpoint: CheckpointView;
  readonly nextBrief: CompiledBrief;
  readonly inspection: DeltaInspection;
  readonly land: "none" | "fresh" | "reverified" | "blocked" | "discard";
  readonly landSha: string | null;
  readonly landHead: string | null;
  remaining: number;
}

/**
 * Per-reading affected-set traversal. Holds only the union of every plausible
 * reading, asks with one clarification card, and resumes from the reason stack.
 */
export class MultiInterpretationHoldEngine {
  readonly store: HoldStore;
  readonly stack: HoldReasonStackCoordinator;
  readonly classifier: HoldModeClassifier;
  readonly resumer: AdditiveVsContradictoryResumer;
  readonly worker: WorkerSessionPort;
  readonly acceptance: CandidateAcceptancePort;
  readonly inbox: InboxPort;
  readonly surfaces: HoldSurfacePort;
  private readonly walker: ReverseImpactWalkerPort;
  private readonly clock: () => number;

  constructor(options: HoldEngineOptions) {
    this.store = new HoldStore(options.db);
    this.stack = new HoldReasonStackCoordinator(this.store);
    this.classifier = options.classifier ?? new HoldModeClassifier();
    this.worker = options.worker ?? rejectWorker();
    this.acceptance = options.acceptance ?? rejectAcceptance();
    this.inbox = options.inbox ?? silentInbox();
    this.surfaces = options.surfaces ?? silentSurfaces();
    this.resumer = new AdditiveVsContradictoryResumer(this.worker);
    this.walker = options.walker;
    this.clock = options.clock ?? (() => Date.now());
  }

  holdAmbiguousMessage(
    message: AmbiguousMidBuildMessage,
    catalog: readonly TaskSnapshot[],
    options?: { readonly stageFault?: StageFault },
  ): HoldPlacementResult {
    if (message.alternateReadings.length < 2) {
      throw new HoldEngineError("ambiguous hold requires k >= 2 readings");
    }
    const byId = new Map<string, TaskSnapshot>();
    for (const task of catalog) {
      assertProgress(task);
      byId.set(task.taskId, task);
    }
    const hitsByTask = new Map<string, string[]>();
    for (const reading of message.alternateReadings) {
      const impact = this.walker.walkCombined(reading.targetNodeIds);
      for (const taskId of impact.affectedActiveTasks) {
        if (!byId.has(taskId)) throw new HoldEngineError(`impact returned unknown task ${taskId}`);
        const list = hitsByTask.get(taskId) ?? [];
        list.push(reading.id);
        hitsByTask.set(taskId, list);
      }
    }
    const labels = message.alternateReadings.map((reading) => reading.label);
    const explanation = ambiguousHoldExplanation(message.subject, labels);
    const affected = [...hitsByTask.keys()].sort();
    const untouched = catalog.map((task) => task.taskId).filter((taskId) => !hitsByTask.has(taskId)).sort();
    const placements: HoldPlacement[] = [];
    const hard: TaskSnapshot[] = [];
    const soft: TaskSnapshot[] = [];
    const now = this.clock();
    const trace: string[] = [];
    const card: ClarificationCard = {
      messageId: message.messageId,
      question: clarificationQuestion(message.subject, labels),
      subject: message.subject,
      options: message.alternateReadings.map((reading) => ({
        readingId: reading.id,
        featureId: reading.featureId,
        label: reading.label,
      })),
      affectedTaskIds: affected,
      cardCount: 1,
    };

    withImmediateTransaction(
      this.store.db,
      () => {
        for (const task of catalog) this.store.seedCheckpoint(task);
        for (const reading of message.alternateReadings) {
          this.store.saveReading({
            messageId: message.messageId,
            messageText: message.text,
            subject: message.subject,
            readingId: reading.id,
            featureId: reading.featureId,
            label: reading.label,
            changeKind: reading.changeKind,
            deltaText: reading.deltaText,
            replacementBrief: reading.replacementBrief ?? null,
            contradictedTokens: reading.contradictedTokens ?? [],
            targetNodeIds: reading.targetNodeIds,
          });
        }
        let staged = 0;
        for (const taskId of affected) {
          const task = byId.get(taskId);
          if (!task) throw new HoldEngineError(`missing catalog task ${taskId}`);
          const hitIds = hitsByTask.get(taskId) ?? [];
          const destructive = message.alternateReadings.some(
            (reading) => hitIds.includes(reading.id) && reading.changeKind === "contradictory",
          );
          const decision = this.classifier.classify({
            progress: task.progress,
            state: task.state,
            impacted: true,
            destructive,
          });
          if (decision.action === "continue") continue;
          for (const readingId of hitIds) this.store.saveHit(message.messageId, taskId, readingId);
          this.stack.stage({
            taskId,
            featureId: task.featureId,
            reasonType: "ambiguous_message",
            reasonRefId: message.messageId,
            mode: decision.action,
            quarantine: decision.quarantine,
            explanation,
            messageId: message.messageId,
            createdAt: now,
          });
          placements.push({
            taskId,
            featureId: task.featureId,
            mode: decision.action,
            quarantine: decision.quarantine,
            holdKey: `ambiguous_message_${message.messageId}`,
            explanation,
          });
          if (decision.action === "HARD_HOLD") hard.push(task);
          else soft.push(task);
          staged += 1;
          if (options?.stageFault && staged === options.stageFault.after) {
            throw new HoldEngineError(options.stageFault.message);
          }
        }
        this.store.saveCard(card, now);
      },
      trace,
    );

    for (const task of hard) {
      this.worker.interruptAtStepBoundary({
        taskId: task.taskId,
        sessionRef: task.sessionRef,
        step: task.step,
        sliceSha256: task.sliceSha256,
        briefText: task.briefText,
      });
    }
    for (const task of soft) {
      this.worker.allowCurrentStep({ taskId: task.taskId, sessionRef: task.sessionRef });
    }
    this.inbox.publishClarification(card);
    this.surfaces.publish(this.visibility());
    return {
      messageId: message.messageId,
      affectedTaskIds: affected,
      untouchedTaskIds: untouched,
      placements,
      card,
      walkerCalls: message.alternateReadings.length,
      transaction: trace,
    };
  }

  noteVerificationFinished(taskId: string, finish: QuarantineFinish): void {
    const soft = this.stack.list(taskId).find((hold) => hold.mode === "SOFT_HOLD" && hold.quarantine);
    if (!soft) throw new HoldEngineError(`${taskId} has no soft quarantine hold`);
    withImmediateTransaction(this.store.db, () => {
      this.store.saveCandidate({
        taskId,
        commitSha: finish.commitSha,
        baseCommit: finish.baseCommit,
        attempt: finish.attempt,
        receivedAt: this.clock(),
        status: "submission_pending",
      });
      this.store.setSubmissionPending(taskId, true);
    });
  }

  mergeDecision(taskId: string): MergeDecision {
    if (this.stack.activeCount(taskId) > 0) return { taskId, allowed: false, reason: "held" };
    const candidate = this.store.loadCandidate(taskId);
    if (
      (candidate && (candidate.status === "submission_pending" || candidate.status === "reverify_failed")) ||
      this.store.submissionPending(taskId)
    ) {
      return { taskId, allowed: false, reason: "quarantine" };
    }
    return { taskId, allowed: true, reason: "clear" };
  }

  resolveClarification(
    input: { readonly messageId: string; readonly reply: string } | { readonly messageId: string; readonly selectedReadingIds: readonly string[] },
    options?: { readonly releaseFault?: StageFault },
  ): ResolutionResult {
    const stored = this.store.loadReadings(input.messageId);
    if (stored.length < 2) throw new HoldEngineError("ambiguous message is missing its readings");
    if (this.store.cardStatus(input.messageId) !== "open") {
      throw new HoldEngineError(`clarification ${input.messageId} is not open`);
    }
    const message = messageFromStore(input.messageId, stored);
    const selected = "reply" in input ? selectFromReply(message, input.reply) : matchIds(stored, input.selectedReadingIds);
    const selectedIds = new Set(selected.map((reading) => reading.id));
    const plans = this.planResolution(input.messageId, stored, selectedIds);
    const trace: string[] = [];
    const started = performance.now();
    withImmediateTransaction(
      this.store.db,
      () => {
        this.store.markCardResolved(input.messageId);
        let cleared = 0;
        for (const plan of plans) {
          this.stack.deleteWithinTransaction(plan.taskId, "ambiguous_message", input.messageId);
          cleared += 1;
          if (options?.releaseFault && cleared === options.releaseFault.after) {
            throw new HoldEngineError(options.releaseFault.message);
          }
          plan.remaining = this.stack.activeCount(plan.taskId);
          if (plan.remaining > 0) continue;
          this.applyQuarantine(plan);
        }
      },
      trace,
    );
    const elapsedMs = performance.now() - started;
    const tasks = plans.map((plan) => this.finishResolution(plan, elapsedMs));
    this.surfaces.publish(this.visibility());
    return {
      messageId: input.messageId,
      selectedReadingIds: selected.map((reading) => reading.id),
      tasks,
      transaction: trace,
    };
  }

  advanceFeatureHead(featureId: string, commitSha: string): void {
    this.store.advanceFeatureHead(featureId, commitSha);
  }

  tickReminders(now = this.clock()): readonly ReminderPill[] {
    const pills: ReminderPill[] = [];
    for (const messageId of this.store.openAmbiguousMessageIds()) {
      const createdAt = this.store.cardCreatedAt(messageId);
      if (createdAt === null || now - createdAt <= AMBIGUITY_REMINDER_AFTER_MS) continue;
      const blockedCriticalTaskIds = this.store.criticalHeldTasks(messageId);
      if (blockedCriticalTaskIds.length === 0 || this.store.reminderExists(messageId)) continue;
      const card = this.store.loadCard(messageId);
      if (!card) continue;
      const text = `Still waiting to confirm whether '${card.subject}' applies to ${joinOr(card.options.map((option) => option.label))}.`;
      const pill: ReminderPill = {
        messageId,
        tone: "calm",
        text,
        autoGuessed: false,
        blockedCriticalTaskIds,
      };
      this.store.saveReminder(messageId, now, text);
      this.inbox.publishReminder(pill);
      pills.push(pill);
    }
    return pills;
  }

  visibility(): readonly HoldVisibilityEntry[] {
    return this.stack.listAll().map((hold) => ({
      taskId: hold.taskId,
      featureId: hold.featureId,
      holdKey: hold.holdKey,
      reasonType: hold.reasonType,
      reasonRefId: hold.reasonRefId,
      mode: hold.mode,
      explanation: hold.explanation,
      board: true as const,
      inspector: true as const,
    }));
  }

  activeHoldCount(taskId: string): number {
    return this.stack.activeCount(taskId);
  }

  private planResolution(messageId: string, stored: readonly StoredReading[], selectedIds: ReadonlySet<string>): TaskPlan[] {
    return this.store.affectedTaskIds(messageId).map((taskId) => {
      const hitIds = this.store.hitReadingIds(messageId, taskId);
      const selectedHits = stored.filter((reading) => selectedIds.has(reading.id) && hitIds.includes(reading.id));
      const checkpoint = this.store.loadCheckpoint(taskId);
      const nextBrief = compileBrief(
        {
          sliceSha256: checkpoint.sliceSha256,
          text: checkpoint.briefText,
          requirements: checkpoint.requirements,
        },
        selectedHits,
      );
      const inspection = this.resumer.inspect(checkpoint, nextBrief);
      const candidate = this.store.loadCandidate(taskId);
      const pending = candidate?.status === "submission_pending" ? candidate : null;
      const others = this.stack.list(taskId).filter((hold) => hold.holdKey !== `ambiguous_message_${messageId}`).length;
      if (others > 0 || !pending) {
        return {
          taskId,
          checkpoint,
          nextBrief,
          inspection,
          land: "none" as const,
          landSha: null,
          landHead: null,
          remaining: others,
        };
      }
      if (inspection.kind !== "none") {
        return {
          taskId,
          checkpoint,
          nextBrief,
          inspection,
          land: "discard" as const,
          landSha: null,
          landHead: null,
          remaining: 0,
        };
      }
      const head = this.store.featureHead(checkpoint.featureId);
      if (head === pending.baseCommit) {
        return {
          taskId,
          checkpoint,
          nextBrief,
          inspection,
          land: "fresh" as const,
          landSha: pending.commitSha,
          landHead: head,
          remaining: 0,
        };
      }
      const reverified = this.acceptance.reverify({
        taskId,
        commitSha: pending.commitSha,
        fromBase: pending.baseCommit,
        toHead: head,
      });
      if (!reverified.ok) {
        return {
          taskId,
          checkpoint,
          nextBrief,
          inspection,
          land: "blocked" as const,
          landSha: null,
          landHead: head,
          remaining: 0,
        };
      }
      return {
        taskId,
        checkpoint,
        nextBrief,
        inspection,
        land: "reverified" as const,
        landSha: reverified.commitSha,
        landHead: head,
        remaining: 0,
      };
    });
  }

  private applyQuarantine(plan: TaskPlan): void {
    if (plan.land === "fresh" || plan.land === "reverified") {
      const commitSha = plan.landSha;
      const baseHead = plan.landHead;
      if (commitSha === null || baseHead === null) throw new HoldEngineError(`missing land target for ${plan.taskId}`);
      const accepted: AcceptCandidateInput = {
        taskId: plan.taskId,
        commitSha,
        baseHead,
        reverified: plan.land === "reverified",
      };
      this.acceptance.accept(accepted);
      this.store.setCandidateStatus(plan.taskId, "landed", commitSha);
      this.store.setSubmissionPending(plan.taskId, false);
      return;
    }
    if (plan.land === "discard") {
      this.store.setCandidateStatus(plan.taskId, "discarded");
      this.store.setSubmissionPending(plan.taskId, false);
      return;
    }
    if (plan.land === "blocked") {
      this.store.setCandidateStatus(plan.taskId, "reverify_failed");
    }
  }

  private finishResolution(plan: TaskPlan, elapsedMs: number): TaskResolution {
    if (plan.remaining > 0) {
      return {
        taskId: plan.taskId,
        holdCount: plan.remaining,
        delta: "blocked",
        session: "still_held",
        quarantine: "none",
        elapsedMs: null,
        landedCommitSha: null,
        sessionRef: plan.checkpoint.sessionRef,
        steeringNote: null,
        salvagedWip: [],
        discardedWip: [],
        workerModelTurn: false,
      };
    }
    const applied = this.resumer.apply(plan.checkpoint, plan.nextBrief);
    if (applied.sessionRef !== plan.checkpoint.sessionRef) {
      this.store.updateSession(plan.taskId, applied.sessionRef);
    }
    const landed = plan.land === "fresh" || plan.land === "reverified";
    return {
      taskId: plan.taskId,
      holdCount: 0,
      delta: applied.kind,
      session: sessionOf(applied.kind),
      quarantine: quarantineOf(plan.land),
      elapsedMs: landed ? elapsedMs : null,
      landedCommitSha: landed ? plan.landSha : null,
      sessionRef: applied.sessionRef,
      steeringNote: applied.note,
      salvagedWip: applied.salvagedWip,
      discardedWip: applied.discardedWip,
      workerModelTurn: false,
    };
  }
}

function sessionOf(kind: DeltaInspection["kind"]): TaskResolution["session"] {
  if (kind === "additive") return "warm_note";
  if (kind === "contradictory") return "fresh";
  return "unchanged";
}

function quarantineOf(land: TaskPlan["land"]): TaskResolution["quarantine"] {
  if (land === "fresh") return "landed";
  if (land === "reverified") return "reverified";
  if (land === "blocked") return "blocked_drift";
  if (land === "discard") return "discarded";
  return "none";
}

function assertProgress(task: TaskSnapshot): void {
  if (!Number.isFinite(task.progress) || task.progress < 0 || task.progress > 1) {
    throw new HoldEngineError(`task ${task.taskId} progress must be a fraction from 0 to 1`);
  }
}

function messageFromStore(messageId: string, stored: readonly StoredReading[]): AmbiguousMidBuildMessage {
  const first = stored[0];
  if (!first) throw new HoldEngineError("ambiguous message is missing its readings");
  return {
    messageId,
    text: first.messageText,
    subject: first.subject,
    alternateReadings: stored.map((reading) => ({
      id: reading.id,
      featureId: reading.featureId,
      label: reading.label,
      targetNodeIds: reading.targetNodeIds,
      changeKind: reading.changeKind,
      deltaText: reading.deltaText,
      ...(reading.replacementBrief !== null ? { replacementBrief: reading.replacementBrief } : {}),
      ...(reading.contradictedTokens.length > 0 ? { contradictedTokens: reading.contradictedTokens } : {}),
    })),
  };
}

function selectFromReply(message: AmbiguousMidBuildMessage, reply: string): readonly StoredReading[] {
  const chosen = selectReadings(message, reply);
  return chosen.map((reading) => ({
    id: reading.id,
    featureId: reading.featureId,
    label: reading.label,
    targetNodeIds: reading.targetNodeIds,
    changeKind: reading.changeKind,
    deltaText: reading.deltaText,
    replacementBrief: reading.replacementBrief ?? null,
    contradictedTokens: reading.contradictedTokens ?? [],
    subject: message.subject,
    messageText: message.text,
  }));
}

function matchIds(stored: readonly StoredReading[], ids: readonly string[]): StoredReading[] {
  const wanted = new Set(ids);
  const hits = stored.filter((reading) => wanted.has(reading.id));
  if (hits.length === 0) throw new HoldEngineError("clarification reply did not select a reading");
  return hits;
}

function silentInbox(): InboxPort {
  return {
    publishClarification() {
      return undefined;
    },
    publishReminder() {
      return undefined;
    },
  };
}

function silentSurfaces(): HoldSurfacePort {
  return {
    publish() {
      return undefined;
    },
  };
}

function rejectWorker(): WorkerSessionPort {
  const fail = (): never => {
    throw new HoldEngineError("worker session port is not configured");
  };
  return {
    interruptAtStepBoundary: fail,
    allowCurrentStep: fail,
    resumeExistingCheckpoint: fail,
    resumeWithSignedNote: fail,
    reconstructFreshSession: fail,
  };
}

function rejectAcceptance(): CandidateAcceptancePort {
  return {
    reverify: () => {
      throw new HoldEngineError("candidate acceptance port is not configured");
    },
    accept: () => {
      throw new HoldEngineError("candidate acceptance port is not configured");
    },
  };
}
