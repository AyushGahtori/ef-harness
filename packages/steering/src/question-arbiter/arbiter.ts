import { assessDelivery } from "./aging.js";
import type { QuestionQueueStore } from "./database.js";
import type { QuestionDedupSubscriberStore } from "./dedup.js";
import type { OwnerFirstQuestionFilter } from "./filter.js";
import type { InterruptionAudit } from "./metrics.js";
import { compareCards } from "./priority.js";
import type { StaleReplyReconciler } from "./reconciler.js";
import { InvalidQuestionError, QuestionNotFoundError, QuestionTransactionError } from "./errors.js";
import type {
  AnswerResult,
  ChoiceResult,
  DeliveryAssessment,
  FilterDisposition,
  InterruptionTotals,
  QuestionCard,
  QuestionReply,
  WorkerQuestionRequest,
} from "./types.js";

export class SharedQuestionArbiter {
  private focusMode = false;

  constructor(
    private readonly filter: OwnerFirstQuestionFilter,
    private readonly queue: QuestionDedupSubscriberStore,
    private readonly reconciler: StaleReplyReconciler,
    private readonly store: QuestionQueueStore,
    private readonly metrics: InterruptionAudit,
    private readonly now: () => number,
  ) {}

  submit(request: WorkerQuestionRequest): FilterDisposition {
    return this.filter.intercept(request);
  }

  answer(questionId: string, reply: QuestionReply): AnswerResult {
    const applied = this.trySettle(questionId, reply);
    if (applied) return applied;
    const reconciled = this.reconciler.receive(questionId, reply);
    if (reconciled.outcome === "fresh") {
      const retried = this.trySettle(questionId, reply);
      if (retried) return retried;
      throw new QuestionTransactionError("The question changed while it was being answered.");
    }
    return reconciled;
  }

  choose(pendingId: string, choice: "keep" | "change"): ChoiceResult {
    return this.reconciler.choose(pendingId, choice);
  }

  unsubscribe(questionId: string, taskId: string): QuestionCard {
    return this.queue.unsubscribe(questionId, taskId);
  }

  cancelTask(taskId: string): readonly QuestionCard[] {
    return this.queue.cancelTask(taskId);
  }

  reviseOptions(questionId: string, labels: readonly string[], recommendedOptionId?: string): QuestionCard {
    return this.queue.reviseOptions(questionId, labels, recommendedOptionId);
  }

  retireFeature(featureId: string, reason: "feature_undone" | "revision_superseded"): readonly QuestionCard[] {
    return this.queue.retireFeature(featureId, reason);
  }

  retireByEdit(input: {
    readonly questionId?: string;
    readonly scopeId?: string;
    readonly criterionId?: string;
    readonly featureId?: string;
    readonly source: "markdown_edit" | "canvas_edit";
    readonly settledAnswer?: string;
    readonly settledBy?: string;
  }): readonly QuestionCard[] {
    if (
      input.questionId === undefined &&
      input.scopeId === undefined &&
      input.criterionId === undefined &&
      input.featureId === undefined
    ) {
      throw new InvalidQuestionError("A direct edit needs a question, criterion, or feature.");
    }
    const settledBy = input.settledBy ?? (input.source === "markdown_edit" ? "VS Code edit" : "Canvas edit");
    const settled = {
      settledBy,
      source: "rule" as const,
      ...(input.settledAnswer === undefined ? {} : { answer: input.settledAnswer }),
    };
    if (input.questionId !== undefined) {
      return [this.queue.retireQuestion(input.questionId, input.source, settled)];
    }
    const targets = this.openTargets(input).map((card) => card.questionId);
    return this.queue.retireMany(targets, input.source, settled);
  }

  noteCriticalPath(taskId: string, critical = true): readonly QuestionCard[] {
    return this.queue.noteCriticalPath(taskId, critical);
  }

  setFocusMode(enabled: boolean): void {
    this.focusMode = enabled;
  }

  card(questionId: string): QuestionCard {
    const card = this.store.getCard(questionId);
    if (!card) throw new QuestionNotFoundError(questionId);
    return card;
  }

  activeQueue(now = this.now()): readonly QuestionCard[] {
    void now;
    return this.store.listOpen().sort(compareCards);
  }

  ranked(now = this.now()): readonly QuestionCard[] {
    return this.activeQueue(now);
  }

  surfaced(now = this.now(), focusMode = this.focusMode): readonly DeliveryAssessment[] {
    return this.store
      .listOpen()
      .sort(compareCards)
      .map((card) => assessDelivery(card, now, focusMode))
      .filter((assessment) => assessment.surfaced);
  }

  assessments(now = this.now(), focusMode = this.focusMode): readonly DeliveryAssessment[] {
    return this.store.listOpen().sort(compareCards).map((card) => assessDelivery(card, now, focusMode));
  }

  digest(now = this.now()): readonly QuestionCard[] {
    void now;
    return this.store
      .listOpen()
      .filter((card) => card.priority === "P4")
      .sort(compareCards);
  }

  interruptionTotals(buildId: string): InterruptionTotals {
    return this.metrics.totals(buildId);
  }

  private trySettle(questionId: string, reply: QuestionReply): AnswerResult | null {
    return this.store.transaction(() => {
      const card = this.store.getCard(questionId);
      if (!card) throw new QuestionNotFoundError(questionId);
      if (card.status !== "open" || card.optionsVersion !== reply.optionsVersion) return null;
      const wokenTaskIds = this.queue.settleOpen(card, reply);
      return {
        outcome: "applied",
        mutated: true,
        card: this.card(questionId),
        wokenTaskIds,
      };
    });
  }

  private openTargets(input: {
    readonly questionId?: string;
    readonly scopeId?: string;
    readonly criterionId?: string;
    readonly featureId?: string;
  }): readonly QuestionCard[] {
    if (input.questionId !== undefined) return [this.card(input.questionId)];
    return this.store.listOpen().filter((card) => {
      if (input.featureId !== undefined && card.featureId !== input.featureId) return false;
      if (input.scopeId !== undefined && card.scopeId !== input.scopeId) return false;
      if (input.criterionId !== undefined && card.criterionId !== input.criterionId) return false;
      return input.featureId !== undefined || input.scopeId !== undefined || input.criterionId !== undefined;
    });
  }
}
