import { DatabaseSync, type SQLOutputValue } from "node:sqlite";
import { HUMAN_QUEUE_OWNER, OUTBOX_CONSUMERS, type PriorityTier, type QuestionKind, type QuestionStatus, type SettledSource } from "./constants.js";
import { QUESTION_ARBITER_DDL } from "./ddl.js";
import { HoldClearFailedError, QuestionTransactionError } from "./errors.js";
import { canonicalInboxKind, canonicalInboxStatus, priorityRank } from "./priority.js";
import { blockingLabel, normalizeTopic, questionKey, whyThisMatters } from "./text.js";
import type {
  HoldReason,
  InboxProjection,
  OutboxEventRecord,
  PendingReply,
  PrioritySignals,
  QuestionCard,
  QuestionOption,
  QuestionSubscriber,
  SettledFact,
  SettledFactDraft,
  WakeRecord,
} from "./types.js";

type Row = Record<string, SQLOutputValue>;

interface StoredPayload {
  readonly text: string;
  readonly options: readonly QuestionOption[];
  readonly recommendedOptionId: string;
  readonly signals: PrioritySignals;
}

export interface NewQuestionInput {
  readonly id: string;
  readonly buildId: string;
  readonly questionKey: string;
  readonly scopeId: string | null;
  readonly criterionId: string | null;
  readonly featureId: string | null;
  readonly contractId: string | null;
  readonly kind: QuestionKind;
  readonly humanReason: QuestionCard["humanReason"];
  readonly text: string;
  readonly priority: PriorityTier;
  readonly options: readonly QuestionOption[];
  readonly recommendedOptionId: string;
  readonly signals: PrioritySignals;
  readonly onCriticalPath: boolean;
  readonly createdAt: number;
}

export interface JoinUpdate {
  readonly priority: PriorityTier;
  readonly onCriticalPath: boolean;
  readonly blockedWorkerCount: number;
}

export class QuestionQueueStore {
  private holdClearFailures = 0;
  private depth = 0;
  private readonly factByText: ReturnType<DatabaseSync["prepare"]>;
  private readonly factByTopic: ReturnType<DatabaseSync["prepare"]>;
  private readonly factByScope: ReturnType<DatabaseSync["prepare"]>;

  constructor(private readonly db: DatabaseSync) {
    this.db.exec("PRAGMA busy_timeout = 5000");
    this.db.exec(QUESTION_ARBITER_DDL);
    this.factByText = this.db.prepare(`SELECT * FROM qa_settled_facts WHERE normalized_text = ? LIMIT 1`);
    this.factByTopic = this.db.prepare(`SELECT * FROM qa_settled_facts WHERE topic_key = ? LIMIT 1`);
    this.factByScope = this.db.prepare(
      `SELECT * FROM qa_settled_facts WHERE scope_id = ? AND criterion_id = ? LIMIT 1`,
    );
  }

