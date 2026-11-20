import { localNodeContentHash, parseJsonObject, parseStringArray } from "./canonical-json.js";
import { HintLadderError } from "./errors.js";
import { staticFingerprintMetaKey } from "./fingerprint.js";
import { parseModelLevel } from "./normalize.js";
import { requireQuery, type NamedQueries } from "./queries.js";
import { nullableString, numberValue, stringValue, type SqlValue, type StateDbPort } from "./sql.js";
import type {
  AttemptRow,
  LadderHistoryEntry,
  ModelLevel,
  NodeRow,
  TaskRuntimeRow,
  TestDisputeRecord,
  VerificationRow,
} from "./types.js";

const FINISH_STATES = new Set(["CODING", "READY", "ESCALATED", "EXHAUSTED", "ACCEPTED"]);

export interface TaskTransition {
  readonly state: string;
  readonly level: ModelLevel;
  readonly clearHolder: boolean;
  readonly submissionPending: number;
  readonly updatedRev: number;
  readonly mode: "finish_if_pending" | "direct";
}

export class HintLadderStore {
  constructor(
    private readonly db: StateDbPort,
    private readonly queries: NamedQueries,
  ) {}

  requireTask(taskId: string): TaskRuntimeRow {
    const row = this.db
      .prepare(
        `SELECT state, level, epoch, holder_attempt, submission_pending, updated_rev
           FROM task_runtime WHERE task = :task`,
      )
      .get({ task: taskId });
    if (!row) throw new HintLadderError(`task ${taskId} has no runtime row`);
    return {
      taskId,
      state: stringValue(row, "state"),
      level: parseModelLevel(stringValue(row, "level")),
      epoch: numberValue(row, "epoch"),
      holderAttempt: nullableString(row, "holder_attempt"),
      submissionPending: numberValue(row, "submission_pending"),
      updatedRev: numberValue(row, "updated_rev"),
    };
  }

  readVerification(taskId: string): VerificationRow | undefined {
    const row = this.db
      .prepare(
        `SELECT task, brief_version, ladder_step, last_fingerprint, same_fingerprint,
                disclosed_checks, static_failures, updated_at
           FROM verification_state WHERE task = :task`,
      )
      .get({ task: taskId });
    if (!row) return undefined;
    return {
      taskId: stringValue(row, "task"),
      briefVersion: numberValue(row, "brief_version"),
      ladderStep: numberValue(row, "ladder_step"),
      lastFingerprint: nullableString(row, "last_fingerprint"),
      sameFingerprint: numberValue(row, "same_fingerprint"),
      disclosedChecks: parseStringArray(stringValue(row, "disclosed_checks")),
      staticFailures: numberValue(row, "static_failures"),
      updatedAt: numberValue(row, "updated_at"),
    };
  }

  recordHiddenFailure(input: {
    readonly taskId: string;
    readonly briefVersion: number;
    readonly fingerprint: string;
    readonly now: number;
  }): number {
    const row = this.db.prepare(requireQuery(this.queries, "record_hidden_failure")).get({
      task: input.taskId,
      brief_version: input.briefVersion,
      fingerprint: input.fingerprint,
      now: input.now,
    });
    if (!row) throw new HintLadderError("record_hidden_failure returned no ladder step");
    return numberValue(row, "ladder_step");
  }

  setDisclosed(taskId: string, checkIds: readonly string[], now: number): void {
    this.expectChanges(
      this.db
        .prepare(
          `UPDATE verification_state
              SET disclosed_checks = :disclosed_checks, updated_at = :now
            WHERE task = :task`,
        )
        .run({
          task: taskId,
          disclosed_checks: JSON.stringify(checkIds),
          now,
        }),
      `disclosed checks for ${taskId}`,
    );
  }

