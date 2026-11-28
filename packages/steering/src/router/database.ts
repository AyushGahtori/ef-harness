import { DatabaseSync, type SQLOutputValue } from "node:sqlite";
import { ROUTER_DDL } from "./ddl.js";
import { DuplicateMessageConflictError, RouterInputError } from "./errors.js";
import {
  MESSAGE_ORIGINS,
  type ClarificationCard,
  type ClauseStatus,
  type ExplicitUiAction,
  type FocusBinding,
  type GraphNodeView,
  type InputStartFocus,
  type MessageOrigin,
  type MessageStatus,
  type PlannedClause,
  type StoredClause,
} from "./types.js";

type Row = Record<string, SQLOutputValue>;

function text(value: SQLOutputValue | undefined, label: string): string {
  if (typeof value !== "string") throw new RouterInputError(`${label} is not text`);
  return value;
}

function textOrNull(value: SQLOutputValue | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") throw new RouterInputError("expected text or null");
  return value;
}

function integer(value: SQLOutputValue | undefined, label: string): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "bigint") return Number(value);
  throw new RouterInputError(`${label} is not an integer`);
}

function integerOrNull(value: SQLOutputValue | undefined): number | null {
  if (value === null || value === undefined) return null;
  return integer(value, "integer");
}

function realOrNull(value: SQLOutputValue | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "bigint") return Number(value);
  throw new RouterInputError("expected a number or null");
}

export function jsonText(value: unknown): string {
  return JSON.stringify(value);
}

export function parseJson(value: string): unknown {
  return JSON.parse(value) as unknown;
}

export interface MessageRow {
  readonly msgSeq: number;
  readonly messageId: string;
  readonly origin: MessageOrigin;
  readonly text: string;
  readonly inputStartedAt: number | null;
  readonly focus: InputStartFocus | null;
  readonly draftId: string | null;
  readonly receivedAt: number;
  readonly explicitAction: ExplicitUiAction | null;
  readonly confirmationRequired: boolean;
  readonly status: MessageStatus;
  readonly fastPath: boolean;
  readonly routerInvoked: boolean;
  readonly providerCalls: number;
  readonly fastPathMs: number | null;
  readonly clarification: ClarificationCard | null;
}

export interface NewMessage {
  readonly messageId: string;
  readonly origin: MessageOrigin;
  readonly text: string;
  readonly inputStartedAt: number | null;
  readonly focus: InputStartFocus | null;
  readonly draftId: string | null;
  readonly receivedAt: number;
  readonly explicitAction: ExplicitUiAction | null;
  readonly confirmationRequired: boolean;
}

export class RouterStore {
  private depth = 0;
  private closed = false;

  constructor(private readonly db: DatabaseSync) {
    this.db.exec(ROUTER_DDL);
  }

  static open(path: string): RouterStore {
    return new RouterStore(new DatabaseSync(path));
  }

  get database(): DatabaseSync {
    return this.db;
  }

  get inTransaction(): boolean {
    return this.depth > 0;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.db.close();
  }