  armHoldClearFailure(): void {
    this.holdClearFailures += 1;
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
      try {
        this.db.exec("ROLLBACK");
      } finally {
        this.depth -= 1;
      }
      throw error;
    }
  }

  nextId(name: string, prefix: string): string {
    const row = this.db
      .prepare(
        `INSERT INTO qa_id_counters(name, value) VALUES (?, 1)
         ON CONFLICT(name) DO UPDATE SET value = value + 1
         RETURNING value`,
      )
      .get(name) as Row | undefined;
    return `${prefix}-${requiredInt(row, "value")}`;
  }

  findOpenByKey(key: string): QuestionCard | null {
    const row = this.db
      .prepare(`SELECT * FROM qa_inbox_items WHERE question_key = ? AND status = 'open'`)
      .get(key) as Row | undefined;
    if (!row) return null;
    return this.hydrate(row);
  }

  getCard(questionId: string): QuestionCard | null {
    const row = this.db.prepare(`SELECT * FROM qa_inbox_items WHERE id = ?`).get(questionId) as Row | undefined;
    if (!row) return null;
    return this.hydrate(row);
  }

  listOpen(): QuestionCard[] {
    const rows = this.db.prepare(`SELECT * FROM qa_inbox_items WHERE status = 'open'`).all() as Row[];
    return rows.map((row) => this.hydrate(row));
  }

  listOpenForFeature(featureId: string): QuestionCard[] {
    const rows = this.db
      .prepare(`SELECT * FROM qa_inbox_items WHERE status = 'open' AND feature_id = ?`)
      .all(featureId) as Row[];
    return rows.map((row) => this.hydrate(row));
  }

  openQuestionIdsForTask(taskId: string): string[] {
    const rows = this.db
      .prepare(
        `SELECT s.question_id AS question_id
         FROM qa_inbox_subscribers s
         JOIN qa_inbox_items q ON q.id = s.question_id
         WHERE s.waiting_task_id = ? AND s.active = 1 AND q.status = 'open'`,
      )
      .all(taskId) as Row[];
    return rows.map((row) => requiredText(row, "question_id"));
  }

  insertQuestion(input: NewQuestionInput): void {
    const payload = encodePayload({
      text: input.text,
      options: input.options,
      recommendedOptionId: input.recommendedOptionId,
      signals: input.signals,
    });
    this.db
      .prepare(
        `INSERT INTO qa_inbox_items (
           id, build_id, question_key, scope_id, criterion_id, feature_id, contract_id,
           kind, human_reason, owner_role, priority_tier, priority, status, payload,
           options_version, blocked_worker_count, on_critical_path, created_at, resolved_at,
           retired_reason, settled_answer, settled_option_id, settled_by
         ) VALUES (
           ?, ?, ?, ?, ?, ?, ?,
           ?, ?, ?, ?, ?, 'open', ?,
           1, 0, ?, ?, NULL,
           NULL, NULL, NULL, NULL
         )`,
      )
      .run(
        input.id,
        input.buildId,
        input.questionKey,
        input.scopeId,
        input.criterionId,
        input.featureId,
        input.contractId,
        input.kind,
        input.humanReason,
        HUMAN_QUEUE_OWNER,
        input.priority,
        priorityRank(input.priority),
        payload,
        input.onCriticalPath ? 1 : 0,
        input.createdAt,
      );
  }

  addSubscriber(questionId: string, taskId: string, role: string, createdAt: number): "added" | "reactivated" | "exists" {
    const existing = this.db
      .prepare(`SELECT active FROM qa_inbox_subscribers WHERE question_id = ? AND waiting_task_id = ?`)
      .get(questionId, taskId) as Row | undefined;
    if (!existing) {
      this.db
        .prepare(
          `INSERT INTO qa_inbox_subscribers(question_id, waiting_task_id, waiting_role, created_at, active)
           VALUES (?, ?, ?, ?, 1)`,
        )
        .run(questionId, taskId, role, createdAt);
      return "added";
    }
    if (requiredInt(existing, "active") === 1) return "exists";
    this.db
      .prepare(
        `UPDATE qa_inbox_subscribers SET active = 1, waiting_role = ? WHERE question_id = ? AND waiting_task_id = ?`,
      )
      .run(role, questionId, taskId);
    return "reactivated";
  }

  deactivateSubscriber(questionId: string, taskId: string): boolean {
    const result = this.db
      .prepare(
        `UPDATE qa_inbox_subscribers SET active = 0 WHERE question_id = ? AND waiting_task_id = ? AND active = 1`,
      )
      .run(questionId, taskId);
    return Number(result.changes) > 0;
  }

  deactivateAll(questionId: string): string[] {
    const active = this.activeSubscribers(questionId).map((subscriber) => subscriber.waitingTaskId);
    this.db.prepare(`UPDATE qa_inbox_subscribers SET active = 0 WHERE question_id = ? AND active = 1`).run(questionId);
    return active;
  }

  updateDelivery(questionId: string, update: JoinUpdate): void {
    this.db
      .prepare(
        `UPDATE qa_inbox_items
         SET priority_tier = ?, priority = ?, blocked_worker_count = ?, on_critical_path = ?
         WHERE id = ?`,
      )
      .run(update.priority, priorityRank(update.priority), update.blockedWorkerCount, update.onCriticalPath ? 1 : 0, questionId);
  }

  reviseOptions(questionId: string, options: readonly QuestionOption[], recommendedOptionId: string, version: number): void {
    const card = this.requireRow(questionId);
    const payload = readPayload(requiredText(card, "payload"));
    const next = encodePayload({ ...payload, options, recommendedOptionId });
    this.db
      .prepare(`UPDATE qa_inbox_items SET payload = ?, options_version = ? WHERE id = ?`)
      .run(next, version, questionId);
  }

  markAnswered(input: {
    readonly questionId: string;
    readonly answer: string;
    readonly optionId: string | null;
    readonly settledBy: string;
    readonly resolvedAt: number;
  }): void {
    this.db
      .prepare(
        `UPDATE qa_inbox_items
         SET status = 'answered', settled_answer = ?, settled_option_id = ?, settled_by = ?,
             resolved_at = ?, retired_reason = NULL
         WHERE id = ?`,
      )
      .run(input.answer, input.optionId, input.settledBy, input.resolvedAt, input.questionId);
  }

  markRetired(
    questionId: string,
    reason: string,
    resolvedAt: number,
    settled?: {
      readonly answer: string | null;
      readonly settledBy: string;
    },
  ): void {
    this.db
      .prepare(
        `UPDATE qa_inbox_items
         SET status = 'retired', retired_reason = ?, resolved_at = ?, blocked_worker_count = 0
         WHERE id = ?`,
      )
      .run(reason, resolvedAt, questionId);
    if (!settled) return;
    this.db.prepare(`UPDATE qa_inbox_items SET settled_by = ? WHERE id = ?`).run(settled.settledBy, questionId);
    if (settled.answer !== null) {
      this.db.prepare(`UPDATE qa_inbox_items SET settled_answer = ? WHERE id = ?`).run(settled.answer, questionId);
    }
  }

  placeHold(reason: Omit<HoldReason, "active">): void {
    this.db
      .prepare(
        `INSERT INTO qa_holds(task_id, reason_type, reason_ref_id, mode, active)
         VALUES (?, ?, ?, ?, 1)
         ON CONFLICT(task_id, reason_type, reason_ref_id)
         DO UPDATE SET active = 1, mode = excluded.mode`,
      )
      .run(reason.taskId, reason.reasonType, reason.reasonRefId, reason.mode);
  }

  clearHold(taskId: string, reasonType: string, reasonRefId: string): void {
    if (this.holdClearFailures > 0) {
      this.holdClearFailures -= 1;
      throw new HoldClearFailedError();
    }
    this.db
      .prepare(
        `UPDATE qa_holds SET active = 0 WHERE task_id = ? AND reason_type = ? AND reason_ref_id = ? AND active = 1`,
      )
      .run(taskId, reasonType, reasonRefId);
  }

  holdsFor(taskId: string): HoldReason[] {
    const rows = this.db.prepare(`SELECT * FROM qa_holds WHERE task_id = ? AND active = 1`).all(taskId) as Row[];
    return rows.map(readHold);
  }

  insertWake(questionId: string, taskId: string, answer: string, createdAt: number): void {
    const wakeId = this.nextId("wake", "W");
    this.db
      .prepare(`INSERT INTO qa_wakes(wake_id, question_id, waiting_task_id, answer, created_at) VALUES (?, ?, ?, ?, ?)`)
      .run(wakeId, questionId, taskId, answer, createdAt);
  }

  wakesFor(questionId: string): WakeRecord[] {
    const rows = this.db
      .prepare(`SELECT * FROM qa_wakes WHERE question_id = ? ORDER BY created_at, wake_id`)
      .all(questionId) as Row[];
    return rows.map((row) => ({
      wakeId: requiredText(row, "wake_id"),
      questionId: requiredText(row, "question_id"),
      waitingTaskId: requiredText(row, "waiting_task_id"),
      answer: requiredText(row, "answer"),
      createdAt: requiredInt(row, "created_at"),
    }));
  }

  insertPending(input: {
    readonly questionId: string;
    readonly optionsVersion: number;
    readonly optionId: string | null;
    readonly replyText: string;
    readonly createdAt: number;
  }): string {
    const pendingId = this.nextId("pending", "PR");
    this.db
      .prepare(
        `INSERT INTO qa_pending_replies(pending_id, question_id, options_version, option_id, reply_text, created_at, disposition)
         VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
      )
      .run(pendingId, input.questionId, input.optionsVersion, input.optionId, input.replyText, input.createdAt);
    return pendingId;
  }

  getPending(pendingId: string): PendingReply | null {
    const row = this.db.prepare(`SELECT * FROM qa_pending_replies WHERE pending_id = ?`).get(pendingId) as Row | undefined;
    if (!row) return null;
    const disposition = requiredText(row, "disposition");
    if (disposition !== "pending" && disposition !== "kept" && disposition !== "changed") {
      throw new QuestionTransactionError(`Unexpected pending disposition ${disposition}.`);
    }
    return {
      pendingId: requiredText(row, "pending_id"),
      questionId: requiredText(row, "question_id"),
      optionsVersion: requiredInt(row, "options_version"),
      optionId: optionalText(row, "option_id"),
      replyText: requiredText(row, "reply_text"),
      createdAt: requiredInt(row, "created_at"),
      disposition,
    };
  }

  setPendingDisposition(pendingId: string, disposition: "kept" | "changed"): void {
    this.db.prepare(`UPDATE qa_pending_replies SET disposition = ? WHERE pending_id = ?`).run(disposition, pendingId);
  }

  registerFact(draft: SettledFactDraft & { readonly topicKey: string; readonly normalizedText: string }): SettledFact {
    const existing = this.findFact(draft);
    if (existing && existing.answer === draft.answer) return existing;
    if (existing) {
      this.db.prepare(`UPDATE qa_settled_facts SET answer = ?, source = ? WHERE fact_id = ?`).run(draft.answer, draft.source, existing.factId);
      return { ...existing, answer: draft.answer, source: draft.source };
    }
    const factId = this.nextId("fact", "SF");
    this.db
      .prepare(
        `INSERT INTO qa_settled_facts(
           fact_id, scope_id, criterion_id, topic_key, normalized_text, answer, source, table_name, column_name
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        factId,
        draft.scopeId ?? null,
        draft.criterionId ?? null,
        draft.topicKey,
        draft.normalizedText,
        draft.answer,
        draft.source,
        draft.tableName ?? null,
        draft.columnName ?? null,
      );
    this.db.prepare(`INSERT INTO qa_settled_fts(fact_id, body) VALUES (?, ?)`).run(factId, draft.normalizedText);
    return {
      factId,
      scopeId: draft.scopeId ?? null,
      criterionId: draft.criterionId ?? null,
      topicKey: draft.topicKey,
      normalizedText: draft.normalizedText,
      answer: draft.answer,
      source: draft.source,
      tableName: draft.tableName ?? null,
      columnName: draft.columnName ?? null,
    };
  }

  lookupFact(input: { readonly text: string; readonly scopeId?: string; readonly criterionId?: string }): SettledFact | null {
    const normalized = normalizeTopic(input.text);
    if (input.scopeId !== undefined && input.criterionId !== undefined) {
      const scoped = readFactRow(this.factByScope.get(input.scopeId, input.criterionId) as Row | undefined);
      if (scoped) return scoped;
    }
    const exact = readFactRow(this.factByText.get(normalized) as Row | undefined);
    if (exact) return exact;
    const keyed = readFactRow(
      this.factByTopic.get(questionKey({ text: input.text, scopeId: input.scopeId, criterionId: input.criterionId })) as
        | Row
        | undefined,
    );
    if (keyed) return keyed;
    const entity = this.lookupEntity(normalized);
    if (entity) return entity;
    return this.lookupFts(normalized);
  }

  appendOutbox(type: string, subject: string, payload: Record<string, unknown>, createdAt: number): void {
    const id = this.nextId("outbox", "OB");
    const body = JSON.stringify(payload);
    this.db
      .prepare(`INSERT INTO outbox(id, type, subject, rev, payload, created_at) VALUES (?, ?, ?, NULL, ?, ?)`)
      .run(id, type, subject, body, createdAt);
    for (const consumer of OUTBOX_CONSUMERS) {
      this.db
        .prepare(`INSERT INTO outbox_deliveries(event_id, consumer, delivered_at) VALUES (?, ?, NULL)`)
        .run(id, consumer);
    }
  }

  listOutbox(): OutboxEventRecord[] {
    const rows = this.db.prepare(`SELECT id, type, subject, payload, created_at FROM outbox ORDER BY seq`).all() as Row[];
    return rows.map((row) => ({
      id: requiredText(row, "id"),
      type: requiredText(row, "type"),
      subject: optionalText(row, "subject"),
      payload: requiredText(row, "payload"),
      createdAt: requiredInt(row, "created_at"),
    }));
  }

  syncProjection(questionId: string): void {
    const card = this.getCard(questionId);
    if (!card) throw new QuestionTransactionError(`Cannot project missing question ${questionId}.`);
    const active = card.subscribers.filter((subscriber) => subscriber.active);
    const payload = JSON.stringify({
      domainStatus: card.status,
      retiredReason: card.retiredReason,
      questionKey: card.questionKey,
      blockedWorkerCount: card.blockedWorkerCount,
      whyThisMatters: card.whyThisMatters,
      blockingLabel: card.blockingLabel,
      optionsVersion: card.optionsVersion,
      settledAnswer: card.settledAnswer,
      settledBy: card.settledBy,
      scopeId: card.scopeId,
      criterionId: card.criterionId,
      featureId: card.featureId,
      subscribers: active.map((subscriber) => ({
        waitingTaskId: subscriber.waitingTaskId,
        waitingRole: subscriber.waitingRole,
      })),
    });
    this.db
      .prepare(
        `INSERT INTO inbox_items(id, kind, subject, owner_role, priority, status, payload, needed_by, created_at, resolved_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           kind = excluded.kind,
           subject = excluded.subject,
           owner_role = excluded.owner_role,
           priority = excluded.priority,
           status = excluded.status,
           payload = excluded.payload,
           resolved_at = excluded.resolved_at`,
      )
      .run(
        card.questionId,
        canonicalInboxKind(card.kind),
        card.text,
        card.ownerRole,
        card.priorityRank,
        canonicalInboxStatus(card.status),
        payload,
        card.createdAt,
        card.resolvedAt,
      );
    this.db.prepare(`DELETE FROM inbox_subscribers WHERE item = ?`).run(card.questionId);
    const insert = this.db.prepare(`INSERT INTO inbox_subscribers(item, task) VALUES (?, ?)`);
    for (const subscriber of active) insert.run(card.questionId, subscriber.waitingTaskId);
  }

  projection(questionId: string): InboxProjection | null {
    const row = this.db.prepare(`SELECT * FROM inbox_items WHERE id = ?`).get(questionId) as Row | undefined;
    if (!row) return null;
    const subscribers = this.db.prepare(`SELECT item, task FROM inbox_subscribers WHERE item = ?`).all(questionId) as Row[];
    return {
      id: requiredText(row, "id"),
      kind: requiredText(row, "kind"),
      status: requiredText(row, "status"),
      priority: requiredInt(row, "priority"),
      payload: requiredText(row, "payload"),
      subscribers: subscribers.map((subscriber) => ({
        item: requiredText(subscriber, "item"),
        task: requiredText(subscriber, "task"),
      })),
    };
  }

  activeSubscribers(questionId: string): QuestionSubscriber[] {
    return this.subscribers(questionId).filter((subscriber) => subscriber.active);
  }

  private hydrate(row: Row): QuestionCard {
    const payload = readPayload(requiredText(row, "payload"));
    const questionId = requiredText(row, "id");
    const subscribers = this.subscribers(questionId);
    const blockedWorkerCount = requiredInt(row, "blocked_worker_count");
    const priority = requiredTier(requiredText(row, "priority_tier"));
    const status = requiredStatus(requiredText(row, "status"));
    const recommended = payload.options.some((option) => option.id === payload.recommendedOptionId)
      ? payload.recommendedOptionId
      : (payload.options[0]?.id ?? "opt-1");
    return {
      questionId,
      buildId: requiredText(row, "build_id"),
      questionKey: requiredText(row, "question_key"),
      scopeId: optionalText(row, "scope_id"),
      criterionId: optionalText(row, "criterion_id"),
      featureId: optionalText(row, "feature_id"),
      contractId: optionalText(row, "contract_id"),
      kind: requiredKind(requiredText(row, "kind")),
      humanReason: requiredReason(requiredText(row, "human_reason")),
      text: payload.text,
      ownerRole: requiredText(row, "owner_role"),
      priority,
      priorityRank: priorityRank(priority),
      status,
      optionsVersion: requiredInt(row, "options_version"),
      options: payload.options,
      recommendedOptionId: recommended,
      whyThisMatters: whyThisMatters(blockedWorkerCount),
      blockingLabel: blockingLabel(blockedWorkerCount),
      blockedWorkerCount,
      subscribers,
      createdAt: requiredInt(row, "created_at"),
      resolvedAt: optionalInt(row, "resolved_at"),
      retiredReason: optionalText(row, "retired_reason"),
      settledAnswer: optionalText(row, "settled_answer"),
      settledOptionId: optionalText(row, "settled_option_id"),
      settledBy: optionalText(row, "settled_by"),
      signals: payload.signals,
      onCriticalPath: requiredInt(row, "on_critical_path") === 1,
    };
  }

  private subscribers(questionId: string): QuestionSubscriber[] {
    const rows = this.db
      .prepare(
        `SELECT waiting_task_id, waiting_role, active, created_at
         FROM qa_inbox_subscribers WHERE question_id = ? ORDER BY created_at, waiting_task_id`,
      )
      .all(questionId) as Row[];
    return rows.map((row) => ({
      waitingTaskId: requiredText(row, "waiting_task_id"),
      waitingRole: requiredText(row, "waiting_role"),
      active: requiredInt(row, "active") === 1,
      createdAt: requiredInt(row, "created_at"),
    }));
  }

  private requireRow(questionId: string): Row {
    const row = this.db.prepare(`SELECT * FROM qa_inbox_items WHERE id = ?`).get(questionId) as Row | undefined;
    if (!row) throw new QuestionTransactionError(`Question ${questionId} does not exist.`);
    return row;
  }

  private factBy(sql: string, ...params: string[]): SettledFact | null {
    const row = this.db.prepare(sql).get(...params) as Row | undefined;
    if (!row) return null;
    return readFact(row);
  }

  private lookupEntity(normalized: string): SettledFact | null {
    const tokens = new Set(normalized.split(" ").filter((token) => token.length > 0));
    if (!tokens.has("column") && !tokens.has("field")) return null;
    const rows = this.db
      .prepare(
        `SELECT * FROM qa_settled_facts
         WHERE source = 'entity_schema' AND table_name IS NOT NULL AND column_name IS NOT NULL`,
      )
      .all() as Row[];
    for (const row of rows) {
      const tableName = optionalText(row, "table_name");
      const columnName = optionalText(row, "column_name");
      if (tableName && columnName && tokens.has(tableName) && tokens.has(columnName)) return readFact(row);
    }
    return null;
  }

  private lookupFts(normalized: string): SettledFact | null {
    const tokens = normalized.split(" ").filter((token) => /^[\p{L}\p{N}]+$/u.test(token) && token.length > 2);
    if (tokens.length < 2) return null;
    const match = tokens.map((token) => `"${token}"`).join(" AND ");
    let row: Row | undefined;
    try {
      row = this.db
        .prepare(`SELECT fact_id FROM qa_settled_fts WHERE qa_settled_fts MATCH ? ORDER BY bm25(qa_settled_fts) LIMIT 1`)
        .get(match) as Row | undefined;
    } catch {
      return null;
    }
    if (!row) return null;
    const fact = this.factBy(`SELECT * FROM qa_settled_facts WHERE fact_id = ?`, requiredText(row, "fact_id"));
    if (!fact) return null;
    const factTokens = new Set(fact.normalizedText.split(" "));
    const shared = tokens.filter((token) => factTokens.has(token)).length;
    if (shared < 2) return null;
    return fact;
  }

  private findFact(draft: { readonly topicKey: string; readonly normalizedText: string; readonly scopeId?: string; readonly criterionId?: string }): SettledFact | null {
    if (draft.scopeId !== undefined && draft.criterionId !== undefined) {
      const scoped = this.factBy(
        `SELECT * FROM qa_settled_facts WHERE scope_id = ? AND criterion_id = ? LIMIT 1`,
        draft.scopeId,
        draft.criterionId,
      );
      if (scoped) return scoped;
    }
    return (
      this.factBy(`SELECT * FROM qa_settled_facts WHERE topic_key = ? LIMIT 1`, draft.topicKey) ??
      this.factBy(`SELECT * FROM qa_settled_facts WHERE normalized_text = ? LIMIT 1`, draft.normalizedText)
    );
  }
}

