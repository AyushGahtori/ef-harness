import { FEATURE_UNDO_ACTOR, INBOX_HOLD_REASON, type SettledSource } from "./constants.js";
import { isUniqueConstraint, type QuestionQueueStore } from "./database.js";
import { InvalidQuestionError, QuestionNotFoundError } from "./errors.js";
import type { CriticalPathPort } from "./ports.js";
import {
  classifyPriority,
  holdModeFor,
  humanReasonFor,
  normalizeSignals,
  placesWorkerHold,
} from "./priority.js";
import { assertToken, concreteOptions, normalizeTopic, questionKey, replyText } from "./text.js";
import type { AdmitResult, QuestionCard, QuestionReply, WorkerQuestionRequest } from "./types.js";

export class QuestionDedupSubscriberStore {
  constructor(
    private readonly store: QuestionQueueStore,
    private readonly criticalPath: CriticalPathPort,
    private readonly now: () => number,
  ) {}

  admit(request: WorkerQuestionRequest): AdmitResult {
    return this.store.transaction(() => this.admitLocked(request));
  }

  unsubscribe(questionId: string, taskId: string): QuestionCard {
    return this.store.transaction(() => this.unsubscribeLocked(questionId, taskId));
  }

  cancelTask(taskId: string): readonly QuestionCard[] {
    return this.store.transaction(() => {
      const ids = this.store.openQuestionIdsForTask(taskId);
      return ids.map((questionId) => this.unsubscribeLocked(questionId, taskId));
    });
  }

  settleOpen(card: QuestionCard, reply: QuestionReply): readonly string[] {
    this.assertSelectable(card, reply);
    const answer = replyText(card, reply);
    const resolvedAt = this.now();
    this.store.markAnswered({
      questionId: card.questionId,
      answer,
      optionId: reply.optionId ?? null,
      settledBy: "developer",
      resolvedAt,
    });
    const woken = this.wakeActive(card.questionId, answer, resolvedAt);
    this.rememberDecision(card, answer, "decision");
    this.store.syncProjection(card.questionId);
    this.store.appendOutbox(
      "QuestionSettled",
      card.questionId,
      { questionId: card.questionId, answer, wokenTaskIds: woken, optionsVersion: card.optionsVersion },
      resolvedAt,
    );
    return woken;
  }

  applyExplicitChange(card: QuestionCard, reply: QuestionReply): readonly string[] {
    const answer = replyText(card, reply);
    const resolvedAt = this.now();
    this.store.markAnswered({
      questionId: card.questionId,
      answer,
      optionId: reply.optionId ?? null,
      settledBy: "developer",
      resolvedAt,
    });
    const woken = this.wakeActive(card.questionId, answer, resolvedAt);
    this.rememberDecision(card, answer, "decision");
    this.store.syncProjection(card.questionId);
    this.store.appendOutbox(
      "QuestionSettled",
      card.questionId,
      { questionId: card.questionId, answer, wokenTaskIds: woken, optionsVersion: card.optionsVersion, explicitChange: true },
      resolvedAt,
    );
    return woken;
  }

  reviseOptions(questionId: string, labels: readonly string[], recommendedOptionId?: string): QuestionCard {
    return this.store.transaction(() => {
      const card = this.requireOpen(questionId);
      const built = concreteOptions(card.text, card.kind, labels, recommendedOptionId);
      const version = card.optionsVersion + 1;
      this.store.reviseOptions(questionId, built.options, built.recommendedOptionId, version);
      this.store.syncProjection(questionId);
      return this.requireCard(questionId);
    });
  }

  retireFeature(featureId: string, reason: "feature_undone" | "revision_superseded"): readonly QuestionCard[] {
    return this.store.transaction(() => {
      const open = this.store.listOpenForFeature(featureId);
      for (const card of open) {
        const settledBy = reason === "feature_undone" ? FEATURE_UNDO_ACTOR : "revision";
        this.retireLocked(card, reason, { settledBy });
      }
      return open.map((card) => this.requireCard(card.questionId));
    });
  }

  retireQuestion(
    questionId: string,
    reason: string,
    settled?: { readonly answer?: string; readonly settledBy: string; readonly source?: SettledSource },
  ): QuestionCard {
    return this.store.transaction(() => {
      const card = this.requireOpen(questionId);
      this.retireLocked(card, reason, settled);
      return this.requireCard(questionId);
    });
  }