  transaction<T>(fn: () => T): T {
    if (this.depth > 0) return fn();
    this.depth += 1;
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const value = fn();
      this.db.exec("COMMIT");
      this.depth -= 1;
      return value;
    } catch (error) {
      this.depth -= 1;
      try {
        this.db.exec("ROLLBACK");
      } catch (rollbackError) {
        if (rollbackError instanceof Error && error instanceof Error) {
          error.message = `${error.message} (rollback: ${rollbackError.message})`;
        }
      }
      throw error;
    }
  }

  insertMessage(message: NewMessage): { readonly inserted: boolean; readonly row: MessageRow } {
    const existing = this.getMessage(message.messageId);
    if (existing) {
      if (existing.text !== message.text || existing.origin !== message.origin) {
        throw new DuplicateMessageConflictError(message.messageId);
      }
      return { inserted: false, row: existing };
    }
    if (!MESSAGE_ORIGINS.includes(message.origin)) {
      throw new RouterInputError(`unknown message origin ${message.origin}`);
    }
    const result = this.db
      .prepare(
        `INSERT INTO user_messages (
           message_id, origin, text, draft_id, input_started_at, focus_json, received_at,
           explicit_action_json, confirmation_required, status
         ) VALUES (
           :message_id, :origin, :text, :draft_id, :input_started_at, :focus_json, :received_at,
           :explicit_action_json, :confirmation_required, 'QUEUED'
         )`,
      )
      .run({
        message_id: message.messageId,
        origin: message.origin,
        text: message.text,
        draft_id: message.draftId,
        input_started_at: message.inputStartedAt,
        focus_json: jsonText(message.focus),
        received_at: message.receivedAt,
        explicit_action_json: message.explicitAction ? jsonText(message.explicitAction) : null,
        confirmation_required: message.confirmationRequired ? 1 : 0,
      });
    const seq = Number(result.lastInsertRowid);
    const row = this.getMessageBySeq(seq);
    if (!row) throw new RouterInputError("inserted message could not be read back");
    return { inserted: true, row };
  }

  getMessage(messageId: string): MessageRow | null {
    const row = this.db.prepare(`SELECT * FROM user_messages WHERE message_id = :id`).get({ id: messageId }) as
      | Row
      | undefined;
    return row ? mapMessage(row) : null;
  }

  getMessageBySeq(msgSeq: number): MessageRow | null {
    const row = this.db.prepare(`SELECT * FROM user_messages WHERE msg_seq = :seq`).get({ seq: msgSeq }) as
      | Row
      | undefined;
    return row ? mapMessage(row) : null;
  }

  listMessages(): MessageRow[] {
    const rows = this.db.prepare(`SELECT * FROM user_messages ORDER BY msg_seq ASC`).all() as Row[];
    return rows.map(mapMessage);
  }

  markRouting(messageId: string): void {
    this.setStatus(messageId, "ROUTING");
  }

  markExecuting(messageId: string): void {
    this.setStatus(messageId, "EXECUTING");
  }

  markMessageDone(messageId: string, status: "DONE" | "AWAITING_CLARIFICATION", clarification: ClarificationCard | null): void {
    this.db
      .prepare(
        `UPDATE user_messages
            SET status = :status, clarification_json = :clarification
          WHERE message_id = :id`,
      )
      .run({
        id: messageId,
        status,
        clarification: clarification ? jsonText(clarification) : null,
      });
  }

  recordRouteMeta(
    messageId: string,
    meta: {
      readonly fastPath: boolean;
      readonly routerInvoked: boolean;
      readonly providerCalls: number;
      readonly fastPathMs: number | null;
    },
  ): void {
    this.db
      .prepare(
        `UPDATE user_messages
            SET fast_path = :fast_path,
                router_invoked = :router_invoked,
                provider_calls = :provider_calls,
                fast_path_ms = :fast_path_ms
          WHERE message_id = :id`,
      )
      .run({
        id: messageId,
        fast_path: meta.fastPath ? 1 : 0,
        router_invoked: meta.routerInvoked ? 1 : 0,
        provider_calls: meta.providerCalls,
        fast_path_ms: meta.fastPathMs,
      });
  }

  replaceClauses(messageId: string, planned: readonly PlannedClause[]): StoredClause[] {
    this.db.prepare(`DELETE FROM message_clauses WHERE message_id = :id`).run({ id: messageId });
    const ordered = planned.map((clause, clauseIndex) => ({ clause, clauseIndex }));
    ordered.sort((left, right) => {
      const phase = safety(left.clause) - safety(right.clause);
      if (phase !== 0) return phase;
      return left.clause.span.start - right.clause.span.start;
    });
    const insert = this.db.prepare(
      `INSERT INTO message_clauses (
         message_id, clause_id, clause_index, execution_index, clause_text, span_start, span_end,
         intent_type, router_intent, target_ids_json, confidence, alternate_readings_json,
         needs_clarification, router_confidence, options_version, depends_on_json, control_kind,
         card_decision, status
       ) VALUES (
         :message_id, :clause_id, :clause_index, :execution_index, :clause_text, :span_start, :span_end,
         :intent_type, :router_intent, :target_ids_json, :confidence, :alternate_readings_json,
         :needs_clarification, :router_confidence, :options_version, :depends_on_json, :control_kind,
         :card_decision, 'PENDING'
       )`,
    );
    ordered.forEach((entry, executionIndex) => {
      const clauseId = `${messageId}#${entry.clauseIndex}`;
      insert.run({
        message_id: messageId,
        clause_id: clauseId,
        clause_index: entry.clauseIndex,
        execution_index: executionIndex,
        clause_text: entry.clause.clauseText,
        span_start: entry.clause.span.start,
        span_end: entry.clause.span.end,
        intent_type: entry.clause.intentType,
        router_intent: entry.clause.routerIntent,
        target_ids_json: jsonText(entry.clause.targetCandidateIds),
        confidence: entry.clause.confidence,
        alternate_readings_json: jsonText(entry.clause.alternateReadings),
        needs_clarification: entry.clause.needsClarification ? 1 : 0,
        router_confidence: entry.clause.routerConfidence,
        options_version: entry.clause.optionsVersion,
        depends_on_json: jsonText(
          entry.clause.dependsOnClauseIds.map((dep) => (dep.startsWith("#") ? `${messageId}${dep}` : dep)),
        ),
        control_kind: entry.clause.control,
        card_decision: entry.clause.cardDecision,
      });
    });
    return this.listClauses(messageId);
  }

  listClauses(messageId: string): StoredClause[] {
    const rows = this.db
      .prepare(`SELECT * FROM message_clauses WHERE message_id = :id ORDER BY execution_index ASC`)
      .all({ id: messageId }) as Row[];
    return rows.map(mapClause);
  }

  updateClause(messageId: string, clauseId: string, status: ClauseStatus, resultDetail: string | null): void {
    this.db
      .prepare(
        `UPDATE message_clauses
            SET status = :status, result_detail = :detail
          WHERE message_id = :message_id AND clause_id = :clause_id`,
      )
      .run({
        message_id: messageId,
        clause_id: clauseId,
        status,
        detail: resultDetail,
      });
  }

  saveFocus(binding: FocusBinding): void {
    this.db
      .prepare(
        `INSERT INTO input_focus_snapshots (
           draft_id, captured_at, focus_json, live_focus_json, confirmation_required
         ) VALUES (
           :draft_id, :captured_at, :focus_json, :live_focus_json, :confirmation_required
         )
         ON CONFLICT(draft_id) DO UPDATE SET
           live_focus_json = excluded.live_focus_json,
           confirmation_required = excluded.confirmation_required`,
      )
      .run({
        draft_id: binding.draftId,
        captured_at: binding.capturedAt,
        focus_json: jsonText(binding.focus),
        live_focus_json: jsonText(binding.liveFocus),
        confirmation_required: binding.confirmationRequired ? 1 : 0,
      });
  }

  getFocus(draftId: string): FocusBinding | null {
    const row = this.db
      .prepare(`SELECT * FROM input_focus_snapshots WHERE draft_id = :id`)
      .get({ id: draftId }) as Row | undefined;
    if (!row) return null;
    return {
      draftId,
      capturedAt: integer(row.captured_at, "captured_at"),
      focus: parseFocusJson(text(row.focus_json, "focus_json")),
      liveFocus: parseFocusJson(text(row.live_focus_json, "live_focus_json")),
      confirmationRequired: integer(row.confirmation_required, "confirmation_required") === 1,
    };
  }

  upsertCatalog(node: GraphNodeView & { readonly nid: number }): void {
    this.db
      .prepare(
        `INSERT INTO router_catalog (
           id, nid, kind, title, body, status, feature_id, aliases_json, working, owner_role
         ) VALUES (
           :id, :nid, :kind, :title, :body, :status, :feature_id, :aliases_json, :working, :owner_role
         )
         ON CONFLICT(id) DO UPDATE SET
           nid = excluded.nid,
           kind = excluded.kind,
           title = excluded.title,
           body = excluded.body,
           status = excluded.status,
           feature_id = excluded.feature_id,
           aliases_json = excluded.aliases_json,
           working = excluded.working,
           owner_role = excluded.owner_role`,
      )
      .run({
        id: node.id,
        nid: node.nid,
        kind: node.kind,
        title: node.title,
        body: node.text,
        status: node.status,
        feature_id: node.featureId,
        aliases_json: jsonText(node.aliases),
        working: node.working ? 1 : 0,
        owner_role: node.ownerRole,
      });
  }

  listCatalog(): Array<GraphNodeView & { readonly nid: number }> {
    const rows = this.db.prepare(`SELECT * FROM router_catalog ORDER BY nid ASC`).all() as Row[];
    return rows.map((row) => ({
      nid: integer(row.nid, "nid"),
      id: text(row.id, "id"),
      kind: text(row.kind, "kind") as GraphNodeView["kind"],
      title: text(row.title, "title"),
      text: text(row.body, "body"),
      status: text(row.status, "status"),
      featureId: textOrNull(row.feature_id),
      aliases: parseStringArray(text(row.aliases_json, "aliases_json")),
      working: integer(row.working, "working") === 1,
      ownerRole: textOrNull(row.owner_role),
    }));
  }

  nextCatalogNid(): number {
    const row = this.db.prepare(`SELECT COALESCE(MAX(nid), 0) AS max_nid FROM router_catalog`).get() as Row;
    return integer(row.max_nid, "max_nid") + 1;
  }

  appendOutbox(event: {
    readonly id: string;
    readonly type: string;
    readonly subject: string | null;
    readonly payload: unknown;
    readonly createdAt: number;
  }, consumers: readonly string[]): number {
    const result = this.db
      .prepare(
        `INSERT INTO outbox (id, type, subject, rev, payload, created_at)
         VALUES (:id, :type, :subject, NULL, :payload, :created_at)`,
      )
      .run({
        id: event.id,
        type: event.type,
        subject: event.subject,
        payload: jsonText(event.payload),
        created_at: event.createdAt,
      });
    const delivery = this.db.prepare(
      `INSERT INTO outbox_deliveries (event_id, consumer, delivered_at) VALUES (:event_id, :consumer, NULL)`,
    );
    for (const consumer of consumers) {
      delivery.run({ event_id: event.id, consumer });
    }
    return Number(result.lastInsertRowid);
  }

  listOutboxIds(): string[] {
    const rows = this.db.prepare(`SELECT id FROM outbox ORDER BY seq ASC`).all() as Row[];
    return rows.map((row) => text(row.id, "id"));
  }

  private setStatus(messageId: string, status: MessageStatus): void {
    this.db.prepare(`UPDATE user_messages SET status = :status WHERE message_id = :id`).run({
      id: messageId,
      status,
    });
  }
}

