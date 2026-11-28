import type { FourRouteSteeringDispatcher } from "../dispatcher/dispatcher.js";
import type { MessageRow } from "./database.js";
import type { ClauseDispatchPort, ClauseOutcome } from "./ports.js";
import type { StoredClause } from "./types.js";

/**
 * OrderedMultiClauseExecutor calls the four-route dispatcher.
 * Stop and pause stay on the kernel port.
 */
export class DispatcherClausePort implements ClauseDispatchPort {
  constructor(private readonly dispatcher: FourRouteSteeringDispatcher) {}

  answerQuestion(clause: StoredClause): Promise<ClauseOutcome> {
    return this.query(clause.clauseText);
  }

  async editExisting(clause: StoredClause, message: MessageRow): Promise<ClauseOutcome> {
    const targetId = clause.targetCandidateIds[0] ?? "unknown";
    const result = this.dispatcher.dispatchExistingFeatureChange({
      msgSeq: String(message.msgSeq),
      targetId,
      edit: {
        targetId,
        beforeText: "",
        afterText: clause.clauseText,
      },
    });
    return { ok: true, detail: result.receipt.detail.revisionId ?? targetId };
  }

  undoFeature(clause: StoredClause): Promise<ClauseOutcome> {
    return Promise.resolve({ ok: true, detail: clause.targetCandidateIds[0] ?? "undo" });
  }

  async addNewFeature(clause: StoredClause, message: MessageRow): Promise<ClauseOutcome> {
    const result = this.dispatcher.dispatchNewFeatureAddition({
      msgSeq: String(message.msgSeq),
      text: clause.clauseText,
    });
    return { ok: true, detail: result.receipt.detail.featureId ?? clause.clauseText };
  }

  readOnlyQuery(clause: StoredClause): Promise<ClauseOutcome> {
    return this.query(clause.clauseText);
  }

  reserveFeature(clause: StoredClause): Promise<ClauseOutcome> {
    return Promise.resolve({ ok: true, detail: clause.clauseText });
  }

  approve(clause: StoredClause): Promise<ClauseOutcome> {
    return Promise.resolve({ ok: true, detail: clause.targetCandidateIds[0] ?? "approve" });
  }

  reject(clause: StoredClause): Promise<ClauseOutcome> {
    return Promise.resolve({ ok: true, detail: clause.targetCandidateIds[0] ?? "reject" });
  }

  private async query(text: string): Promise<ClauseOutcome> {
    const result = await this.dispatcher.dispatchReadOnlyQuery({ msgSeq: "router", text });
    return { ok: true, detail: result.receipt.detail.answer ?? text };
  }
}
