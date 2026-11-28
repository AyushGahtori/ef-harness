import { DatabaseSync, type SQLOutputValue } from "node:sqlite";
import type { ArtifactType, MailboxKind } from "./constants.js";
import { HANDOFF_DDL } from "./ddl.js";
import { CasIntegrityError } from "./errors.js";
import { canonicalJson, parseJsonObject, parseJsonValue, sha256Hex, type JsonObject, type JsonValue } from "./json.js";
import type {
  ActiveAttempt,
  ContractOwner,
  EscalationNotice,
  EscalationTarget,
  GraphEdge,
  HandoffArtifact,
  HandoffWake,
  MailboxMessage,
  MailboxWake,
  WaitGraphDeadlockBreak,
} from "./types.js";

function text(value: SQLOutputValue | undefined, label: string): string {
  if (typeof value !== "string") throw new Error(`${label} is not text`);
  return value;
}

function textOrNull(value: SQLOutputValue | undefined, label: string): string | null {
  if (value === null || value === undefined) return null;
  return text(value, label);
}

function integer(value: SQLOutputValue | undefined, label: string): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "bigint") return Number(value);
  throw new Error(`${label} is not an integer`);
}

function integerOrNull(value: SQLOutputValue | undefined, label: string): number | null {
  if (value === null || value === undefined) return null;
  return integer(value, label);
}

function blobBytes(value: SQLOutputValue | undefined, label: string): Uint8Array {
  if (value instanceof Uint8Array) return new Uint8Array(value);
  throw new Error(`${label} is not a blob`);
}

export class HandoffDatabase {
  private depth = 0;
  private closed = false;

  constructor(private readonly db: DatabaseSync) {
    this.db.exec("PRAGMA foreign_keys = ON");
    this.db.exec(HANDOFF_DDL);
  }