function safety(clause: PlannedClause): number {
  switch (clause.intentType) {
    case "stop_control":
      return 0;
    case "answer_question":
      return 1;
    case "edit_existing":
    case "undo_feature":
      return 2;
    case "add_new_feature":
      return 3;
    case "read_only_query":
      return 4;
    default:
      return 5;
  }
}

function mapMessage(row: Row): MessageRow {
  const origin = text(row.origin, "origin");
  if (!MESSAGE_ORIGINS.includes(origin as MessageOrigin)) {
    throw new RouterInputError(`stored origin ${origin} is unknown`);
  }
  const focusRaw = text(row.focus_json, "focus_json");
  const focusParsed = parseJson(focusRaw);
  const explicitRaw = textOrNull(row.explicit_action_json);
  const clarificationRaw = textOrNull(row.clarification_json);
  return {
    msgSeq: integer(row.msg_seq, "msg_seq"),
    messageId: text(row.message_id, "message_id"),
    origin: origin as MessageOrigin,
    text: text(row.text, "text"),
    draftId: textOrNull(row.draft_id),
    inputStartedAt: integerOrNull(row.input_started_at),
    focus: focusParsed === null ? null : parseFocusJson(focusRaw),
    receivedAt: integer(row.received_at, "received_at"),
    explicitAction: explicitRaw ? (parseJson(explicitRaw) as ExplicitUiAction) : null,
    confirmationRequired: integer(row.confirmation_required, "confirmation_required") === 1,
    status: text(row.status, "status") as MessageStatus,
    fastPath: integer(row.fast_path, "fast_path") === 1,
    routerInvoked: integer(row.router_invoked, "router_invoked") === 1,
    providerCalls: integer(row.provider_calls, "provider_calls"),
    fastPathMs: realOrNull(row.fast_path_ms),
    clarification: clarificationRaw ? (parseJson(clarificationRaw) as ClarificationCard) : null,
  };
}