  setLadderStep(taskId: string, ladderStep: number, now: number): void {
    this.expectChanges(
      this.db
        .prepare(
          `UPDATE verification_state
              SET ladder_step = :ladder_step, updated_at = :now
            WHERE task = :task`,
        )
        .run({ task: taskId, ladder_step: ladderStep, now }),
      `ladder step for ${taskId}`,
    );
  }

  // Leave ladder_step at 0. The next record_hidden_failure then returns step 1.
  // Setting it to 1 here would skip the first hint on the new brief.
  resetForBrief(taskId: string, briefVersion: number, now: number): void {
    this.db
      .prepare(
        `INSERT INTO verification_state(
           task, brief_version, ladder_step, last_fingerprint, same_fingerprint,
           disclosed_checks, static_failures, updated_at
         ) VALUES (
           :task, :brief_version, 0, NULL, 0, '[]', 0, :now
         )
         ON CONFLICT(task) DO UPDATE SET
           brief_version = excluded.brief_version,
           ladder_step = 0,
           last_fingerprint = NULL,
           same_fingerprint = 0,
           disclosed_checks = '[]',
           updated_at = excluded.updated_at`,
      )
      .run({ task: taskId, brief_version: briefVersion, now });
  }

  resetAfterUpheldDispute(taskId: string, now: number): void {
    const result = this.db
      .prepare(
        `UPDATE verification_state
            SET ladder_step = 0,
                last_fingerprint = NULL,
                same_fingerprint = 0,
                disclosed_checks = '[]',
                static_failures = 0,
                updated_at = :now
          WHERE task = :task`,
      )
      .run({ task: taskId, now });
    if (result.changes > 1) {
      throw new HintLadderError(`verification reset for ${taskId} updated ${result.changes} rows`);
    }
    this.deleteStaticFingerprint(taskId);
  }

  readStaticFingerprint(taskId: string): string | null {
    const row = this.db
      .prepare(`SELECT value FROM meta WHERE key = :key`)
      .get({ key: staticFingerprintMetaKey(taskId) });
    if (!row) return null;
    return stringValue(row, "value");
  }

