import { DatabaseSync, type SQLOutputValue } from "node:sqlite";
import { ensureTaskRuntime } from "../state-seed.js";
import { HUMAN_QUEUE_OWNER, OUTBOX_CONSUMERS, type PriorityTier, type QuestionKind, type QuestionStatus } from "./constants.js";
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

const COUNTERS = "steering.question_counters";
const HOLDS = "steering.question_holds";
const WAKES = "steering.question_wakes";
const PENDING = "steering.question_pending";
const FACTS = "steering.settled_facts";

interface QuestionDoc {
  questionId: string;
  buildId: string;
  questionKey: string;
  scopeId: string | null;
  criterionId: string | null;
  featureId: string | null;
  contractId: string | null;
  kind: QuestionKind;
  humanReason: QuestionCard["humanReason"];
  text: string;
  ownerRole: string;
  priority: PriorityTier;
  status: QuestionStatus;
  domainStatus: QuestionStatus;
  optionsVersion: number;
  options: QuestionOption[];
  recommendedOptionId: string;
  blockedWorkerCount: number;
  subscribers: QuestionSubscriber[];
  createdAt: number;
  resolvedAt: number | null;
  retiredReason: string | null;
  settledAnswer: string | null;
  settledOptionId: string | null;
  settledBy: string | null;
  signals: PrioritySignals;
  onCriticalPath: boolean;
}

interface StoredHold {
  taskId: string;
  reasonType: string;
  reasonRefId: string;
  mode: "HARD_HOLD" | "SOFT_HOLD";
  active: boolean;
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

  constructor(private readonly db: DatabaseSync) {
    this.db.exec("PRAGMA busy_timeout = 5000");
    const inbox = this.db.prepare("SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = 'inbox_items'").get();
    if (!inbox) throw new QuestionTransactionError("Question arbiter requires ProjectStateDb inbox_items.");
    const shadow = this.db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'qa_%' LIMIT 1")
      .get() as { name?: string } | undefined;
    if (shadow?.name) throw new QuestionTransactionError(`Refusing shadow table ${shadow.name}.`);
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
    const counters = readJson<Record<string, number>>(this.db, COUNTERS, {});
    const value = (counters[name] ?? 0) + 1;
    counters[name] = value;
    writeJson(this.db, COUNTERS, counters);
    return `${prefix}-${String(value)}`;
  }

  findOpenByKey(key: string): QuestionCard | null {
    for (const card of this.listOpen()) {
      if (card.questionKey === key) return card;
    }
    return null;
  }

  getCard(questionId: string): QuestionCard | null {
    const doc = this.readDoc(questionId);
    return doc ? this.hydrate(doc) : null;
  }

  listOpen(): QuestionCard[] {
    return this.listDocs()
      .filter((doc) => doc.status === "open")
      .map((doc) => this.hydrate(doc));
  }

  listOpenForFeature(featureId: string): QuestionCard[] {
    return this.listOpen().filter((card) => card.featureId === featureId);
  }

  openQuestionIdsForTask(taskId: string): string[] {
    return this.listOpen()
      .filter((card) => card.subscribers.some((subscriber) => subscriber.active && subscriber.waitingTaskId === taskId))
      .map((card) => card.questionId);
  }

  insertQuestion(input: NewQuestionInput): void {
    if (this.findOpenByKey(input.questionKey)) {
      throw new Error("UNIQUE constraint failed: inbox_items.question_key");
    }
    const doc: QuestionDoc = {
      questionId: input.id,
      buildId: input.buildId,
      questionKey: input.questionKey,
      scopeId: input.scopeId,
      criterionId: input.criterionId,
      featureId: input.featureId,
      contractId: input.contractId,
      kind: input.kind,
      humanReason: input.humanReason,
      text: input.text,
      ownerRole: HUMAN_QUEUE_OWNER,
      priority: input.priority,
      status: "open",
      domainStatus: "open",
      optionsVersion: 1,
      options: [...input.options],
      recommendedOptionId: input.recommendedOptionId,
      blockedWorkerCount: 0,
      subscribers: [],
      createdAt: input.createdAt,
      resolvedAt: null,
      retiredReason: null,
      settledAnswer: null,
      settledOptionId: null,
      settledBy: null,
      signals: input.signals,
      onCriticalPath: input.onCriticalPath,
    };
    this.writeDoc(doc);
  }

