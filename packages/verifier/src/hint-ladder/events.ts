import { HintLadderError } from "./errors.js";
import { requireQuery, type NamedQueries } from "./queries.js";
import type { StateDbPort, SqlValue } from "./sql.js";

export const HINT_LADDER_EVENTS = {
  advanced: "HintLadderAdvanced",
  disclosed: "FreshExampleDisclosed",
  escalated: "TaskEscalated",
  dispute: "TestDisputeOpened",
} as const;

export const HINT_LADDER_EVENT_CONSUMERS = ["scheduler", "ui_projection"] as const;

export function appendOutboxEvent(
  db: StateDbPort,
  queries: NamedQueries,
  event: {
    readonly id: string;
    readonly type: string;
    readonly subject: string;
    readonly rev: number | null;
    readonly payload: unknown;
    readonly createdAt: number;
    readonly consumers: readonly string[];
  },
): void {
  if (event.consumers.length === 0) {
    throw new HintLadderError("outbox event requires at least one consumer");
  }
  const params: Record<string, SqlValue> = {
    id: event.id,
    type: event.type,
    subject: event.subject,
    rev: event.rev,
    payload: JSON.stringify(event.payload),
    created_at: event.createdAt,
  };
  db.prepare(
    `INSERT INTO outbox(id, type, subject, rev, payload, created_at)
     VALUES (:id, :type, :subject, :rev, :payload, :created_at)`,
  ).run(params);
  const register = db.prepare(requireQuery(queries, "register_delivery"));
  for (const consumer of event.consumers) {
    register.run({ event_id: event.id, consumer });
  }
}