function encodePayload(payload: StoredPayload): string {
  return JSON.stringify({
    text: payload.text,
    options: payload.options,
    recommendedOptionId: payload.recommendedOptionId,
    signals: payload.signals,
  });
}

function readPayload(text: string): StoredPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw new QuestionTransactionError("Question payload is not JSON.");
  }
  if (!parsed || typeof parsed !== "object") throw new QuestionTransactionError("Question payload is not an object.");
  const record = parsed as Record<string, unknown>;
  if (typeof record.text !== "string") throw new QuestionTransactionError("Question payload is missing text.");
  if (!Array.isArray(record.options)) throw new QuestionTransactionError("Question payload is missing options.");
  const options = record.options.map((item) => readOption(item));
  if (typeof record.recommendedOptionId !== "string") {
    throw new QuestionTransactionError("Question payload is missing a recommended option.");
  }
  return {
    text: record.text,
    options,
    recommendedOptionId: record.recommendedOptionId,
    signals: readSignals(record.signals),
  };
}

function readOption(value: unknown): QuestionOption {
  if (!value || typeof value !== "object") throw new QuestionTransactionError("Option payload is invalid.");
  const record = value as Record<string, unknown>;
  if (typeof record.number !== "number" || typeof record.id !== "string" || typeof record.label !== "string") {
    throw new QuestionTransactionError("Option payload is invalid.");
  }
  return { number: record.number, id: record.id, label: record.label };
}