  addSubscriber(questionId: string, taskId: string, role: string, createdAt: number): "added" | "reactivated" | "exists" {
    const doc = this.requireDoc(questionId);
    const existing = doc.subscribers.find((subscriber) => subscriber.waitingTaskId === taskId);
    if (!existing) {
      doc.subscribers = [...doc.subscribers, { waitingTaskId: taskId, waitingRole: role, active: true, createdAt }];
      this.writeDoc(doc);
      return "added";
    }
    if (existing.active) return "exists";
    doc.subscribers = doc.subscribers.map((subscriber) =>
      subscriber.waitingTaskId === taskId ? { ...subscriber, waitingRole: role, active: true } : subscriber,
    );
    this.writeDoc(doc);
    return "reactivated";
  }

  deactivateSubscriber(questionId: string, taskId: string): boolean {
    const doc = this.requireDoc(questionId);
    const existing = doc.subscribers.find((subscriber) => subscriber.waitingTaskId === taskId && subscriber.active);
    if (!existing) return false;
    doc.subscribers = doc.subscribers.map((subscriber) =>
      subscriber.waitingTaskId === taskId ? { ...subscriber, active: false } : subscriber,
    );
    this.writeDoc(doc);
    return true;
  }

  deactivateAll(questionId: string): string[] {
    const doc = this.requireDoc(questionId);
    const active = doc.subscribers.filter((subscriber) => subscriber.active).map((subscriber) => subscriber.waitingTaskId);
    doc.subscribers = doc.subscribers.map((subscriber) => ({ ...subscriber, active: false }));
    this.writeDoc(doc);
    return active;
  }

  updateDelivery(questionId: string, update: JoinUpdate): void {
    const doc = this.requireDoc(questionId);
    doc.priority = update.priority;
    doc.blockedWorkerCount = update.blockedWorkerCount;
    doc.onCriticalPath = update.onCriticalPath;
    this.writeDoc(doc);
  }

  reviseOptions(questionId: string, options: readonly QuestionOption[], recommendedOptionId: string, version: number): void {
    const doc = this.requireDoc(questionId);
    doc.options = [...options];
    doc.recommendedOptionId = recommendedOptionId;
    doc.optionsVersion = version;
    this.writeDoc(doc);
  }

  markAnswered(input: {
    readonly questionId: string;
    readonly answer: string;
    readonly optionId: string | null;
    readonly settledBy: string;
    readonly resolvedAt: number;
  }): void {
    const doc = this.requireDoc(input.questionId);
    doc.status = "answered";
    doc.domainStatus = "answered";
    doc.settledAnswer = input.answer;
    doc.settledOptionId = input.optionId;
    doc.settledBy = input.settledBy;
    doc.resolvedAt = input.resolvedAt;
    doc.retiredReason = null;
    this.writeDoc(doc);
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
    const doc = this.requireDoc(questionId);
    doc.status = "retired";
    doc.domainStatus = "retired";
    doc.retiredReason = reason;
    doc.resolvedAt = resolvedAt;
    doc.blockedWorkerCount = 0;
    if (settled) {
      doc.settledBy = settled.settledBy;
      if (settled.answer !== null) doc.settledAnswer = settled.answer;
    }
    this.writeDoc(doc);
  }

  placeHold(reason: Omit<HoldReason, "active">): void {
    const holds = this.holds();
    const index = holds.findIndex(
      (hold) => hold.taskId === reason.taskId && hold.reasonType === reason.reasonType && hold.reasonRefId === reason.reasonRefId,
    );
    const next: StoredHold = { ...reason, active: true };
    if (index >= 0) holds[index] = next;
    else holds.push(next);
    writeJson(this.db, HOLDS, holds);
  }