function mapClause(row: Row): StoredClause {
  const control = textOrNull(row.control_kind);
  const decision = textOrNull(row.card_decision);
  return {
    messageId: text(row.message_id, "message_id"),
    clauseId: text(row.clause_id, "clause_id"),
    clauseIndex: integer(row.clause_index, "clause_index"),
    executionIndex: integer(row.execution_index, "execution_index"),
    clauseText: text(row.clause_text, "clause_text"),
    span: {
      start: integer(row.span_start, "span_start"),
      end: integer(row.span_end, "span_end"),
    },
    intentType: text(row.intent_type, "intent_type") as StoredClause["intentType"],
    routerIntent: text(row.router_intent, "router_intent") as StoredClause["routerIntent"],
    targetCandidateIds: parseStringArray(text(row.target_ids_json, "target_ids_json")),
    confidence: text(row.confidence, "confidence") as StoredClause["confidence"],
    alternateReadings: parseStringArray(text(row.alternate_readings_json, "alternate_readings_json")),
    needsClarification: integer(row.needs_clarification, "needs_clarification") === 1,
    routerConfidence: realOrNull(row.router_confidence) ?? 0,
    optionsVersion: integerOrNull(row.options_version),
    dependsOnClauseIds: parseStringArray(text(row.depends_on_json, "depends_on_json")),
    control: control === "stop" || control === "pause" ? control : null,
    cardDecision: decision === "approve" || decision === "reject" ? decision : null,
    status: text(row.status, "status") as ClauseStatus,
    resultDetail: textOrNull(row.result_detail),
  };
}