  static open(path: string): HandoffDatabase {
    return new HandoffDatabase(new DatabaseSync(path));
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

  nextId(prefix: string): string {
    const row = this.db.prepare("SELECT next FROM id_sequences WHERE name = ?").get(prefix);
    const next = row ? integer(row["next"], "next") : 1;
    if (row) {
      this.db.prepare("UPDATE id_sequences SET next = ? WHERE name = ?").run(next + 1, prefix);
    } else {
      this.db.prepare("INSERT INTO id_sequences(name, next) VALUES (?, ?)").run(prefix, next + 1);
    }
    return `${prefix}${next}`;
  }

  saveBlob(content: Uint8Array, createdAt: number): { hash: string; bytes: number } {
    const hash = sha256Hex(content);
    const existing = this.db.prepare("SELECT content FROM cas_blobs WHERE sha256 = ?").get(hash);
    if (existing) {
      const stored = blobBytes(existing["content"], "content");
      if (sha256Hex(stored) !== hash || stored.byteLength !== content.byteLength) {
        throw new CasIntegrityError(hash);
      }
      return { hash, bytes: content.byteLength };
    }
    this.db
      .prepare("INSERT INTO cas_blobs(sha256, bytes, content, created_at) VALUES (?, ?, ?, ?)")
      .run(hash, content.byteLength, content, createdAt);
    return { hash, bytes: content.byteLength };
  }

  readBlob(hash: string): Uint8Array | null {
    const row = this.db.prepare("SELECT content FROM cas_blobs WHERE sha256 = ?").get(hash);
    if (!row) return null;
    const stored = blobBytes(row["content"], "content");
    if (sha256Hex(stored) !== hash) throw new CasIntegrityError(hash);
    return stored;
  }

  hasBlob(hash: string): boolean {
    const row = this.db.prepare("SELECT 1 AS present FROM cas_blobs WHERE sha256 = ?").get(hash);
    return row !== undefined;
  }

  insertArtifact(artifact: HandoffArtifact): void {
    this.db
      .prepare(
        `INSERT INTO handoff_artifacts(
           handoff_id, from_role, to_role, from_task_id, to_task_id, artifact_type,
           pinned_base_commit_sha, pinned_slice_sha256, schema_version, summary_json,
           blob_sha256, blob_bytes, prior_handoff_id, supersedes, superseded_by, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        artifact.handoffId,
        artifact.fromRole,
        artifact.toRole,
        artifact.fromTaskId,
        artifact.toTaskId,
        artifact.artifactType,
        artifact.pinnedBaseCommitSha,
        artifact.pinnedSliceSha256,
        artifact.schemaVersion,
        canonicalJson(artifact.summary),
        artifact.blobSha256,
        artifact.blobBytes,
        artifact.priorHandoffId,
        artifact.supersedes,
        artifact.supersededBy,
        artifact.createdAt,
      );
  }

  stampSupersededBy(handoffId: string, successorId: string): void {
    const result = this.db
      .prepare(
        "UPDATE handoff_artifacts SET superseded_by = ? WHERE handoff_id = ? AND superseded_by IS NULL",
      )
      .run(successorId, handoffId);
    if (Number(result.changes) !== 1) {
      throw new Error(`Handoff ${handoffId} could not be stamped superseded_by ${successorId}.`);
    }
  }

  getArtifact(handoffId: string): HandoffArtifact | null {
    const row = this.db.prepare("SELECT * FROM handoff_artifacts WHERE handoff_id = ?").get(handoffId);
    return row ? mapArtifact(row) : null;
  }

  listArtifacts(): HandoffArtifact[] {
    return this.db
      .prepare("SELECT * FROM handoff_artifacts ORDER BY created_at, handoff_id")
      .all()
      .map((row) => mapArtifact(row));
  }

  insertAttempt(attempt: ActiveAttempt): void {
    this.db
      .prepare(
        `INSERT INTO active_attempts(
           attempt_id, task_id, role, worker_id, pinned_base_commit_sha,
           pinned_slice_sha256, bound_handoff_id, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        attempt.attemptId,
        attempt.taskId,
        attempt.role,
        attempt.workerId,
        attempt.pinnedBaseCommitSha,
        attempt.pinnedSliceSha256,
        attempt.boundHandoffId,
        attempt.createdAt,
      );
  }

  getAttempt(attemptId: string): ActiveAttempt | null {
    const row = this.db.prepare("SELECT * FROM active_attempts WHERE attempt_id = ?").get(attemptId);
    if (!row) return null;
    return {
      attemptId: text(row["attempt_id"], "attempt_id"),
      taskId: text(row["task_id"], "task_id"),
      role: text(row["role"], "role"),
      workerId: text(row["worker_id"], "worker_id"),
      pinnedBaseCommitSha: text(row["pinned_base_commit_sha"], "pinned_base_commit_sha"),
      pinnedSliceSha256: text(row["pinned_slice_sha256"], "pinned_slice_sha256"),
      boundHandoffId: text(row["bound_handoff_id"], "bound_handoff_id"),
      createdAt: integer(row["created_at"], "created_at"),
    };
  }

  insertEdge(kind: GraphEdge["kind"], fromNode: string, toNode: string, createdAt: number): boolean {
    const result = this.db
      .prepare(
        "INSERT OR IGNORE INTO graph_edges(kind, from_node, to_node, created_at) VALUES (?, ?, ?, ?)",
      )
      .run(kind, fromNode, toNode, createdAt);
    return Number(result.changes) === 1;
  }

  hasEdge(kind: GraphEdge["kind"], fromNode: string, toNode: string): boolean {
    const row = this.db
      .prepare("SELECT 1 AS present FROM graph_edges WHERE kind = ? AND from_node = ? AND to_node = ?")
      .get(kind, fromNode, toNode);
    return row !== undefined;
  }

  listEdges(): GraphEdge[] {
    return this.db
      .prepare("SELECT kind, from_node, to_node FROM graph_edges ORDER BY kind, from_node, to_node")
      .all()
      .map((row) => ({
        kind: text(row["kind"], "kind") === "depends_on" ? "depends_on" : "waits_on",
        fromNode: text(row["from_node"], "from_node"),
        toNode: text(row["to_node"], "to_node"),
      }));
  }

  deleteEdge(kind: GraphEdge["kind"], fromNode: string, toNode: string): void {
    this.db
      .prepare("DELETE FROM graph_edges WHERE kind = ? AND from_node = ? AND to_node = ?")
      .run(kind, fromNode, toNode);
  }

  insertOwner(owner: ContractOwner, createdAt: number): void {
    this.db
      .prepare(
        "INSERT INTO contract_owners(contract_id, owner_role, owner_task_id, created_at) VALUES (?, ?, ?, ?)",
      )
      .run(owner.contractId, owner.ownerRole, owner.ownerTaskId, createdAt);
  }

  getOwner(contractId: string): ContractOwner | null {
    const row = this.db.prepare("SELECT * FROM contract_owners WHERE contract_id = ?").get(contractId);
    if (!row) return null;
    return {
      contractId: text(row["contract_id"], "contract_id"),
      ownerRole: text(row["owner_role"], "owner_role"),
      ownerTaskId: text(row["owner_task_id"], "owner_task_id"),
    };
  }

  insertMailbox(message: MailboxMessage, dedupKey: string): void {
    this.db
      .prepare(
        `INSERT INTO role_mailbox(
           mailbox_id, kind, target_role, target_owner_task_id, contract_id, question_hash,
           payload_json, status, resolution_json, created_at, resolved_at, escalated_to, owner_turns, dedup_key
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        message.mailboxId,
        message.kind,
        message.targetRole,
        message.targetOwnerTaskId,
        message.contractId,
        message.questionHash,
        canonicalJson(message.payload),
        message.status,
        message.resolution === null ? null : canonicalJson(message.resolution),
        message.createdAt,
        message.resolvedAt,
        message.escalatedTo,
        message.ownerTurns,
        dedupKey,
      );
  }

  findOpenByDedup(dedupKey: string): MailboxMessage | null {
    const row = this.db
      .prepare("SELECT * FROM role_mailbox WHERE dedup_key = ? AND status = 'open'")
      .get(dedupKey);
    return row ? this.mapMailbox(row) : null;
  }

  getMailbox(mailboxId: string): MailboxMessage | null {
    const row = this.db.prepare("SELECT * FROM role_mailbox WHERE mailbox_id = ?").get(mailboxId);
    return row ? this.mapMailbox(row) : null;
  }

  listMailboxByRole(targetRole: string, status: MailboxMessage["status"] | null): MailboxMessage[] {
    const rows =
      status === null
        ? this.db
            .prepare("SELECT * FROM role_mailbox WHERE target_role = ? ORDER BY created_at, mailbox_id")
            .all(targetRole)
        : this.db
            .prepare(
              "SELECT * FROM role_mailbox WHERE target_role = ? AND status = ? ORDER BY created_at, mailbox_id",
            )
            .all(targetRole, status);
    return rows.map((row) => this.mapMailbox(row));
  }

  listOpenMailboxes(): MailboxMessage[] {
    return this.db
      .prepare("SELECT * FROM role_mailbox WHERE status = 'open' ORDER BY created_at, mailbox_id")
      .all()
      .map((row) => this.mapMailbox(row));
  }

  addWaiter(mailboxId: string, waiterTaskId: string, createdAt: number): boolean {
    const result = this.db
      .prepare(
        "INSERT OR IGNORE INTO mailbox_waiters(mailbox_id, waiter_task_id, created_at) VALUES (?, ?, ?)",
      )
      .run(mailboxId, waiterTaskId, createdAt);
    return Number(result.changes) === 1;
  }

  listWaiters(mailboxId: string): string[] {
    return this.db
      .prepare(
        "SELECT waiter_task_id FROM mailbox_waiters WHERE mailbox_id = ? ORDER BY created_at, waiter_task_id",
      )
      .all(mailboxId)
      .map((row) => text(row["waiter_task_id"], "waiter_task_id"));
  }

  markResolved(mailboxId: string, resolution: JsonObject, resolvedAt: number): void {
    this.db
      .prepare(
        `UPDATE role_mailbox
         SET status = 'resolved', resolution_json = ?, resolved_at = ?
         WHERE mailbox_id = ? AND status = 'open'`,
      )
      .run(canonicalJson(resolution), resolvedAt, mailboxId);
  }

  markEscalated(mailboxId: string, escalatedTo: string, resolvedAt: number): void {
    this.db
      .prepare(
        `UPDATE role_mailbox
         SET status = 'escalated', escalated_to = ?, resolved_at = ?
         WHERE mailbox_id = ? AND status = 'open'`,
      )
      .run(escalatedTo, resolvedAt, mailboxId);
  }

  incrementOwnerTurns(ownerTaskId: string): void {
    this.db
      .prepare(
        "UPDATE role_mailbox SET owner_turns = owner_turns + 1 WHERE target_owner_task_id = ? AND status = 'open'",
      )
      .run(ownerTaskId);
  }

  insertMailboxWake(wake: MailboxWake): void {
    this.db
      .prepare(
        "INSERT INTO mailbox_wakes(wake_id, mailbox_id, waiter_task_id, resolution_json, created_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run(wake.wakeId, wake.mailboxId, wake.waiterTaskId, canonicalJson(wake.resolution), wake.createdAt);
  }

  listMailboxWakes(waiterTaskId: string | null): MailboxWake[] {
    const rows =
      waiterTaskId === null
        ? this.db.prepare("SELECT * FROM mailbox_wakes ORDER BY created_at, wake_id").all()
        : this.db
            .prepare("SELECT * FROM mailbox_wakes WHERE waiter_task_id = ? ORDER BY created_at, wake_id")
            .all(waiterTaskId);
    return rows.map((row) => ({
      wakeId: text(row["wake_id"], "wake_id"),
      mailboxId: text(row["mailbox_id"], "mailbox_id"),
      waiterTaskId: text(row["waiter_task_id"], "waiter_task_id"),
      resolution: parseJsonObject(text(row["resolution_json"], "resolution_json")),
      createdAt: integer(row["created_at"], "created_at"),
    }));
  }

  watchHandoff(handoffId: string, taskId: string, createdAt: number): void {
    this.db
      .prepare("INSERT OR IGNORE INTO handoff_watches(handoff_id, task_id, created_at) VALUES (?, ?, ?)")
      .run(handoffId, taskId, createdAt);
  }

  listWatchers(handoffId: string): string[] {
    return this.db
      .prepare("SELECT task_id FROM handoff_watches WHERE handoff_id = ? ORDER BY task_id")
      .all(handoffId)
      .map((row) => text(row["task_id"], "task_id"));
  }

  insertHandoffWake(wake: HandoffWake): void {
    this.db
      .prepare(
        `INSERT INTO handoff_wakes(
           wake_id, task_id, previous_handoff_id, fresh_handoff_id, fresh_base_sha, fresh_slice_sha, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        wake.wakeId,
        wake.taskId,
        wake.previousHandoffId,
        wake.freshHandoffId,
        wake.freshPinnedBaseCommitSha,
        wake.freshPinnedSliceSha256,
        wake.createdAt,
      );
  }

  listHandoffWakes(taskId: string | null): HandoffWake[] {
    const rows =
      taskId === null
        ? this.db.prepare("SELECT * FROM handoff_wakes ORDER BY created_at, wake_id").all()
        : this.db
            .prepare("SELECT * FROM handoff_wakes WHERE task_id = ? ORDER BY created_at, wake_id")
            .all(taskId);
    return rows.map((row) => ({
      wakeId: text(row["wake_id"], "wake_id"),
      taskId: text(row["task_id"], "task_id"),
      previousHandoffId: text(row["previous_handoff_id"], "previous_handoff_id"),
      freshHandoffId: text(row["fresh_handoff_id"], "fresh_handoff_id"),
      freshPinnedBaseCommitSha: text(row["fresh_base_sha"], "fresh_base_sha"),
      freshPinnedSliceSha256: text(row["fresh_slice_sha"], "fresh_slice_sha"),
      createdAt: integer(row["created_at"], "created_at"),
    }));
  }

  insertBreak(record: WaitGraphDeadlockBreak): void {
    this.db
      .prepare(
        `INSERT INTO wait_graph_deadlock_breaks(
           break_id, from_node, to_node, cycle_json, escalated_to, notified_roles_json, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.breakId,
        record.fromNode,
        record.toNode,
        canonicalJson([...record.cycle]),
        record.escalatedTo,
        canonicalJson([...record.notifiedRoles]),
        record.createdAt,
      );
  }

  listBreaks(): WaitGraphDeadlockBreak[] {
    return this.db
      .prepare("SELECT * FROM wait_graph_deadlock_breaks ORDER BY created_at, break_id")
      .all()
      .map((row) => {
        const cycle = parseJsonValue(text(row["cycle_json"], "cycle_json"));
        const notified = parseJsonValue(text(row["notified_roles_json"], "notified_roles_json"));
        return {
          breakId: text(row["break_id"], "break_id"),
          fromNode: text(row["from_node"], "from_node"),
          toNode: text(row["to_node"], "to_node"),
          cycle: stringList(cycle, "cycle"),
          escalatedTo: escalationTarget(text(row["escalated_to"], "escalated_to")),
          notifiedRoles: stringList(notified, "notified_roles"),
          createdAt: integer(row["created_at"], "created_at"),
        };
      });
  }

  insertNotice(notice: EscalationNotice): void {
    this.db
      .prepare(
        "INSERT INTO escalation_notices(notice_id, target_role, reason, payload_json, created_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run(notice.noticeId, notice.targetRole, notice.reason, canonicalJson(notice.payload), notice.createdAt);
  }

  listNotices(targetRole: string | null): EscalationNotice[] {
    const rows =
      targetRole === null
        ? this.db.prepare("SELECT * FROM escalation_notices ORDER BY created_at, notice_id").all()
        : this.db
            .prepare("SELECT * FROM escalation_notices WHERE target_role = ? ORDER BY created_at, notice_id")
            .all(targetRole);
    return rows.map((row) => ({
      noticeId: text(row["notice_id"], "notice_id"),
      targetRole: text(row["target_role"], "target_role"),
      reason: text(row["reason"], "reason"),
      payload: parseJsonObject(text(row["payload_json"], "payload_json")),
      createdAt: integer(row["created_at"], "created_at"),
    }));
  }

  insertClaim(claimId: string, targetRole: string, workerId: string, createdAt: number): void {
    this.db
      .prepare("INSERT INTO role_claims(claim_id, target_role, worker_id, created_at) VALUES (?, ?, ?, ?)")
      .run(claimId, targetRole, workerId, createdAt);
  }

  listClaims(targetRole: string): { claimId: string; workerId: string }[] {
    return this.db
      .prepare("SELECT claim_id, worker_id FROM role_claims WHERE target_role = ? ORDER BY created_at, claim_id")
      .all(targetRole)
      .map((row) => ({
        claimId: text(row["claim_id"], "claim_id"),
        workerId: text(row["worker_id"], "worker_id"),
      }));
  }

  private mapMailbox(row: Record<string, SQLOutputValue>): MailboxMessage {
    const resolution = textOrNull(row["resolution_json"], "resolution_json");
    return {
      mailboxId: text(row["mailbox_id"], "mailbox_id"),
      kind: text(row["kind"], "kind") as MailboxKind,
      targetRole: text(row["target_role"], "target_role"),
      targetOwnerTaskId: text(row["target_owner_task_id"], "target_owner_task_id"),
      contractId: text(row["contract_id"], "contract_id"),
      questionHash: text(row["question_hash"], "question_hash"),
      payload: parseJsonObject(text(row["payload_json"], "payload_json")),
      status: mailboxStatus(text(row["status"], "status")),
      resolution: resolution === null ? null : parseJsonObject(resolution),
      createdAt: integer(row["created_at"], "created_at"),
      resolvedAt: integerOrNull(row["resolved_at"], "resolved_at"),
      escalatedTo: textOrNull(row["escalated_to"], "escalated_to"),
      ownerTurns: integer(row["owner_turns"], "owner_turns"),
      waiters: this.listWaiters(text(row["mailbox_id"], "mailbox_id")),
    };
  }
}

function mapArtifact(row: Record<string, SQLOutputValue>): HandoffArtifact {
  return {
    handoffId: text(row["handoff_id"], "handoff_id"),
    fromRole: text(row["from_role"], "from_role"),
    toRole: text(row["to_role"], "to_role"),
    fromTaskId: text(row["from_task_id"], "from_task_id"),
    toTaskId: text(row["to_task_id"], "to_task_id"),
    artifactType: text(row["artifact_type"], "artifact_type") as ArtifactType,
    pinnedBaseCommitSha: text(row["pinned_base_commit_sha"], "pinned_base_commit_sha"),
    pinnedSliceSha256: text(row["pinned_slice_sha256"], "pinned_slice_sha256"),
    schemaVersion: integer(row["schema_version"], "schema_version"),
    summary: parseJsonObject(text(row["summary_json"], "summary_json")),
    blobSha256: text(row["blob_sha256"], "blob_sha256"),
    blobBytes: integer(row["blob_bytes"], "blob_bytes"),
    priorHandoffId: textOrNull(row["prior_handoff_id"], "prior_handoff_id"),
    supersedes: textOrNull(row["supersedes"], "supersedes"),
    supersededBy: textOrNull(row["superseded_by"], "superseded_by"),
    createdAt: integer(row["created_at"], "created_at"),
  };
}

function mailboxStatus(value: string): MailboxMessage["status"] {
  if (value === "open" || value === "resolved" || value === "escalated") return value;
  throw new Error(`unexpected mailbox status ${value}`);
}

function escalationTarget(value: string): EscalationTarget {
  if (value === "coordinator" || value === "contract_owner" || value === "developer") return value;
  throw new Error(`unexpected escalation target ${value}`);
}

function stringList(value: JsonValue, label: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${label} is not a string list`);
  const items: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") throw new Error(`${label} is not a string list`);
    items.push(item);
  }
  return items;
}