  clearHold(taskId: string, reasonType: string, reasonRefId: string): void {
    if (this.holdClearFailures > 0) {
      this.holdClearFailures -= 1;
      throw new HoldClearFailedError();
    }
    const holds = this.holds().map((hold) => {
      if (hold.taskId === taskId && hold.reasonType === reasonType && hold.reasonRefId === reasonRefId && hold.active) {
        return { ...hold, active: false };
      }
      return hold;
    });
    writeJson(this.db, HOLDS, holds);
  }

  holdsFor(taskId: string): HoldReason[] {
    return this.holds()
      .filter((hold) => hold.taskId === taskId && hold.active)
      .map((hold) => ({ ...hold }));
  }

  insertWake(questionId: string, taskId: string, answer: string, createdAt: number): void {
    const wakeId = this.nextId("wake", "W");
    const wakes = readJson<WakeRecord[]>(this.db, WAKES, []);
    wakes.push({ wakeId, questionId, waitingTaskId: taskId, answer, createdAt });
    writeJson(this.db, WAKES, wakes);
  }

  wakesFor(questionId: string): WakeRecord[] {
    return readJson<WakeRecord[]>(this.db, WAKES, [])
      .filter((wake) => wake.questionId === questionId)
      .sort((left, right) => left.createdAt - right.createdAt || left.wakeId.localeCompare(right.wakeId));
  }

  insertPending(input: {
    readonly questionId: string;
    readonly optionsVersion: number;
    readonly optionId: string | null;
    readonly replyText: string;
    readonly createdAt: number;
  }): string {
    const pendingId = this.nextId("pending", "PR");
    const pending = readJson<PendingReply[]>(this.db, PENDING, []);
    pending.push({
      pendingId,
      questionId: input.questionId,
      optionsVersion: input.optionsVersion,
      optionId: input.optionId,
      replyText: input.replyText,
      createdAt: input.createdAt,
      disposition: "pending",
    });
    writeJson(this.db, PENDING, pending);
    return pendingId;
  }

  getPending(pendingId: string): PendingReply | null {
    return readJson<PendingReply[]>(this.db, PENDING, []).find((item) => item.pendingId === pendingId) ?? null;
  }

  setPendingDisposition(pendingId: string, disposition: "kept" | "changed"): void {
    const pending = readJson<PendingReply[]>(this.db, PENDING, []);
    const index = pending.findIndex((row) => row.pendingId === pendingId);
    const item = pending[index];
    if (!item) throw new QuestionTransactionError(`Pending reply ${pendingId} does not exist.`);
    pending[index] = { ...item, disposition };
    writeJson(this.db, PENDING, pending);
  }

  registerFact(draft: SettledFactDraft & { readonly topicKey: string; readonly normalizedText: string }): SettledFact {
    const existing = this.findFact(draft);
    if (existing && existing.answer === draft.answer) return existing;
    const facts = readJson<SettledFact[]>(this.db, FACTS, []);
    if (existing) {
      const next = facts.map((fact) =>
        fact.factId === existing.factId ? { ...fact, answer: draft.answer, source: draft.source } : fact,
      );
      writeJson(this.db, FACTS, next);
      return { ...existing, answer: draft.answer, source: draft.source };
    }
    const fact: SettledFact = {
      factId: this.nextId("fact", "SF"),
      scopeId: draft.scopeId ?? null,
      criterionId: draft.criterionId ?? null,
      topicKey: draft.topicKey,
      normalizedText: draft.normalizedText,
      answer: draft.answer,
      source: draft.source,
      tableName: draft.tableName ?? null,
      columnName: draft.columnName ?? null,
    };
    facts.push(fact);
    writeJson(this.db, FACTS, facts);
    return fact;
  }

