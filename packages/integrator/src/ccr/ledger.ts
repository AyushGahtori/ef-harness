import { type DatabaseSync, type SQLOutputValue } from "node:sqlite";
import { openSharedStateFile } from "../shared-state.js";

import { isoTime } from "./clock.js";
import { CcrError } from "./errors.js";
import type {
  AuditEvent,
  CcrLifecycle,
  CcrV1,
  ContractChangeDecisionCard,
  DiffOp,
  OwnerTask,
  StoredCcr,
  Urgency,
  WaitEdge,
} from "./types.js";

export const CCR_DDL = `
CREATE TABLE IF NOT EXISTS ccr_requests (
  id TEXT PRIMARY KEY,
  target_contract_node_id TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  requesting_task_id TEXT NOT NULL,
  requesting_feature_id TEXT NOT NULL,
  lifecycle TEXT NOT NULL,
  queue_state TEXT NOT NULL,
  classification TEXT NOT NULL,
  overridden INTEGER NOT NULL,
  claimed_class TEXT,
  rationale TEXT NOT NULL,
  urgency TEXT NOT NULL,
  owner_task_id TEXT,
  owner_role TEXT NOT NULL,
  owner_commit_sha TEXT,
  woken_task_ids TEXT NOT NULL,
  subscriber_task_ids TEXT NOT NULL,
  ccr_v1 TEXT NOT NULL,
  migration_name TEXT,
  schema_diff TEXT NOT NULL,
  decision_json TEXT,
  owner_task_json TEXT,
  semantic_breaking INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ccr_audit_ledger (
  event_id INTEGER PRIMARY KEY AUTOINCREMENT,
  ccr_id TEXT NOT NULL,
  lifecycle TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ccr_wait_edges (
  from_task_id TEXT NOT NULL,
  to_task_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  ccr_id TEXT,
  PRIMARY KEY (from_task_id, to_task_id, kind)
);
CREATE TABLE IF NOT EXISTS ccr_notices (
  notice_id INTEGER PRIMARY KEY AUTOINCREMENT,
  target_role TEXT NOT NULL,
  reason TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ccr_id_sequences (
  name TEXT PRIMARY KEY,
  value INTEGER NOT NULL
);
`;

const LIFECYCLE_RANK: Readonly<Record<CcrLifecycle, number>> = {
  PROPOSED: 0,
  CLASSIFIED: 1,
  APPROVED: 2,
  REJECTED: 2,
  LANDED: 3,
};

export interface CcrDraft {
  readonly id: string;
  readonly targetContractNodeId: string;
  readonly fingerprint: string;
  readonly requestingTaskId: string;
  readonly requestingFeatureId: string;
  readonly claimedClass: string | null;
  readonly rationale: string;
  readonly urgency: Urgency;
  readonly ownerRole: string;
  readonly ccrV1: CcrV1;
  readonly schemaDiff: readonly DiffOp[];
  readonly semanticBreaking: boolean;
  readonly classification: "ADDITIVE" | "BREAKING";
  readonly overridden: boolean;
}

export interface NoticeRecord {
  readonly noticeId: number;
  readonly targetRole: string;
  readonly reason: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly createdAt: string;
}

export class CcrLedger {
  private depth = 0;
  private closed = false;

  constructor(private readonly db: DatabaseSync) {
    this.db.exec("PRAGMA foreign_keys = ON");
    this.db.exec(CCR_DDL);
  }

