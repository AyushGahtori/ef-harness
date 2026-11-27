import type { SQLInputValue, SQLOutputValue } from "node:sqlite";
import {
  KnowledgeGraphRepo as DbKnowledgeGraphRepo,
  knowledgeLoadQueryCatalog,
  readQueriesSql,
  type SqlConnection,
  type SqlRow,
  type SqlValue,
} from "@ef-harness/db";
import { localContentHash } from "./canonical-json.js";
import { assertDecisionFields, decisionFieldsJson, type DecisionFields } from "./decision-fields.js";
import type {
  BatchRow,
  BatchStatus,
  KnowledgeGraphRepo,
  NodeInsert,
  NodeUpdate,
  OperationRow,
  ScopeCriterionRow,
  ScopeRow,
  StoredNode,
  TurnRow,
  WorkItemKind,
  WorkItemRow,
  WorkItemStatus,
} from "./knowledge-graph-port.js";
import { openStateDatabase } from "./sqlite-state.js";
import type { DatabaseSync } from "node:sqlite";

type Row = Record<string, SQLOutputValue>;

const COUNTABLE = new Set([
  "work_items",
  "discovery_scopes",
  "scope_criteria",
  "discovery_batches",
  "turns",
  "operations",
  "nodes",
]);

export class LocalSqliteKnowledgeGraph implements KnowledgeGraphRepo {
  private readonly db: DatabaseSync;
  private readonly knowledge: DbKnowledgeGraphRepo;
  private depth = 0;
  private closed = false;

  constructor(filename: string) {
    this.db = openStateDatabase(filename);
    this.db.exec("INSERT INTO meta(key, value) VALUES ('last_rev', '0') ON CONFLICT(key) DO NOTHING");
    const connection = sqlConnectionFrom(this.db);
    this.knowledge = new DbKnowledgeGraphRepo(connection, knowledgeLoadQueryCatalog(connection, readQueriesSql()));
  }

