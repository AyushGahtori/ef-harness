import type { MessageRow, RouterStore } from "./database.js";
import type {
  AmbiguityHoldPort,
  ClauseDispatchPort,
  ClauseOutcome,
  KernelControlPort,
  OutboxPort,
} from "./ports.js";
import { STEERING_OUTBOX_CONSUMERS } from "./ports.js";
import type { ClarificationCard, IntentType, StoredClause } from "./types.js";
import { assertNever } from "./types.js";

const MUTATIONS = new Set<IntentType>(["edit_existing", "undo_feature", "add_new_feature"]);

/**
 * Runs clauses in safety order and commits each clause before the next one starts.
 * A throw leaves the failed clause uncommitted so a later resume does not repeat earlier DONE clauses.
 */
export class OrderedMultiClauseExecutor {
  constructor(
    private readonly store: RouterStore,
    private readonly kernel: KernelControlPort,
    private readonly dispatch: ClauseDispatchPort,
    private readonly holds: AmbiguityHoldPort,
    private readonly outbox: OutboxPort,
    private readonly now: () => number,
  ) {}

  async execute(message: MessageRow): Promise<ClarificationCard | null> {
    const clauses = this.store.listClauses(message.messageId);
    for (const clause of clauses) {
      if (clause.intentType !== "add_new_feature") continue;
      if (clause.status === "DONE" || clause.status === "AWAITING_CLARIFICATION") continue;
      if (clause.needsClarification) continue;
      await this.dispatch.reserveFeature(clause, message);
    }
    for (const clause of clauses) {
      if (clause.status === "DONE") continue;
      if (clause.status === "AWAITING_CLARIFICATION") {
        return message.clarification;
      }
      if (this.needsHold(clause)) {
        const card = clause.alternateReadings.length >= 2
          ? this.holds.place({ message, clause })
          : unresolvedCard(message, clause);
        this.store.transaction(() => {
          this.store.updateClause(message.messageId, clause.clauseId, "AWAITING_CLARIFICATION", card.prompt);
          this.store.markMessageDone(message.messageId, "AWAITING_CLARIFICATION", card);
        });
        return card;
      }
      this.store.transaction(() => {
        this.store.updateClause(message.messageId, clause.clauseId, "DISPATCHED", null);
      });
      const outcome = await this.apply(clause, message);
      this.store.transaction(() => {
        this.store.updateClause(message.messageId, clause.clauseId, "DONE", outcome.detail);
        this.outbox.appendEventInTx(
          { isTransaction: this.store.inTransaction },
          {
            id: `steering:${message.messageId}:${clause.clauseId}`,
            type: "SteeringClauseDispatched",
            subject: message.messageId,
            payload: {
              msgSeq: message.msgSeq,
              clauseId: clause.clauseId,
              intentType: clause.intentType,
              targetCandidateIds: clause.targetCandidateIds,
            },
            createdAt: this.now(),
          },
          STEERING_OUTBOX_CONSUMERS,
        );
      });
    }
    this.store.transaction(() => {
      this.store.markMessageDone(message.messageId, "DONE", null);
    });
    return null;
  }

  private needsHold(clause: StoredClause): boolean {
    if (!MUTATIONS.has(clause.intentType)) return false;
    return clause.needsClarification || clause.confidence === "ambiguous";
  }

  private async apply(clause: StoredClause, message: MessageRow): Promise<ClauseOutcome> {
    if (clause.cardDecision === "approve") return this.dispatch.approve(clause, message);
    if (clause.cardDecision === "reject") return this.dispatch.reject(clause, message);
    const request = {
      msgSeq: message.msgSeq,
      messageId: message.messageId,
      phrase: clause.clauseText,
      targetIds: clause.targetCandidateIds,
      reason: message.fastPath ? ("fast_path" as const) : ("clause" as const),
    };
    switch (clause.intentType) {
      case "stop_control":
        return clause.control === "pause" ? this.kernel.pause(request) : this.kernel.stop(request);
      case "answer_question":
        return this.dispatch.answerQuestion(clause, message);
      case "edit_existing":
        return this.dispatch.editExisting(clause, message);
      case "undo_feature":
        return this.dispatch.undoFeature(clause, message);
      case "add_new_feature":
        return this.dispatch.addNewFeature(clause, message);
      case "read_only_query":
        return this.dispatch.readOnlyQuery(clause, message);
      default:
        return assertNever(clause.intentType);
    }
  }
}

function unresolvedCard(message: MessageRow, clause: StoredClause): ClarificationCard {
  return {
    kind: "clarification",
    messageId: message.messageId,
    msgSeq: message.msgSeq,
    clauseId: clause.clauseId,
    reason: "unresolved_target",
    prompt: `Which record should "${clause.clauseText}" change?`,
    alternateReadings: clause.alternateReadings,
    pipeline: "router",
  };
}