function readSignals(value: unknown): PrioritySignals {
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    stop: record.stop === true,
    security: record.security === true,
    authExpiry: record.authExpiry === true,
    budgetCap: record.budgetCap === true,
    criticalBlocker: record.criticalBlocker === true,
  };
}

function readHold(row: Row): HoldReason {
  const mode = requiredText(row, "mode");
  if (mode !== "HARD_HOLD" && mode !== "SOFT_HOLD") throw new QuestionTransactionError(`Unexpected hold mode ${mode}.`);
  return {
    taskId: requiredText(row, "task_id"),
    reasonType: requiredText(row, "reason_type"),
    reasonRefId: requiredText(row, "reason_ref_id"),
    mode,
    active: requiredInt(row, "active") === 1,
  };
}

function readFactRow(row: Row | undefined): SettledFact | null {
  if (!row) return null;
  return readFact(row);
}

function readFact(row: Row): SettledFact {
  return {
    factId: requiredText(row, "fact_id"),
    scopeId: optionalText(row, "scope_id"),
    criterionId: optionalText(row, "criterion_id"),
    topicKey: requiredText(row, "topic_key"),
    normalizedText: requiredText(row, "normalized_text"),
    answer: requiredText(row, "answer"),
    source: requiredSource(requiredText(row, "source")),
    tableName: optionalText(row, "table_name"),
    columnName: optionalText(row, "column_name"),
  };
}

