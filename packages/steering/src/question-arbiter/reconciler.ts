import { ALREADY_SAVED_MESSAGE, FEATURE_UNDO_ACTOR, VS_CODE_EDITOR, VS_CODE_STALE_PROMPT } from "./constants.js";
import type { QuestionQueueStore } from "./database.js";
import type { QuestionDedupSubscriberStore } from "./dedup.js";
import { InvalidQuestionError, QuestionNotFoundError } from "./errors.js";
import { repliesAgree, resolveReplyText, staleHeadline } from "./text.js";
import type { AnswerResult, ChoiceResult, QuestionCard, QuestionReply } from "./types.js";

export type ReconcileResult = AnswerResult | { readonly outcome: "fresh" };

export class StaleReplyReconciler {
  constructor(
    private readonly store: QuestionQueueStore,
    private readonly queue: QuestionDedupSubscriberStore,
    private readonly now: () => number,
  ) {}

  receive(questionId: string, reply: QuestionReply): ReconcileResult {
    return this.store.transaction(() => {
      const card = this.store.getCard(questionId);
      if (!card) throw new QuestionNotFoundError(questionId);
      if (card.status === "open" && card.optionsVersion === reply.optionsVersion) return { outcome: "fresh" };
      const retained = resolveReplyText(card, reply);
      if (retained === null) throw new InvalidQuestionError("A reply needs an option or text.");
      if (repliesAgree(card, reply)) {
        return {
          outcome: "already_saved",
          mutated: false,
          message: ALREADY_SAVED_MESSAGE,
          card,
        };
      }
      const settledBy =
        card.status === "open" && card.optionsVersion !== reply.optionsVersion ? "a newer options list" : actorFor(card);
      const headline = staleHeadline(settledBy);
      const prompt = card.settledBy === VS_CODE_EDITOR || card.retiredReason === "markdown_edit" ? VS_CODE_STALE_PROMPT : headline;
      const pendingReplyId = this.store.insertPending({
        questionId,
        optionsVersion: reply.optionsVersion,
        optionId: reply.optionId ?? null,
        replyText: retained,
        createdAt: this.now(),
      });
      const current = this.store.getCard(questionId) ?? card;
      return {
        outcome: "needs_choice",
        mutated: false,
        prompt,
        headline,
        pendingReplyId,
        settledBy,
        retainedReply: retained,
        card: current,
        choices: ["keep", "change"],
      };
    });
  }

  choose(pendingId: string, choice: "keep" | "change"): ChoiceResult {
    return this.store.transaction(() => {
      const pending = this.store.getPending(pendingId);
      if (!pending || pending.disposition !== "pending") {
        throw new InvalidQuestionError(`Pending reply ${pendingId} is not open.`);
      }
      const card = this.store.getCard(pending.questionId);
      if (!card) throw new QuestionNotFoundError(pending.questionId);
      if (choice === "keep") {
        this.store.setPendingDisposition(pendingId, "kept");
        const current = this.store.getCard(pending.questionId) ?? card;
        return {
          outcome: "kept",
          mutated: false,
          card: current,
          message: `Kept ${actorFor(card)}.`,
        };
      }
      const wokenTaskIds = this.queue.applyExplicitChange(card, {
        optionsVersion: card.optionsVersion,
        text: pending.replyText,
      });
      this.store.setPendingDisposition(pendingId, "changed");
      return {
        outcome: "changed",
        mutated: true,
        card: this.requireCard(pending.questionId),
        wokenTaskIds,
      };
    });
  }

  private requireCard(questionId: string): QuestionCard {
    const card = this.store.getCard(questionId);
    if (!card) throw new QuestionNotFoundError(questionId);
    return card;
  }
}

function actorFor(card: QuestionCard): string {
  if (card.settledBy !== null && card.settledBy.length > 0) return card.settledBy;
  if (card.retiredReason === "feature_undone") return FEATURE_UNDO_ACTOR;
  if (card.retiredReason === "markdown_edit") return VS_CODE_EDITOR;
  if (card.retiredReason !== null) return card.retiredReason;
  return "an earlier resolution";
}
