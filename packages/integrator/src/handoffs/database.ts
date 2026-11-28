import { createHash } from "node:crypto";
import { DatabaseSync, type SQLOutputValue } from "node:sqlite";
import {
  KnowledgeGraphRepo,
  knowledgeLoadQueryCatalog,
  readQueriesSql,
  type KnowledgeSqlRow,
  type KnowledgeSqlValue,
  type SqlConnection,
  type SqlStatement,
} from "@ef-harness/db";
import { toPrefixedSha256 } from "@ef-harness/shared-contracts";
import type { ArtifactType, MailboxKind } from "./constants.js";
import { canonicalJson, parseJsonObject, parseJsonValue, type JsonObject, type JsonValue } from "./json.js";
import { openSharedStateFile } from "../shared-state.js";
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

export class HandoffDatabase {
  private depth = 0;
  private closed = false;
  private readonly graph: KnowledgeGraphRepo;

  constructor(private readonly db: DatabaseSync) {
    const connection = adaptKnowledge(db);
    this.graph = new KnowledgeGraphRepo(connection, knowledgeLoadQueryCatalog(connection, readQueriesSql()));
  }

  static open(path: string): HandoffDatabase {
    return new HandoffDatabase(openSharedStateFile(path));
  }

  tables(): readonly string[] {
    return this.db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map((row) => text(row["name"], "name"));
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
    this.ensureCommentNode(fromNode, createdAt);
    this.ensureCommentNode(toNode, createdAt);
    const result = this.db
      .prepare(
        `INSERT OR IGNORE INTO edges(src, type, dst, change_set, valid_from_rev)
         VALUES (?, ?, ?, 'CS-handoff', 0)`,
      )
      .run(fromNode, kind, toNode);
    return Number(result.changes) === 1;
  }

  hasEdge(kind: GraphEdge["kind"], fromNode: string, toNode: string): boolean {
    return this.listEdges().some((edge) => edge.kind === kind && edge.fromNode === fromNode && edge.toNode === toNode);
  }

  listEdges(): GraphEdge[] {
    const rev = this.graph.currentRevision();
    const edges: GraphEdge[] = [];
    let after: string | undefined;
    for (;;) {
      const page =
        after === undefined
          ? this.graph.getEdgesAsOf(rev, { limit: 500 })
          : this.graph.getEdgesAsOf(rev, { limit: 500, after });
      for (const edge of page.edges) {
        if (edge.type !== "depends_on" && edge.type !== "waits_on") continue;
        edges.push({ kind: edge.type, fromNode: edge.src, toNode: edge.dst });
      }
      if (!page.hasMore || page.nextCursor === null) break;
      after = page.nextCursor;
    }
    edges.sort(
      (left, right) =>
        left.kind.localeCompare(right.kind) ||
        left.fromNode.localeCompare(right.fromNode) ||
        left.toNode.localeCompare(right.toNode),
    );
    return edges;
  }

  deleteEdge(kind: GraphEdge["kind"], fromNode: string, toNode: string): void {
    const rev = Math.max(this.graph.currentRevision(), 1);
    this.db.prepare("UPDATE meta SET value = ? WHERE key = 'last_rev' AND CAST(value AS INTEGER) < ?").run(String(rev), rev);
    this.db
      .prepare(
        `UPDATE edges SET valid_to_rev = ?
         WHERE src = ? AND type = ? AND dst = ? AND valid_to_rev IS NULL`,
      )
      .run(rev, fromNode, kind, toNode);
  }

  insertOwner(owner: ContractOwner, createdAt: number): void {
    this.ensureChangeSet(createdAt);
    const nodeId = `contract:${owner.contractId}`;
    const fields = canonicalJson({
      ownerTaskId: owner.ownerTaskId,
      recordedAt: createdAt,
      names: [{ kind: "contract", value: owner.contractId }],
    });
    this.db
      .prepare(
        `INSERT INTO nodes(
           id, kind, version, content_hash, title, text, fields, status, owner_role,
           change_set, created_rev, updated_rev
         ) VALUES (?, 'contract', 1, ?, ?, '', ?, 'active', ?, 'CS-handoff', 0, 0)`,
      )
      .run(nodeId, contentHash(nodeId), owner.contractId, fields, owner.ownerRole);
  }

  getOwner(contractId: string): ContractOwner | null {
    const row = this.db
      .prepare(
        `SELECT n.owner_role, n.fields
           FROM names m
           JOIN nodes n ON n.id = m.owner_node
          WHERE m.kind = 'contract' AND m.value = ? AND n.status = 'active'`,
      )
      .get(contractId);
    if (!row) return null;
    const fields = parseJsonObject(text(row["fields"], "fields"));
    const ownerTaskId = fields["ownerTaskId"];
    if (typeof ownerTaskId !== "string") return null;
    const ownerRole = textOrNull(row["owner_role"], "owner_role");
    if (ownerRole === null) return null;
    return { contractId, ownerRole, ownerTaskId };
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

  private ensureChangeSet(createdAt: number): void {
    this.db
      .prepare(
        `INSERT INTO change_sets(id, origin, author, created_at)
         VALUES ('CS-handoff', 'kernel', 'handoff', ?)
         ON CONFLICT(id) DO NOTHING`,
      )
      .run(createdAt);
  }

  private ensureCommentNode(id: string, createdAt: number): void {
    this.ensureChangeSet(createdAt);
    const existing = this.db.prepare("SELECT 1 AS ok FROM nodes WHERE id = ?").get(id);
    if (existing) return;
    this.db
      .prepare(
        `INSERT INTO nodes(
           id, kind, version, content_hash, title, text, fields, status,
           change_set, created_rev, updated_rev
         ) VALUES (?, 'comment', 1, ?, ?, '', '{}', 'active', 'CS-handoff', 0, 0)`,
      )
      .run(id, contentHash(id), id);
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

function contentHash(id: string): string {
  return toPrefixedSha256(createHash("sha256").update(id).digest("hex"));
}

function adaptKnowledge(db: DatabaseSync): SqlConnection {
  return {
    exec(sql: string): void {
      db.exec(sql);
    },
    prepare(sql: string): SqlStatement {
      const statement = db.prepare(sql);
      statement.setAllowBareNamedParameters(true);
      return {
        all(params: Record<string, KnowledgeSqlValue> = {}): KnowledgeSqlRow[] {
          return statement.all(params) as KnowledgeSqlRow[];
        },
        get(params: Record<string, KnowledgeSqlValue> = {}): KnowledgeSqlRow | undefined {
          return statement.get(params) as KnowledgeSqlRow | undefined;
        },
        run(params: Record<string, KnowledgeSqlValue> = {}): { changes: number; lastInsertRowid: number } {
          const result = statement.run(params);
          const changes = typeof result.changes === "bigint" ? Number(result.changes) : result.changes;
          const lastInsertRowid =
            typeof result.lastInsertRowid === "bigint" ? Number(result.lastInsertRowid) : result.lastInsertRowid;
          return { changes, lastInsertRowid };
        },
      };
    },
    close(): void {
      return;
    },
  };
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