function requiredText(row: Row | undefined, key: string): string {
  const value = row?.[key];
  if (typeof value !== "string") throw new QuestionTransactionError(`${key} is not text.`);
  return value;
}

function optionalText(row: Row, key: string): string | null {
  const value = row[key];
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") throw new QuestionTransactionError(`${key} is not text.`);
  return value;
}

function requiredInt(row: Row | undefined, key: string): number {
  const value = row?.[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "bigint") return Number(value);
  throw new QuestionTransactionError(`${key} is not an integer.`);
}

function optionalInt(row: Row, key: string): number | null {
  const value = row[key];
  if (value === null || value === undefined) return null;
  return requiredInt({ [key]: value }, key);
}

function requiredTier(value: string): PriorityTier {
  if (value === "P0" || value === "P1" || value === "P2" || value === "P3" || value === "P4") return value;
  throw new QuestionTransactionError(`Unexpected priority ${value}.`);
}

function requiredStatus(value: string): QuestionStatus {
  if (value === "open" || value === "answered" || value === "superseded" || value === "dismissed" || value === "retired") {
    return value;
  }
  throw new QuestionTransactionError(`Unexpected status ${value}.`);
}

function requiredKind(value: string): QuestionKind {
  if (
    value === "technical" ||
    value === "product" ||
    value === "secret" ||
    value === "approval" ||
    value === "human_step" ||
    value === "dispute_test" ||
    value === "breaking_ccr" ||
    value === "conflict" ||
    value === "ambiguous_steering" ||
    value === "escalation" ||
    value === "advisory"
  ) {
    return value;
  }
  throw new QuestionTransactionError(`Unexpected kind ${value}.`);
}

function requiredReason(value: string): QuestionCard["humanReason"] {
  if (
    value === "unsettled_product_behavior" ||
    value === "ambiguous_steering" ||
    value === "breaking_ccr" ||
    value === "secret" ||
    value === "approval" ||
    value === "human_step" ||
    value === "dispute_test" ||
    value === "unresolvable_escalation" ||
    value === "advisory"
  ) {
    return value;
  }
  throw new QuestionTransactionError(`Unexpected human reason ${value}.`);
}

function requiredSource(value: string): SettledSource {
  if (value === "decision" || value === "contract" || value === "rule" || value === "entity_schema") return value;
  throw new QuestionTransactionError(`Unexpected settled source ${value}.`);
}

export function isUniqueConstraint(error: unknown): boolean {
  return error instanceof Error && error.message.includes("UNIQUE constraint failed");
}