  writeStaticFingerprint(taskId: string, fingerprint: string): void {
    this.db
      .prepare(
        `INSERT INTO meta(key, value) VALUES (:key, :value)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      )
      .run({ key: staticFingerprintMetaKey(taskId), value: fingerprint });
  }

  deleteStaticFingerprint(taskId: string): void {
    this.db
      .prepare(`DELETE FROM meta WHERE key = :key`)
      .run({ key: staticFingerprintMetaKey(taskId) });
  }

  writeStaticCount(input: {
    readonly taskId: string;
    readonly briefVersion: number;
    readonly staticFailures: number;
    readonly now: number;
  }): void {
    this.db
      .prepare(
        `INSERT INTO verification_state(
           task, brief_version, ladder_step, last_fingerprint, same_fingerprint,
           disclosed_checks, static_failures, updated_at
         ) VALUES (
           :task, :brief_version, 0, NULL, 0, '[]', :static_failures, :now
         )
         ON CONFLICT(task) DO UPDATE SET
           static_failures = excluded.static_failures,
           updated_at = excluded.updated_at`,
      )
      .run({
        task: input.taskId,
        brief_version: input.briefVersion,
        static_failures: input.staticFailures,
        now: input.now,
      });
  }

  transition(task: TaskRuntimeRow, next: TaskTransition): void {
    if (next.level !== task.level) {
      this.expectChanges(
        this.db
          .prepare(`UPDATE task_runtime SET level = :level WHERE task = :task`)
          .run({ task: task.taskId, level: next.level }),
        `level for ${task.taskId}`,
      );
    }
    const canFinish =
      next.mode === "finish_if_pending" &&
      task.submissionPending === 1 &&
      next.submissionPending === 0 &&
      FINISH_STATES.has(next.state);
    if (canFinish) {
      this.expectChanges(
        this.db.prepare(requireQuery(this.queries, "finish_submission")).run({
          task: task.taskId,
          epoch: task.epoch,
          next_state: next.state,
          rev: next.updatedRev,
        }),
        `finish_submission for ${task.taskId}`,
      );
      return;
    }
    const holder: SqlValue = next.clearHolder ? null : task.holderAttempt;
    this.expectChanges(
      this.db
        .prepare(
          `UPDATE task_runtime
              SET state = :state,
                  level = :level,
                  submission_pending = :submission_pending,
                  holder_attempt = :holder_attempt,
                  updated_rev = :updated_rev
            WHERE task = :task`,
        )
        .run({
          task: task.taskId,
          state: next.state,
          level: next.level,
          submission_pending: next.submissionPending,
          holder_attempt: holder,
          updated_rev: next.updatedRev,
        }),
      `task transition for ${task.taskId}`,
    );
  }

  requireAttempt(taskId: string, attemptId: string): AttemptRow {
    const row = this.db
      .prepare(`SELECT id, task, state FROM attempts WHERE id = :id`)
      .get({ id: attemptId });
    if (!row) throw new HintLadderError(`attempt ${attemptId} does not exist`);
    const attemptTask = stringValue(row, "task");
    if (attemptTask !== taskId) {
      throw new HintLadderError(`attempt ${attemptId} does not belong to ${taskId}`);
    }
    return { id: stringValue(row, "id"), taskId: attemptTask, state: stringValue(row, "state") };
  }

  readNode(id: string): NodeRow | undefined {
    const row = this.db
      .prepare(
        `SELECT id, kind, version, title, text, fields, content_hash
           FROM nodes WHERE id = :id`,
      )
      .get({ id });
    if (!row) return undefined;
    return {
      id: stringValue(row, "id"),
      kind: stringValue(row, "kind"),
      version: numberValue(row, "version"),
      title: stringValue(row, "title"),
      text: stringValue(row, "text"),
      fields: stringValue(row, "fields"),
      contentHash: stringValue(row, "content_hash"),
    };
  }

  ruleForCheck(checkId: string): { id: string; text: string } | undefined {
    const linked = this.db
      .prepare(
        `SELECT r.id AS rule_id, r.text AS rule_text
           FROM nodes c
           JOIN edges v ON v.src = c.id AND v.type = 'verifies' AND v.valid_to_rev IS NULL
           JOIN edges d ON d.src = v.dst AND d.type = 'derived_from' AND d.valid_to_rev IS NULL
           JOIN nodes r ON r.id = d.dst AND r.kind = 'rule'
          WHERE c.id = :checkId
          ORDER BY r.id
          LIMIT 1`,
      )
      .get({ checkId });
    if (linked) {
      return { id: stringValue(linked, "rule_id"), text: stringValue(linked, "rule_text") };
    }
    const node = this.readNode(checkId);
    if (!node) return undefined;
    const fields = parseJsonObject(node.fields);
    const ruleId = fields.rule_id;
    if (typeof ruleId !== "string" || ruleId.length === 0) return undefined;
    const rule = this.readNode(ruleId);
    if (!rule || rule.kind !== "rule") return undefined;
    return { id: rule.id, text: rule.text };
  }

  linkedCheckForRule(ruleId: string): string | undefined {
    const row = this.db
      .prepare(
        `SELECT c.id AS id
           FROM nodes c
           JOIN edges v ON v.src = c.id AND v.type = 'verifies' AND v.valid_to_rev IS NULL
           JOIN edges d ON d.src = v.dst AND d.type = 'derived_from' AND d.valid_to_rev IS NULL
          WHERE c.kind = 'check' AND d.dst = :ruleId
          ORDER BY c.id
          LIMIT 1`,
      )
      .get({ ruleId });
    if (!row) return undefined;
    return stringValue(row, "id");
  }

  bumpCheckVersion(input: {
    readonly checkId: string;
    readonly disputeId: string;
    readonly correctedExpectation: unknown;
    readonly now: number;
  }): { checkId: string; version: number; rev: number } {
    const node = this.readNode(input.checkId);
    if (!node || node.kind !== "check") {
      throw new HintLadderError(`check ${input.checkId} cannot be versioned`);
    }
    const fields = parseJsonObject(node.fields);
    const nextFields: Record<string, unknown> = {
      ...fields,
      expectation: input.correctedExpectation,
    };
    const contentHash = localNodeContentHash({
      kind: node.kind,
      title: node.title,
      text: node.text,
      fields: nextFields,
    });
    const rev = this.nextRev();
    const changeSetId = `CS-${input.disputeId}`;
    this.db
      .prepare(
        `INSERT INTO change_sets(id, rev, origin, author, created_at, summary)
         VALUES (:id, :rev, 'kernel', 'task-author', :now, :summary)`,
      )
      .run({
        id: changeSetId,
        rev,
        now: input.now,
        summary: `dispute upheld ${input.checkId}`,
      });
    const version = node.version + 1;
    this.expectChanges(
      this.db
        .prepare(
          `UPDATE nodes
              SET version = :version,
                  content_hash = :content_hash,
                  fields = :fields,
                  change_set = :change_set,
                  updated_rev = :updated_rev
            WHERE id = :id AND version = :previous_version`,
        )
        .run({
          id: node.id,
          version,
          previous_version: node.version,
          content_hash: contentHash,
          fields: JSON.stringify(nextFields),
          change_set: changeSetId,
          updated_rev: rev,
        }),
      `check version for ${node.id}`,
    );
    this.db
      .prepare(
        `INSERT INTO node_changes(change_set, id, old_version, new_version, class)
         VALUES (:change_set, :id, :old_version, :new_version, 'breaking')`,
      )
      .run({
        change_set: changeSetId,
        id: node.id,
        old_version: node.version,
        new_version: version,
      });
    return { checkId: node.id, version, rev };
  }

  insertInbox(input: {
    readonly id: string;
    readonly taskId: string;
    readonly payload: unknown;
    readonly now: number;
  }): void {
    this.db
      .prepare(
        `INSERT INTO inbox_items(
           id, kind, subject, owner_role, priority, status, payload, needed_by, created_at, resolved_at
         ) VALUES (
           :id, 'conflict', :subject, 'task-author', 1, 'open', :payload, NULL, :now, NULL
         )`,
      )
      .run({
        id: input.id,
        subject: input.taskId,
        payload: JSON.stringify(input.payload),
        now: input.now,
      });
    this.db
      .prepare(`INSERT INTO inbox_subscribers(item, task) VALUES (:item, :task)`)
      .run({ item: input.id, task: input.taskId });
  }

  readDispute(disputeId: string): TestDisputeRecord {
    const row = this.db
      .prepare(`SELECT payload, status FROM inbox_items WHERE id = :id`)
      .get({ id: disputeId });
    if (!row) throw new HintLadderError(`dispute ${disputeId} does not exist`);
    if (stringValue(row, "status") !== "open") {
      throw new HintLadderError(`dispute ${disputeId} is already resolved`);
    }
    return parseDisputeRecord(stringValue(row, "payload"));
  }

  writeDispute(record: TestDisputeRecord): void {
    this.expectChanges(
      this.db
        .prepare(
          `UPDATE inbox_items
              SET status = :status, payload = :payload, resolved_at = :resolved_at
            WHERE id = :id`,
        )
        .run({
          id: record.disputeId,
          status: record.status === "open" ? "open" : "answered",
          payload: JSON.stringify(record),
          resolved_at: record.resolvedAt,
        }),
      `dispute ${record.disputeId}`,
    );
  }

  readHistory(taskId: string): LadderHistoryEntry[] {
    const rows = this.db
      .prepare(
        `SELECT payload FROM outbox
          WHERE type = 'HintLadderAdvanced' AND subject = :task
          ORDER BY seq ASC`,
      )
      .all({ task: taskId });
    return rows.map((row) => parseHistoryEntry(stringValue(row, "payload")));
  }

  private nextRev(): number {
    const row = this.db.prepare(`SELECT COALESCE(MAX(rev), 0) AS rev FROM change_sets`).get();
    if (!row) return 1;
    return numberValue(row, "rev") + 1;
  }

  private expectChanges(result: { changes: number }, label: string): void {
    if (result.changes !== 1) {
      throw new HintLadderError(`${label} updated ${result.changes} rows`);
    }
  }
}

function parseHistoryEntry(payload: string): LadderHistoryEntry {
  const value: unknown = JSON.parse(payload);
  if (typeof value !== "object" || value === null) {
    throw new HintLadderError("hint ladder history payload is not an object");
  }
  const record = value as Record<string, unknown>;
  const level = record.level;
  if (typeof level !== "string") throw new HintLadderError("history level is missing");
  return {
    taskId: requiredText(record, "taskId"),
    attemptId: requiredText(record, "attemptId"),
    model: requiredText(record, "model"),
    level: parseModelLevel(level),
    ruleId: requiredText(record, "ruleId"),
    checkId: requiredText(record, "checkId"),
    failureType: requiredFailure(record.failureType),
    fingerprint: requiredText(record, "fingerprint"),
    ladderStep: requiredNumber(record, "ladderStep"),
    briefVersion: requiredNumber(record, "briefVersion"),
    at: requiredNumber(record, "at"),
  };
}

function parseDisputeRecord(payload: string): TestDisputeRecord {
  const value: unknown = JSON.parse(payload);
  if (typeof value !== "object" || value === null) {
    throw new HintLadderError("dispute payload is not an object");
  }
  const record = value as Record<string, unknown>;
  const status = record.status;
  if (status !== "open" && status !== "upheld" && status !== "rejected") {
    throw new HintLadderError("dispute status is invalid");
  }
  const citedCheckId = record.citedCheckId;
  if (citedCheckId !== null && typeof citedCheckId !== "string") {
    throw new HintLadderError("dispute check id is invalid");
  }
  const authorQuote = record.authorQuote;
  if (authorQuote !== null && typeof authorQuote !== "string") {
    throw new HintLadderError("dispute author quote is invalid");
  }
  const resolvedAt = record.resolvedAt;
  if (resolvedAt !== null && typeof resolvedAt !== "number") {
    throw new HintLadderError("dispute resolved time is invalid");
  }
  if (record.penalized !== false || record.routedTo !== "ask-owner-responder@1") {
    throw new HintLadderError("dispute routing flags are invalid");
  }
  return {
    disputeId: requiredText(record, "disputeId"),
    taskId: requiredText(record, "taskId"),
    attemptId: requiredText(record, "attemptId"),
    citedRuleId: requiredText(record, "citedRuleId"),
    citedCheckId,
    counterexample: record.counterexample,
    ruleText: requiredText(record, "ruleText"),
    status,
    authorQuote,
    pausedAttemptState: requiredText(record, "pausedAttemptState"),
    penalized: false,
    routedTo: "ask-owner-responder@1",
    createdAt: requiredNumber(record, "createdAt"),
    resolvedAt,
  };
}

function requiredText(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new HintLadderError(`history field ${key} is missing`);
  }
  return value;
}

function requiredNumber(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new HintLadderError(`history field ${key} is missing`);
  }
  return value;
}

function requiredFailure(value: unknown): LadderHistoryEntry["failureType"] {
  if (
    value === "wrong_value" ||
    value === "missing_item" ||
    value === "extra_item" ||
    value === "wrong_order" ||
    value === "exception" ||
    value === "timeout"
  ) {
    return value;
  }
  throw new HintLadderError("history failure type is invalid");
}