  retireMany(
    questionIds: readonly string[],
    reason: string,
    settled?: { readonly answer?: string; readonly settledBy: string; readonly source?: SettledSource },
  ): readonly QuestionCard[] {
    return this.store.transaction(() => {
      for (const questionId of questionIds) {
        const card = this.store.getCard(questionId);
        if (!card || card.status !== "open") continue;
        this.retireLocked(card, reason, settled);
      }
      return questionIds.flatMap((questionId) => {
        const card = this.store.getCard(questionId);
        return card ? [card] : [];
      });
    });
  }

  noteCriticalPath(taskId: string, critical: boolean): readonly QuestionCard[] {
    return this.store.transaction(() => {
      this.criticalPath.mark(taskId, critical);
      const affected = this.store
        .listOpen()
        .filter((card) => card.subscribers.some((subscriber) => subscriber.active && subscriber.waitingTaskId === taskId));
      for (const card of affected) this.recompute(card.questionId);
      return affected.map((card) => this.requireCard(card.questionId));
    });
  }

  private admitLocked(request: WorkerQuestionRequest): AdmitResult {
    this.assertRequest(request);
    const key = questionKey(request);
    const existing = this.store.findOpenByKey(key);
    if (existing) return this.join(existing, request);
    try {
      return this.create(request, key);
    } catch (error) {
      if (!isUniqueConstraint(error)) throw error;
      const winner = this.store.findOpenByKey(key);
      if (!winner) throw error;
      return this.join(winner, request);
    }
  }

  private create(request: WorkerQuestionRequest, key: string): AdmitResult {
    if (request.questionId !== undefined && this.store.getCard(request.questionId)) {
      throw new InvalidQuestionError(`Question ${request.questionId} already exists.`);
    }
    const createdAt = this.now();
    const questionId = request.questionId ?? this.store.nextId("question", "Q");
    if (request.onCriticalPath === true) this.criticalPath.mark(request.waitingTaskId, true);
    const onCriticalPath = request.onCriticalPath === true || this.criticalPath.isCritical(request.waitingTaskId);
    const signals = normalizeSignals(request.signals);
    const priority = classifyPriority({
      kind: request.kind,
      onCriticalPath,
      blockedWorkerCount: 1,
      signals,
    });
    const options = concreteOptions(request.text, request.kind, request.options, request.recommendedOptionId);
    this.store.insertQuestion({
      id: questionId,
      buildId: request.buildId,
      questionKey: key,
      scopeId: request.scopeId ?? null,
      criterionId: request.criterionId ?? null,
      featureId: request.featureId ?? null,
      contractId: request.contractId ?? null,
      kind: request.kind,
      humanReason: humanReasonFor(request.kind),
      text: request.text.trim(),
      priority,
      options: options.options,
      recommendedOptionId: options.recommendedOptionId,
      signals,
      onCriticalPath,
      createdAt,
    });
    this.store.addSubscriber(questionId, request.waitingTaskId, request.waitingRole, createdAt);
    this.store.updateDelivery(questionId, { priority, onCriticalPath, blockedWorkerCount: 1 });
    this.hold(questionId, request.waitingTaskId, request.kind, priority);
    this.store.syncProjection(questionId);
    this.store.appendOutbox(
      "InboxItemCreated",
      questionId,
      { questionId, questionKey: key, priority, blockedWorkerCount: 1 },
      createdAt,
    );
    return { card: this.requireCard(questionId), created: true, newSubscriber: true };
  }

  private join(card: QuestionCard, request: WorkerQuestionRequest): AdmitResult {
    if (request.onCriticalPath === true) this.criticalPath.mark(request.waitingTaskId, true);
    const membership = this.store.addSubscriber(card.questionId, request.waitingTaskId, request.waitingRole, this.now());
    this.recompute(card.questionId);
    return {
      card: this.requireCard(card.questionId),
      created: false,
      newSubscriber: membership !== "exists",
    };
  }

  private unsubscribeLocked(questionId: string, taskId: string): QuestionCard {
    const card = this.requireOpen(questionId);
    const removed = this.store.deactivateSubscriber(questionId, taskId);
    if (!removed) return card;
    this.store.clearHold(taskId, INBOX_HOLD_REASON, questionId);
    const active = this.store.activeSubscribers(questionId);
    if (active.length === 0) {
      this.store.markRetired(questionId, "no_active_waiters", this.now());
      this.store.syncProjection(questionId);
      this.store.appendOutbox(
        "QuestionRetired",
        questionId,
        { questionId, retiredReason: "no_active_waiters" },
        this.now(),
      );
      return this.requireCard(questionId);
    }
    this.recompute(questionId);
    return this.requireCard(questionId);
  }