  lookupFact(input: { readonly text: string; readonly scopeId?: string; readonly criterionId?: string }): SettledFact | null {
    const normalized = normalizeTopic(input.text);
    const facts = readJson<SettledFact[]>(this.db, FACTS, []);
    if (input.scopeId !== undefined && input.criterionId !== undefined) {
      const scoped = facts.find((fact) => fact.scopeId === input.scopeId && fact.criterionId === input.criterionId);
      if (scoped) return scoped;
    }
    const exact = facts.find((fact) => fact.normalizedText === normalized);
    if (exact) return exact;
    const keyed = facts.find(
      (fact) => fact.topicKey === questionKey({ text: input.text, scopeId: input.scopeId, criterionId: input.criterionId }),
    );
    if (keyed) return keyed;
    const entity = this.lookupEntity(normalized, facts);
    if (entity) return entity;
    return this.lookupTokens(normalized, facts);
  }

  appendOutbox(type: string, subject: string, payload: Record<string, unknown>, createdAt: number): void {
    const id = this.nextId("outbox", "OB");
    const body = JSON.stringify(payload);
    this.db.prepare(`INSERT INTO outbox(id, type, subject, rev, payload, created_at) VALUES (?, ?, ?, NULL, ?, ?)`).run(
      id,
      type,
      subject,
      body,
      createdAt,
    );
    for (const consumer of OUTBOX_CONSUMERS) {
      this.db.prepare(`INSERT INTO outbox_deliveries(event_id, consumer, delivered_at) VALUES (?, ?, NULL)`).run(id, consumer);
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
    const doc = this.readDoc(questionId);
    if (!doc) throw new QuestionTransactionError(`Cannot project missing question ${questionId}.`);
    doc.domainStatus = doc.status;
    this.writeDoc(doc);
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
    return this.requireDoc(questionId).subscribers.filter((subscriber) => subscriber.active);
  }

  private holds(): StoredHold[] {
    return readJson<StoredHold[]>(this.db, HOLDS, []);
  }

  private listDocs(): QuestionDoc[] {
    const rows = this.db.prepare(`SELECT payload FROM inbox_items ORDER BY rowid`).all() as Row[];
    const docs: QuestionDoc[] = [];
    for (const row of rows) {
      const doc = parseDoc(requiredText(row, "payload"));
      if (doc) docs.push(doc);
    }
    return docs;
  }

  private readDoc(questionId: string): QuestionDoc | null {
    const row = this.db.prepare(`SELECT payload FROM inbox_items WHERE id = ?`).get(questionId) as Row | undefined;
    if (!row) return null;
    return parseDoc(requiredText(row, "payload"));
  }

  private requireDoc(questionId: string): QuestionDoc {
    const doc = this.readDoc(questionId);
    if (!doc) throw new QuestionTransactionError(`Question ${questionId} does not exist.`);
    return doc;
  }

  private writeDoc(doc: QuestionDoc): void {
    doc.domainStatus = doc.status;
    const payload = JSON.stringify(doc);
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
        doc.questionId,
        canonicalInboxKind(doc.kind),
        doc.text,
        doc.ownerRole,
        priorityRank(doc.priority),
        canonicalInboxStatus(doc.status),
        payload,
        doc.createdAt,
        doc.resolvedAt,
      );
    this.db.prepare(`DELETE FROM inbox_subscribers WHERE item = ?`).run(doc.questionId);
    const insert = this.db.prepare(`INSERT INTO inbox_subscribers(item, task) VALUES (?, ?)`);
    for (const subscriber of doc.subscribers) {
      if (!subscriber.active) continue;
      ensureTaskRuntime(this.db, subscriber.waitingTaskId, doc.featureId ?? subscriber.waitingTaskId, "WAITING_INPUT");
      insert.run(doc.questionId, subscriber.waitingTaskId);
    }
  }