  transaction<T>(work: () => T): T {
    if (this.depth > 0) return work();
    this.db.exec("BEGIN IMMEDIATE");
    this.depth += 1;
    try {
      const result = work();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      try {
        this.db.exec("ROLLBACK");
      } catch (rollbackError) {
        const reason = rollbackError instanceof Error ? rollbackError.message : String(rollbackError);
        const original = error instanceof Error ? error.message : String(error);
        throw new Error(`rollback failed after ${original}: ${reason}`);
      }
      throw error;
    } finally {
      this.depth -= 1;
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    try {
      this.db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    } catch {
      // In-memory databases have no WAL file to checkpoint.
    }
    this.db.close();
  }

  insertChangeSet(input: {
    id: string;
    origin: "chat" | "markdown_edit" | "research" | "planner" | "sweep" | "undo" | "intake" | "kernel" | "import";
    author: string;
    summary: string;
    createdAt: number;
  }): number {
    this.db
      .prepare(
        `INSERT INTO change_sets(id, rev, origin, author, created_at, summary)
         VALUES (?, (SELECT COALESCE(MAX(rev), 0) + 1 FROM change_sets), ?, ?, ?, ?)`,
      )
      .run(input.id, input.origin, input.author, input.createdAt, input.summary);
    return requiredInt(requiredRow(this.db.prepare("SELECT rev FROM change_sets WHERE id = ?").get(input.id)), "rev");
  }

  insertNode(input: NodeInsert): void {
    const fields = normalizeFields(input.kind, input.fields);
    if (this.depth === 0) {
      this.knowledge.commitChangeSet({
        origin: "chat",
        author: "discovery",
        summary: input.title,
        nodes: [
          {
            op: "create",
            id: input.id,
            kind: input.kind,
            title: input.title,
            text: input.text,
            fields,
            status: "active",
          },
        ],
      });
      return;
    }
    const fieldsJson = JSON.stringify(fields);
    const title = input.title.normalize("NFC");
    const text = input.text.normalize("NFC");
    const hash = localContentHash({ kind: input.kind, title, text, fields });
    this.db
      .prepare(
        `INSERT INTO nodes(id, kind, version, content_hash, title, text, fields, change_set, created_rev, updated_rev)
         VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(input.id, input.kind, hash, title, text, fieldsJson, input.changeSetId, input.rev, input.rev);
  }

  updateNode(input: NodeUpdate): void {
    const current = this.getNode(input.id);
    if (!current) throw new Error(`node ${input.id} does not exist`);
    if (current.version !== input.expectedVersion) {
      throw new Error(`node ${input.id} version is ${current.version}, expected ${input.expectedVersion}`);
    }
    const fields = normalizeFields(current.kind, input.fields);
    if (this.depth === 0) {
      this.knowledge.commitChangeSet({
        origin: "chat",
        author: "discovery",
        summary: input.title,
        nodes: [
          {
            op: "update",
            id: input.id,
            class: "clarifying",
            title: input.title,
            text: input.text,
            fields,
          },
        ],
      });
      return;
    }
    const fieldsJson = JSON.stringify(fields);
    const title = input.title.normalize("NFC");
    const text = input.text.normalize("NFC");
    const hash = localContentHash({ kind: current.kind, title, text, fields });
    this.db
      .prepare(
        `UPDATE nodes
            SET version = ?, content_hash = ?, title = ?, text = ?, fields = ?, change_set = ?, updated_rev = ?
          WHERE id = ?`,
      )
      .run(current.version + 1, hash, title, text, fieldsJson, input.changeSetId, input.rev, input.id);
  }

  getNode(id: string): StoredNode | null {
    const row = this.db
      .prepare(
        `SELECT id, kind, version, title, text, fields, change_set, created_rev, updated_rev
           FROM nodes WHERE id = ?`,
      )
      .get(id);
    return row ? mapNode(asRow(row)) : null;
  }

  findDecisionByCriterion(workItemId: string, criterionId: string): StoredNode | null {
    const row = this.db
      .prepare(
        `SELECT n.id, n.kind, n.version, n.title, n.text, n.fields, n.change_set, n.created_rev, n.updated_rev
           FROM nodes n
           JOIN scope_criteria sc ON sc.decision = n.id
          WHERE sc.work_item = ?
            AND n.kind = 'decision'
            AND n.status = 'active'
            AND n.fields ->> '$.criterion' = ?
          ORDER BY sc.scope_rev DESC
          LIMIT 1`,
      )
      .get(workItemId, criterionId);
    return row ? mapNode(asRow(row)) : null;
  }

  findDecisionByQuestionId(questionId: string): StoredNode | null {
    const row = this.db
      .prepare(
        `SELECT id, kind, version, title, text, fields, change_set, created_rev, updated_rev
           FROM nodes
          WHERE kind = 'decision'
            AND status = 'active'
            AND fields ->> '$.question_id' = ?
          LIMIT 1`,
      )
      .get(questionId);
    return row ? mapNode(asRow(row)) : null;
  }

  listDecisions(): StoredNode[] {
    return this.db
      .prepare(
        `SELECT id, kind, version, title, text, fields, change_set, created_rev, updated_rev
           FROM nodes WHERE kind = 'decision' AND status = 'active' ORDER BY id`,
      )
      .all()
      .map((row) => mapNode(asRow(row)));
  }

  insertWorkItem(row: WorkItemRow): void {
    this.db
      .prepare("INSERT INTO work_items(id, kind, title, status, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(row.id, row.kind, row.title, row.status, row.createdAt);
  }

  listWorkItems(): WorkItemRow[] {
    return this.db
      .prepare("SELECT id, kind, title, status, created_at FROM work_items ORDER BY created_at, id")
      .all()
      .map((row) => mapWorkItem(asRow(row)));
  }

  getWorkItem(id: string): WorkItemRow | null {
    const row = this.db
      .prepare("SELECT id, kind, title, status, created_at FROM work_items WHERE id = ?")
      .get(id);
    return row ? mapWorkItem(asRow(row)) : null;
  }

  insertScope(row: ScopeRow): void {
    this.db
      .prepare(
        "INSERT INTO discovery_scopes(work_item, scope_rev, created_rev, reason) VALUES (?, ?, ?, ?)",
      )
      .run(row.workItemId, row.scopeRev, row.createdRev, row.reason);
  }

  listScopes(workItemId: string): ScopeRow[] {
    return this.db
      .prepare(
        `SELECT work_item, scope_rev, created_rev, reason
           FROM discovery_scopes WHERE work_item = ? ORDER BY scope_rev`,
      )
      .all(workItemId)
      .map((row) => mapScope(asRow(row)));
  }

  insertScopeCriterion(row: ScopeCriterionRow): void {
    this.db
      .prepare(
        `INSERT INTO scope_criteria(work_item, scope_rev, decision, needed_for_planning, critical)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        row.workItemId,
        row.scopeRev,
        row.decisionId,
        row.neededForPlanning ? 1 : 0,
        row.critical ? 1 : 0,
      );
  }

  listScopeCriteria(workItemId: string, scopeRev: number): ScopeCriterionRow[] {
    return this.db
      .prepare(
        `SELECT work_item, scope_rev, decision, needed_for_planning, critical
           FROM scope_criteria
          WHERE work_item = ? AND scope_rev = ?
          ORDER BY decision`,
      )
      .all(workItemId, scopeRev)
      .map((row) => mapCriterion(asRow(row)));
  }

  insertBatch(row: BatchRow): void {
    this.db
      .prepare(
        `INSERT INTO discovery_batches(id, work_item, scope_rev, status, questions, cursor, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        row.id,
        row.workItemId,
        row.scopeRev,
        row.status,
        JSON.stringify(row.questionIds),
        row.cursor,
        row.createdAt,
      );
  }

  getBatch(id: string): BatchRow | null {
    const row = this.db
      .prepare(
        `SELECT id, work_item, scope_rev, status, questions, cursor, created_at
           FROM discovery_batches WHERE id = ?`,
      )
      .get(id);
    return row ? mapBatch(asRow(row)) : null;
  }

  getOpenBatch(workItemId: string): BatchRow | null {
    const row = this.db
      .prepare(
        `SELECT id, work_item, scope_rev, status, questions, cursor, created_at
           FROM discovery_batches
          WHERE work_item = ? AND status = 'open'
          ORDER BY created_at DESC, id DESC
          LIMIT 1`,
      )
      .get(workItemId);
    return row ? mapBatch(asRow(row)) : null;
  }

  updateBatch(id: string, patch: { cursor?: number; status?: BatchStatus }): void {
    const current = this.getBatch(id);
    if (!current) throw new Error(`batch ${id} does not exist`);
    this.db
      .prepare("UPDATE discovery_batches SET cursor = ?, status = ? WHERE id = ?")
      .run(patch.cursor ?? current.cursor, patch.status ?? current.status, id);
  }

  insertTurn(row: TurnRow): void {
    this.db
      .prepare("INSERT INTO turns(id, author, target, text, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(row.id, row.author, row.target, row.text, row.createdAt);
  }

  listTurns(): TurnRow[] {
    return this.db
      .prepare("SELECT id, author, target, text, created_at FROM turns ORDER BY created_at, id")
      .all()
      .map((row) => mapTurn(asRow(row)));
  }

  getTurn(id: string): TurnRow | null {
    const row = this.db
      .prepare("SELECT id, author, target, text, created_at FROM turns WHERE id = ?")
      .get(id);
    return row ? mapTurn(asRow(row)) : null;
  }

  countTurns(): number {
    return this.countRows("turns");
  }

  getOperation(opId: string): OperationRow | null {
    const row = this.db
      .prepare(
        "SELECT op_id, kind, request_hash, result, committed_rev, created_at FROM operations WHERE op_id = ?",
      )
      .get(opId);
    return row ? mapOperation(asRow(row)) : null;
  }

  insertOperation(row: OperationRow): void {
    this.db
      .prepare(
        `INSERT INTO operations(op_id, kind, request_hash, result, committed_rev, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(row.opId, row.kind, row.requestHash, row.resultJson, row.committedRev, row.createdAt);
  }

  contentHash(id: string): string | null {
    const row = this.db.prepare("SELECT content_hash AS hash FROM nodes WHERE id = ?").get(id);
    if (!row || typeof row !== "object") return null;
    const hash = Reflect.get(row, "hash");
    return typeof hash === "string" ? hash : null;
  }

  countRows(
    table:
      | "work_items"
      | "discovery_scopes"
      | "scope_criteria"
      | "discovery_batches"
      | "turns"
      | "operations"
      | "nodes",
  ): number {
    if (!COUNTABLE.has(table)) throw new Error(`refusing to count ${table}`);
    const row = this.db.prepare(`SELECT count(*) AS c FROM ${table}`).get();
    return requiredInt(requiredRow(row), "c");
  }
}

function normalizeFields(
  kind: string,
  fields: DecisionFields | Record<string, unknown>,
): Record<string, unknown> {
  if (kind === "decision") {
    const parsed = fields as DecisionFields;
    assertDecisionFields(parsed);
    return decisionFieldsJson(parsed);
  }
  return fields as Record<string, unknown>;
}

function sqlConnectionFrom(db: DatabaseSync): SqlConnection {
  return {
    exec(sql: string): void {
      db.exec(sql);
    },
    prepare(sql: string) {
      const statement = db.prepare(sql);
      statement.setAllowBareNamedParameters(true);
      return {
        all(params: Record<string, SqlValue> = {}): SqlRow[] {
          return statement.all(params as Record<string, SQLInputValue>) as SqlRow[];
        },
        get(params: Record<string, SqlValue> = {}): SqlRow | undefined {
          const row = statement.get(params as Record<string, SQLInputValue>);
          if (row === undefined) return undefined;
          return row as SqlRow;
        },
        run(params: Record<string, SqlValue> = {}): { changes: number; lastInsertRowid: number } {
          const result = statement.run(params as Record<string, SQLInputValue>);
          return {
            changes: typeof result.changes === "bigint" ? Number(result.changes) : result.changes,
            lastInsertRowid:
              typeof result.lastInsertRowid === "bigint" ? Number(result.lastInsertRowid) : result.lastInsertRowid,
          };
        },
      };
    },
    close(): void {
      db.close();
    },
  };
}

function asRow(value: unknown): Row {
  return value as Row;
}

function requiredRow(value: unknown): Row {
  if (!value || typeof value !== "object") throw new Error("expected a SQL row");
  return value as Row;
}

function requiredText(row: Row, key: string): string {
  const value = row[key];
  if (typeof value !== "string") throw new Error(`column ${key} is not text`);
  return value;
}

function requiredInt(row: Row, key: string): number {
  const value = row[key];
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  throw new Error(`column ${key} is not an integer`);
}

function optionalText(row: Row, key: string): string | null {
  const value = row[key];
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") throw new Error(`column ${key} is not text`);
  return value;
}

function mapNode(row: Row): StoredNode {
  return {
    id: requiredText(row, "id"),
    kind: requiredText(row, "kind"),
    version: requiredInt(row, "version"),
    title: requiredText(row, "title"),
    text: requiredText(row, "text"),
    fieldsJson: requiredText(row, "fields"),
    changeSetId: requiredText(row, "change_set"),
    createdRev: requiredInt(row, "created_rev"),
    updatedRev: requiredInt(row, "updated_rev"),
  };
}

function mapWorkItem(row: Row): WorkItemRow {
  return {
    id: requiredText(row, "id"),
    kind: requiredText(row, "kind") as WorkItemKind,
    title: requiredText(row, "title"),
    status: requiredText(row, "status") as WorkItemStatus,
    createdAt: requiredInt(row, "created_at"),
  };
}

function mapScope(row: Row): ScopeRow {
  return {
    workItemId: requiredText(row, "work_item"),
    scopeRev: requiredInt(row, "scope_rev"),
    createdRev: requiredInt(row, "created_rev"),
    reason: requiredText(row, "reason"),
  };
}

function mapCriterion(row: Row): ScopeCriterionRow {
  return {
    workItemId: requiredText(row, "work_item"),
    scopeRev: requiredInt(row, "scope_rev"),
    decisionId: requiredText(row, "decision"),
    neededForPlanning: requiredInt(row, "needed_for_planning") === 1,
    critical: requiredInt(row, "critical") === 1,
  };
}

function mapBatch(row: Row): BatchRow {
  const parsed = JSON.parse(requiredText(row, "questions")) as unknown;
  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string")) {
    throw new Error("discovery_batches.questions must be a JSON array of decision ids");
  }
  return {
    id: requiredText(row, "id"),
    workItemId: requiredText(row, "work_item"),
    scopeRev: requiredInt(row, "scope_rev"),
    status: requiredText(row, "status") as BatchStatus,
    questionIds: parsed as string[],
    cursor: requiredInt(row, "cursor"),
    createdAt: requiredInt(row, "created_at"),
  };
}

function mapTurn(row: Row): TurnRow {
  const author = requiredText(row, "author");
  if (author !== "developer" && author !== "harness") {
    throw new Error(`unexpected turn author ${author}`);
  }
  return {
    id: requiredText(row, "id"),
    author,
    target: optionalText(row, "target"),
    text: requiredText(row, "text"),
    createdAt: requiredInt(row, "created_at"),
  };
}

function mapOperation(row: Row): OperationRow {
  const committed = row.committed_rev;
  return {
    opId: requiredText(row, "op_id"),
    kind: requiredText(row, "kind"),
    requestHash: requiredText(row, "request_hash"),
    resultJson: requiredText(row, "result"),
    committedRev:
      committed === null || committed === undefined
        ? null
        : typeof committed === "bigint"
          ? Number(committed)
          : typeof committed === "number"
            ? committed
            : null,
    createdAt: requiredInt(row, "created_at"),
  };
}