  static open(path = ":memory:"): CcrLedger {
    return new CcrLedger(openSharedStateFile(path));
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
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  nextId(prefix: string): string {
    const row = this.db.prepare("SELECT value FROM ccr_id_sequences WHERE name = ?").get(prefix);
    const current = row ? integer(row.value, "sequence") : 0;
    const next = current + 1;
    this.db.prepare("INSERT INTO ccr_id_sequences (name, value) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET value = excluded.value").run(prefix, next);
    return `${prefix}${next}`;
  }

  countOriginated(taskId: string): number {
    const row = this.db.prepare("SELECT COUNT(*) AS n FROM ccr_requests WHERE requesting_task_id = ?").get(taskId);
    return row ? integer(row.n, "count") : 0;
  }

  findActiveByFingerprint(fingerprint: string): StoredCcr | null {
    const row = this.db
      .prepare("SELECT * FROM ccr_requests WHERE fingerprint = ? AND lifecycle != 'REJECTED' ORDER BY id LIMIT 1")
      .get(fingerprint);
    return row ? this.readRow(row) : null;
  }

  get(id: string): StoredCcr | null {
    const row = this.db.prepare("SELECT * FROM ccr_requests WHERE id = ?").get(id);
    return row ? this.readRow(row) : null;
  }

  insertProposed(draft: CcrDraft, at: string): void {
    this.db
      .prepare(
        `INSERT INTO ccr_requests (
          id, target_contract_node_id, fingerprint, requesting_task_id, requesting_feature_id,
          lifecycle, queue_state, classification, overridden, claimed_class, rationale, urgency,
          owner_task_id, owner_role, owner_commit_sha, woken_task_ids, subscriber_task_ids,
          ccr_v1, migration_name, schema_diff, decision_json, owner_task_json, semantic_breaking,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 'PROPOSED', 'proposed', ?, ?, ?, ?, ?, NULL, ?, NULL, '[]', ?, ?, NULL, ?, NULL, NULL, ?, ?, ?)`,
      )
      .run(
        draft.id,
        draft.targetContractNodeId,
        draft.fingerprint,
        draft.requestingTaskId,
        draft.requestingFeatureId,
        draft.classification,
        draft.overridden ? 1 : 0,
        draft.claimedClass,
        draft.rationale,
        draft.urgency,
        draft.ownerRole,
        JSON.stringify([draft.requestingTaskId]),
        JSON.stringify(draft.ccrV1),
        JSON.stringify(draft.schemaDiff),
        draft.semanticBreaking ? 1 : 0,
        at,
        at,
      );
    this.appendAudit(draft.id, "PROPOSED", { fingerprint: draft.fingerprint, claimedClass: draft.claimedClass }, at);
  }

  transition(
    id: string,
    lifecycle: CcrLifecycle,
    patch: {
      readonly queueState?: string;
      readonly ownerTaskId?: string | null;
      readonly ownerRole?: string;
      readonly ownerCommitSha?: string | null;
      readonly wokenTaskIds?: readonly string[];
      readonly subscriberTaskIds?: readonly string[];
      readonly ccrV1?: CcrV1;
      readonly migrationName?: string | null;
      readonly decision?: ContractChangeDecisionCard | null;
      readonly ownerTask?: OwnerTask | null;
      readonly classification?: "ADDITIVE" | "BREAKING";
      readonly overridden?: boolean;
      readonly semanticBreaking?: boolean;
    },
    payload: Readonly<Record<string, unknown>>,
    at: string,
  ): StoredCcr {
    const current = this.get(id);
    if (!current) throw new CcrError("ccr_missing", `CCR ${id} does not exist`);
    if (LIFECYCLE_RANK[lifecycle] < LIFECYCLE_RANK[current.lifecycle]) {
      throw new CcrError("ccr_state", `CCR ${id} cannot move from ${current.lifecycle} to ${lifecycle}`);
    }
    if (current.lifecycle === "REJECTED" || current.lifecycle === "LANDED") {
      throw new CcrError("ccr_state", `CCR ${id} is immutable once ${current.lifecycle}`);
    }
    if (current.lifecycle === "APPROVED" && lifecycle === "REJECTED") {
      throw new CcrError("ccr_state", `CCR ${id} cannot be rejected after approval`);
    }
    if (lifecycle === "LANDED" && current.lifecycle !== "APPROVED") {
      throw new CcrError("ccr_state", `CCR ${id} must be APPROVED before LANDED`);
    }
    this.db
      .prepare(
        `UPDATE ccr_requests SET
          lifecycle = ?, queue_state = ?, classification = ?, overridden = ?, owner_task_id = ?,
          owner_role = ?, owner_commit_sha = ?, woken_task_ids = ?, subscriber_task_ids = ?,
          ccr_v1 = ?, migration_name = ?, decision_json = ?, owner_task_json = ?,
          semantic_breaking = ?, updated_at = ?
        WHERE id = ?`,
      )
      .run(
        lifecycle,
        patch.queueState ?? current.queueState,
        patch.classification ?? current.classification,
        (patch.overridden ?? current.overridden) ? 1 : 0,
        patch.ownerTaskId === undefined ? current.ownerTaskId : patch.ownerTaskId,
        patch.ownerRole ?? current.ownerRole,
        patch.ownerCommitSha === undefined ? current.ownerCommitSha : patch.ownerCommitSha,
        JSON.stringify(patch.wokenTaskIds ?? current.wokenTaskIds),
        JSON.stringify(patch.subscriberTaskIds ?? current.subscriberTaskIds),
        JSON.stringify(patch.ccrV1 ?? current.ccrV1),
        patch.migrationName === undefined ? current.migrationName : patch.migrationName,
        JSON.stringify(patch.decision === undefined ? current.decision : patch.decision),
        JSON.stringify(patch.ownerTask === undefined ? current.ownerTask : patch.ownerTask),
        (patch.semanticBreaking ?? current.semanticBreaking) ? 1 : 0,
        at,
        id,
      );
    this.appendAudit(id, lifecycle, payload, at);
    const updated = this.get(id);
    if (!updated) throw new CcrError("ccr_missing", `CCR ${id} disappeared`);
    return updated;
  }

  recordWake(id: string, taskIds: readonly string[], at: string): StoredCcr {
    const current = this.get(id);
    if (!current) throw new CcrError("ccr_missing", `CCR ${id} does not exist`);
    const wokenTaskIds = [...new Set([...current.wokenTaskIds, ...taskIds])];
    this.db.prepare("UPDATE ccr_requests SET woken_task_ids = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(wokenTaskIds), at, id);
    this.appendAudit(id, current.lifecycle, { deduped: true, wokenTaskIds: taskIds }, at);
    return this.get(id) ?? current;
  }

  addSubscriber(id: string, taskId: string, at: string): StoredCcr {
    const current = this.get(id);
    if (!current) throw new CcrError("ccr_missing", `CCR ${id} does not exist`);
    if (current.subscriberTaskIds.includes(taskId)) return current;
    const subscriberTaskIds = [...current.subscriberTaskIds, taskId];
    this.db.prepare("UPDATE ccr_requests SET subscriber_task_ids = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(subscriberTaskIds), at, id);
    return this.get(id) ?? current;
  }

  audit(ccrId: string): readonly AuditEvent[] {
    const rows = this.db.prepare("SELECT * FROM ccr_audit_ledger WHERE ccr_id = ? ORDER BY event_id").all(ccrId);
    return rows.map((row) => ({
      eventId: integer(row.event_id, "event_id"),
      ccrId: text(row.ccr_id, "ccr_id"),
      lifecycle: text(row.lifecycle, "lifecycle") as CcrLifecycle,
      payload: parseObject(text(row.payload, "payload")),
      createdAt: text(row.created_at, "created_at"),
    }));
  }

  notice(targetRole: string, reason: string, payload: Readonly<Record<string, unknown>>, at: string): void {
    this.db
      .prepare("INSERT INTO ccr_notices (target_role, reason, payload, created_at) VALUES (?, ?, ?, ?)")
      .run(targetRole, reason, JSON.stringify(payload), at);
  }

  notices(): readonly NoticeRecord[] {
    return this.db.prepare("SELECT * FROM ccr_notices ORDER BY notice_id").all().map((row) => ({
      noticeId: integer(row.notice_id, "notice_id"),
      targetRole: text(row.target_role, "target_role"),
      reason: text(row.reason, "reason"),
      payload: parseObject(text(row.payload, "payload")),
      createdAt: text(row.created_at, "created_at"),
    }));
  }

  listEdges(): readonly WaitEdge[] {
    return this.db.prepare("SELECT * FROM ccr_wait_edges ORDER BY from_task_id, to_task_id").all().map((row) => ({
      fromTaskId: text(row.from_task_id, "from_task_id"),
      toTaskId: text(row.to_task_id, "to_task_id"),
      kind: text(row.kind, "kind") === "depends_on" ? "depends_on" : "waits_on",
      ...(row.ccr_id === null || row.ccr_id === undefined ? {} : { ccrId: text(row.ccr_id, "ccr_id") }),
    }));
  }

  insertEdge(edge: WaitEdge): void {
    this.db
      .prepare("INSERT OR IGNORE INTO ccr_wait_edges (from_task_id, to_task_id, kind, ccr_id) VALUES (?, ?, ?, ?)")
      .run(edge.fromTaskId, edge.toTaskId, edge.kind, edge.ccrId ?? null);
  }

  removeEdgesForCcr(ccrId: string): void {
    this.db.prepare("DELETE FROM ccr_wait_edges WHERE ccr_id = ?").run(ccrId);
  }

  waiting(): readonly StoredCcr[] {
    return this.db
      .prepare("SELECT * FROM ccr_requests WHERE queue_state = 'waiting_on_ccr' ORDER BY id")
      .all()
      .map((row) => this.readRow(row));
  }

  private appendAudit(ccrId: string, lifecycle: CcrLifecycle, payload: Readonly<Record<string, unknown>>, at: string): void {
    this.db
      .prepare("INSERT INTO ccr_audit_ledger (ccr_id, lifecycle, payload, created_at) VALUES (?, ?, ?, ?)")
      .run(ccrId, lifecycle, JSON.stringify(payload), at);
  }

  private readRow(row: Record<string, SQLOutputValue>): StoredCcr {
    const decisionText = textOrNull(row.decision_json, "decision_json");
    const ownerText = textOrNull(row.owner_task_json, "owner_task_json");
    return {
      id: text(row.id, "id"),
      targetContractNodeId: text(row.target_contract_node_id, "target"),
      fingerprint: text(row.fingerprint, "fingerprint"),
      requestingTaskId: text(row.requesting_task_id, "requesting_task_id"),
      requestingFeatureId: text(row.requesting_feature_id, "requesting_feature_id"),
      lifecycle: text(row.lifecycle, "lifecycle") as CcrLifecycle,
      queueState: text(row.queue_state, "queue_state"),
      classification: text(row.classification, "classification") === "BREAKING" ? "BREAKING" : "ADDITIVE",
      overridden: integer(row.overridden, "overridden") === 1,
      claimedClass: textOrNull(row.claimed_class, "claimed_class"),
      rationale: text(row.rationale, "rationale"),
      urgency: text(row.urgency, "urgency") as Urgency,
      ownerTaskId: textOrNull(row.owner_task_id, "owner_task_id"),
      ownerRole: text(row.owner_role, "owner_role"),
      ownerCommitSha: textOrNull(row.owner_commit_sha, "owner_commit_sha"),
      wokenTaskIds: parseStringList(text(row.woken_task_ids, "woken")),
      subscriberTaskIds: parseStringList(text(row.subscriber_task_ids, "subscribers")),
      ccrV1: JSON.parse(text(row.ccr_v1, "ccr_v1")) as CcrV1,
      migrationName: textOrNull(row.migration_name, "migration_name"),
      schemaDiff: JSON.parse(text(row.schema_diff, "schema_diff")) as DiffOp[],
      decision: decisionText ? (JSON.parse(decisionText) as ContractChangeDecisionCard) : null,
      ownerTask: ownerText ? (JSON.parse(ownerText) as OwnerTask) : null,
      semanticBreaking: integer(row.semantic_breaking, "semantic_breaking") === 1,
    };
  }
}

export function stamp(now: () => Date): string {
  return isoTime(now());
}

function text(value: SQLOutputValue | undefined, label: string): string {
  if (typeof value !== "string") throw new CcrError("ccr_state", `${label} is not text`);
  return value;
}

function textOrNull(value: SQLOutputValue | undefined, label: string): string | null {
  if (value === null || value === undefined) return null;
  return text(value, label);
}

function integer(value: SQLOutputValue | undefined, label: string): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "bigint") return Number(value);
  throw new CcrError("ccr_state", `${label} is not an integer`);
}

function parseStringList(value: string): string[] {
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string")) {
    throw new CcrError("ccr_state", "expected a string list");
  }
  return parsed;
}

function parseObject(value: string): Readonly<Record<string, unknown>> {
  const parsed: unknown = JSON.parse(value);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new CcrError("ccr_state", "expected an object payload");
  }
  const record: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(parsed)) record[key] = entry;
  return record;
}
