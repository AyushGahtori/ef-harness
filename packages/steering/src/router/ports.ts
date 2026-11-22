import type { MessageRow } from "./database.js";
import {
  EmptyOutboxConsumersError,
  OutboxTransactionRequiredError,
  TelemetryNotAllowedInOutboxError,
} from "./errors.js";
import type { RouterStore } from "./database.js";
import type { ClarificationCard, RouterPrompt, StoredClause } from "./types.js";

export interface ClauseOutcome {
  readonly ok: true;
  readonly detail: string;
}

export interface KernelControlRequest {
  readonly msgSeq: number;
  readonly messageId: string;
  readonly phrase: string;
  readonly targetIds: readonly string[];
  readonly reason: "fast_path" | "clause";
}

export interface KernelControlPort {
  stop(request: KernelControlRequest): ClauseOutcome;
  pause(request: KernelControlRequest): ClauseOutcome;
}

export interface ClauseDispatchPort {
  answerQuestion(clause: StoredClause, message: MessageRow): ClauseOutcome;
  editExisting(clause: StoredClause, message: MessageRow): ClauseOutcome;
  undoFeature(clause: StoredClause, message: MessageRow): ClauseOutcome;
  addNewFeature(clause: StoredClause, message: MessageRow): ClauseOutcome;
  readOnlyQuery(clause: StoredClause, message: MessageRow): ClauseOutcome;
  reserveFeature(clause: StoredClause, message: MessageRow): ClauseOutcome;
  approve(clause: StoredClause, message: MessageRow): ClauseOutcome;
  reject(clause: StoredClause, message: MessageRow): ClauseOutcome;
}

export interface AmbiguityHoldPort {
  place(request: { readonly message: MessageRow; readonly clause: StoredClause }): ClarificationCard;
}

export interface RouterModelPort {
  complete(prompt: RouterPrompt): unknown;
  readonly usesProvider: boolean;
}

export interface BudgetReadPort {
  spentMicroUsd(): number | null;
}

export interface OutboxConnection {
  readonly isTransaction: boolean;
}

export interface OutboxEventDraft {
  readonly id: string;
  readonly type: string;
  readonly subject?: string | null;
  readonly payload?: unknown;
  readonly createdAt?: number;
}

export interface OutboxPort {
  appendEventInTx(
    conn: OutboxConnection,
    event: OutboxEventDraft,
    consumers: readonly string[],
  ): { readonly seq: number; readonly id: string };
}

export const STEERING_OUTBOX_CONSUMERS = ["scheduler", "ui_projection"] as const;

export function isTelemetryEventType(type: string): boolean {
  return type.startsWith("telemetry.") || type === "worker.heartbeat" || type === "token.delta";
}

/** Local port of `OutboxRepo.appendEventInTx` (Task 026). */
export class LocalOutboxPort implements OutboxPort {
  constructor(
    private readonly store: RouterStore,
    private readonly now: () => number,
  ) {}

  appendEventInTx(
    conn: OutboxConnection,
    event: OutboxEventDraft,
    consumers: readonly string[],
  ): { readonly seq: number; readonly id: string } {
    if (!conn.isTransaction) throw new OutboxTransactionRequiredError();
    if (consumers.length === 0) throw new EmptyOutboxConsumersError();
    if (isTelemetryEventType(event.type)) throw new TelemetryNotAllowedInOutboxError(event.type);
    const seq = this.store.appendOutbox(
      {
        id: event.id,
        type: event.type,
        subject: event.subject ?? null,
        payload: event.payload ?? {},
        createdAt: event.createdAt ?? this.now(),
      },
      consumers,
    );
    return { seq, id: event.id };
  }
}

export interface PortCall {
  readonly op: string;
  readonly messageId: string;
  readonly msgSeq: number;
  readonly targetIds: readonly string[];
  readonly detail: string;
}

export class RecordingKernel implements KernelControlPort {
  readonly calls: PortCall[] = [];

  stop(request: KernelControlRequest): ClauseOutcome {
    return this.record("stop", request, "stopped");
  }

  pause(request: KernelControlRequest): ClauseOutcome {
    return this.record("pause", request, "paused");
  }

  private record(op: string, request: KernelControlRequest, detail: string): ClauseOutcome {
    this.calls.push({
      op,
      messageId: request.messageId,
      msgSeq: request.msgSeq,
      targetIds: request.targetIds,
      detail,
    });
    return { ok: true, detail };
  }
}

export class RecordingDispatch implements ClauseDispatchPort {
  readonly calls: PortCall[] = [];

  constructor(private readonly budget: BudgetReadPort | null = null) {}

  answerQuestion(clause: StoredClause, message: MessageRow): ClauseOutcome {
    const version = clause.optionsVersion === null ? "" : `@${clause.optionsVersion}`;
    return this.record("answer_question", clause, message, `${clause.targetCandidateIds.join(",")}${version}`);
  }

  editExisting(clause: StoredClause, message: MessageRow): ClauseOutcome {
    return this.record("edit_existing", clause, message, clause.targetCandidateIds.join(","));
  }

  undoFeature(clause: StoredClause, message: MessageRow): ClauseOutcome {
    return this.record("undo_feature", clause, message, clause.targetCandidateIds.join(","));
  }

  addNewFeature(clause: StoredClause, message: MessageRow): ClauseOutcome {
    return this.record("add_new_feature", clause, message, clause.clauseText);
  }

  reserveFeature(clause: StoredClause, message: MessageRow): ClauseOutcome {
    return this.record("reserve_feature", clause, message, clause.clauseText);
  }

  approve(clause: StoredClause, message: MessageRow): ClauseOutcome {
    return this.record("approve", clause, message, clause.targetCandidateIds.join(","));
  }

  reject(clause: StoredClause, message: MessageRow): ClauseOutcome {
    return this.record("reject", clause, message, clause.targetCandidateIds.join(","));
  }

  readOnlyQuery(clause: StoredClause, message: MessageRow): ClauseOutcome {
    const asksSpend = /\b(spent|spend|budget)\b/i.test(clause.clauseText);
    const spent = asksSpend ? (this.budget?.spentMicroUsd() ?? null) : null;
    const detail = spent === null ? "read-only" : `spent_micro_usd=${spent}`;
    return this.record("read_only_query", clause, message, detail);
  }

  private record(op: string, clause: StoredClause, message: MessageRow, detail: string): ClauseOutcome {
    this.calls.push({
      op,
      messageId: message.messageId,
      msgSeq: message.msgSeq,
      targetIds: clause.targetCandidateIds,
      detail,
    });
    return { ok: true, detail };
  }
}

export class RecordingHolds implements AmbiguityHoldPort {
  readonly calls: ClarificationCard[] = [];

  place(request: { readonly message: MessageRow; readonly clause: StoredClause }): ClarificationCard {
    const card: ClarificationCard = {
      kind: "clarification",
      messageId: request.message.messageId,
      msgSeq: request.message.msgSeq,
      clauseId: request.clause.clauseId,
      reason: "ambiguous_readings",
      prompt: `Which target did you mean: ${request.clause.alternateReadings.join(" or ")}?`,
      alternateReadings: request.clause.alternateReadings,
      pipeline: "Task 115",
    };
    this.calls.push(card);
    return card;
  }
}