  private hydrate(doc: QuestionDoc): QuestionCard {
    const recommended = doc.options.some((option) => option.id === doc.recommendedOptionId)
      ? doc.recommendedOptionId
      : (doc.options[0]?.id ?? "opt-1");
    return {
      questionId: doc.questionId,
      buildId: doc.buildId,
      questionKey: doc.questionKey,
      scopeId: doc.scopeId,
      criterionId: doc.criterionId,
      featureId: doc.featureId,
      contractId: doc.contractId,
      kind: doc.kind,
      humanReason: doc.humanReason,
      text: doc.text,
      ownerRole: doc.ownerRole,
      priority: doc.priority,
      priorityRank: priorityRank(doc.priority),
      status: doc.status,
      optionsVersion: doc.optionsVersion,
      options: doc.options,
      recommendedOptionId: recommended,
      whyThisMatters: whyThisMatters(doc.blockedWorkerCount),
      blockingLabel: blockingLabel(doc.blockedWorkerCount),
      blockedWorkerCount: doc.blockedWorkerCount,
      subscribers: doc.subscribers,
      createdAt: doc.createdAt,
      resolvedAt: doc.resolvedAt,
      retiredReason: doc.retiredReason,
      settledAnswer: doc.settledAnswer,
      settledOptionId: doc.settledOptionId,
      settledBy: doc.settledBy,
      signals: doc.signals,
      onCriticalPath: doc.onCriticalPath,
    };
  }

  private findFact(draft: {
    readonly topicKey: string;
    readonly normalizedText: string;
    readonly scopeId?: string;
    readonly criterionId?: string;
  }): SettledFact | null {
    const facts = readJson<SettledFact[]>(this.db, FACTS, []);
    if (draft.scopeId !== undefined && draft.criterionId !== undefined) {
      const scoped = facts.find((fact) => fact.scopeId === draft.scopeId && fact.criterionId === draft.criterionId);
      if (scoped) return scoped;
    }
    return facts.find((fact) => fact.topicKey === draft.topicKey) ?? facts.find((fact) => fact.normalizedText === draft.normalizedText) ?? null;
  }

  private lookupEntity(normalized: string, facts: readonly SettledFact[]): SettledFact | null {
    const tokens = new Set(normalized.split(" ").filter((token) => token.length > 0));
    if (!tokens.has("column") && !tokens.has("field")) return null;
    for (const fact of facts) {
      if (fact.source !== "entity_schema" || fact.tableName === null || fact.columnName === null) continue;
      if (tokens.has(fact.tableName) && tokens.has(fact.columnName)) return fact;
    }
    return null;
  }

  private lookupTokens(normalized: string, facts: readonly SettledFact[]): SettledFact | null {
    const tokens = normalized.split(" ").filter((token) => /^[\p{L}\p{N}]+$/u.test(token) && token.length > 2);
    if (tokens.length < 2) return null;
    for (const fact of facts) {
      const factTokens = new Set(fact.normalizedText.split(" "));
      const shared = tokens.filter((token) => factTokens.has(token));
      if (shared.length >= 2 && shared.length === tokens.length) return fact;
    }
    return null;
  }
}

function readJson<T>(db: DatabaseSync, key: string, fallback: T): T {
  const row = db.prepare(`SELECT value FROM meta WHERE key = ?`).get(key) as Row | undefined;
  if (!row) return structuredClone(fallback);
  try {
    return JSON.parse(requiredText(row, "value")) as T;
  } catch {
    return structuredClone(fallback);
  }
}

function writeJson(db: DatabaseSync, key: string, value: unknown): void {
  db.prepare(
    `INSERT INTO meta(key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(key, JSON.stringify(value));
}

function parseDoc(payload: string): QuestionDoc | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload) as unknown;
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const record = parsed as Partial<QuestionDoc>;
  if (typeof record.questionId !== "string" || typeof record.questionKey !== "string" || typeof record.text !== "string") {
    return null;
  }
  if (!Array.isArray(record.options) || !Array.isArray(record.subscribers)) return null;
  return record as QuestionDoc;
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

export function isUniqueConstraint(error: unknown): boolean {
  return error instanceof Error && error.message.includes("UNIQUE constraint failed");
}