  private retireLocked(
    card: QuestionCard,
    reason: string,
    settled?: { readonly answer?: string; readonly settledBy: string; readonly source?: SettledSource },
  ): void {
    const tasks = this.store.deactivateAll(card.questionId);
    for (const taskId of tasks) this.store.clearHold(taskId, INBOX_HOLD_REASON, card.questionId);
    const resolvedAt = this.now();
    const answer = settled?.answer;
    this.store.markRetired(
      card.questionId,
      reason,
      resolvedAt,
      settled
        ? {
            answer: answer ?? null,
            settledBy: settled.settledBy,
          }
        : undefined,
    );
    if (answer !== undefined) {
      this.rememberDecision(card, answer, settled?.source ?? "rule");
    }
    this.store.syncProjection(card.questionId);
    this.store.appendOutbox("QuestionRetired", card.questionId, { questionId: card.questionId, retiredReason: reason }, resolvedAt);
  }

  private recompute(questionId: string): void {
    const card = this.requireCard(questionId);
    const active = this.store.activeSubscribers(questionId);
    const onCriticalPath = active.some((subscriber) => this.criticalPath.isCritical(subscriber.waitingTaskId));
    const priority = classifyPriority({
      kind: card.kind,
      onCriticalPath,
      blockedWorkerCount: active.length,
      signals: card.signals,
    });
    this.store.updateDelivery(questionId, {
      priority,
      onCriticalPath,
      blockedWorkerCount: active.length,
    });
    for (const subscriber of active) this.hold(questionId, subscriber.waitingTaskId, card.kind, priority);
    this.store.syncProjection(questionId);
  }

  private hold(questionId: string, taskId: string, kind: QuestionCard["kind"], priority: QuestionCard["priority"]): void {
    if (!placesWorkerHold(kind)) return;
    this.store.placeHold({
      taskId,
      reasonType: INBOX_HOLD_REASON,
      reasonRefId: questionId,
      mode: holdModeFor(priority),
    });
  }

  private wakeActive(questionId: string, answer: string, createdAt: number): string[] {
    const woken: string[] = [];
    for (const subscriber of this.store.activeSubscribers(questionId)) {
      this.store.clearHold(subscriber.waitingTaskId, INBOX_HOLD_REASON, questionId);
      this.store.insertWake(questionId, subscriber.waitingTaskId, answer, createdAt);
      woken.push(subscriber.waitingTaskId);
    }
    return woken;
  }

  private rememberDecision(card: QuestionCard, answer: string, source: SettledSource): void {
    this.store.registerFact({
      text: card.text,
      answer,
      source,
      topicKey: card.questionKey,
      normalizedText: normalizeTopic(card.text),
      ...(card.scopeId === null ? {} : { scopeId: card.scopeId }),
      ...(card.criterionId === null ? {} : { criterionId: card.criterionId }),
    });
  }

  private assertRequest(request: WorkerQuestionRequest): void {
    assertToken(request.buildId, "buildId");
    assertToken(request.workerId, "workerId");
    assertToken(request.waitingTaskId, "waitingTaskId");
    assertToken(request.waitingRole, "waitingRole");
    if (request.text.trim().length === 0) throw new InvalidQuestionError("Question text is required.");
    if (request.questionId !== undefined) assertToken(request.questionId, "questionId");
    if (request.scopeId !== undefined) assertToken(request.scopeId, "scopeId");
    if (request.criterionId !== undefined) assertToken(request.criterionId, "criterionId");
  }

  private assertSelectable(card: QuestionCard, reply: QuestionReply): void {
    if (reply.optionId !== undefined && !card.options.some((option) => option.id === reply.optionId)) {
      throw new InvalidQuestionError(`Option ${reply.optionId} is not on ${card.questionId}.`);
    }
    replyText(card, reply);
  }

  private requireCard(questionId: string): QuestionCard {
    const card = this.store.getCard(questionId);
    if (!card) throw new QuestionNotFoundError(questionId);
    return card;
  }

  private requireOpen(questionId: string): QuestionCard {
    const card = this.requireCard(questionId);
    if (card.status !== "open") throw new InvalidQuestionError(`Question ${questionId} is ${card.status}.`);
    return card;
  }
}