export function parseFocusJson(encoded: string): InputStartFocus {
  const value = parseJson(encoded);
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new RouterInputError("focus snapshot is not an object");
  }
  const row = value as Record<string, unknown>;
  const allowed = new Set([
    "activeTab",
    "selectedCanvasNodeIds",
    "openQuestionCardId",
    "openQuestionOptionsVersion",
    "focusedFeatureId",
    "inspectedTaskId",
    "previewSelectedElement",
  ]);
  for (const key of Object.keys(row)) {
    if (!allowed.has(key)) throw new RouterInputError(`focus snapshot has unknown key ${key}`);
  }
  if (typeof row.activeTab !== "string") throw new RouterInputError("activeTab is required");
  if (!Array.isArray(row.selectedCanvasNodeIds) || row.selectedCanvasNodeIds.some((item) => typeof item !== "string")) {
    throw new RouterInputError("selectedCanvasNodeIds must be a string array");
  }
  if (row.openQuestionCardId !== null && typeof row.openQuestionCardId !== "string") {
    throw new RouterInputError("openQuestionCardId must be a string or null");
  }
  if (
    row.openQuestionOptionsVersion !== null &&
    (typeof row.openQuestionOptionsVersion !== "number" || !Number.isInteger(row.openQuestionOptionsVersion))
  ) {
    throw new RouterInputError("openQuestionOptionsVersion must be an integer or null");
  }
  if (row.focusedFeatureId !== null && typeof row.focusedFeatureId !== "string") {
    throw new RouterInputError("focusedFeatureId must be a string or null");
  }
  if (row.inspectedTaskId !== null && typeof row.inspectedTaskId !== "string") {
    throw new RouterInputError("inspectedTaskId must be a string or null");
  }
  const focus: InputStartFocus = {
    activeTab: row.activeTab,
    selectedCanvasNodeIds: row.selectedCanvasNodeIds,
    openQuestionCardId: row.openQuestionCardId,
    openQuestionOptionsVersion: row.openQuestionOptionsVersion,
    focusedFeatureId: row.focusedFeatureId,
    inspectedTaskId: row.inspectedTaskId,
  };
  if (typeof row.previewSelectedElement === "string") {
    return { ...focus, previewSelectedElement: row.previewSelectedElement };
  }
  return focus;
}

function parseStringArray(encoded: string): string[] {
  const value = parseJson(encoded);
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new RouterInputError("expected a string array");
  }
  return value;
}
