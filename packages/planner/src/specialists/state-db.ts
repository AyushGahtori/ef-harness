import { DatabaseSync } from "node:sqlite";
import type { SQLOutputValue } from "node:sqlite";
import type { GraphNode, HoldFact, ReceiptFact, TableFact, TaskFact } from "./types.js";

type Row = Record<string, SQLOutputValue>;

const DDL = `
CREATE TABLE nodes (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  text TEXT NOT NULL DEFAULT '',
  fields TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'active'
) STRICT;
CREATE TABLE edges (
  src TEXT NOT NULL,
  type TEXT NOT NULL,
  dst TEXT NOT NULL,
  valid_to_rev INTEGER
) STRICT;
CREATE TABLE task_runtime (
  task TEXT PRIMARY KEY,
  feature TEXT NOT NULL,
  state TEXT NOT NULL
) STRICT;
CREATE TABLE task_holds (
  task TEXT NOT NULL,
  reason TEXT NOT NULL,
  source TEXT NOT NULL
) STRICT;
CREATE TABLE names (
  kind TEXT NOT NULL,
  value TEXT NOT NULL,
  owner_node TEXT NOT NULL
) STRICT;
CREATE TABLE check_results (
  check_id TEXT NOT NULL,
  attempt TEXT NOT NULL,
  status TEXT NOT NULL,
  receipt TEXT,
  PRIMARY KEY (check_id, attempt)
) STRICT;
`;

function cell(row: Row, key: string): string {
  const value = row[key];
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "bigint") return String(value);
  return "";
}

function parseFields(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return {};
  }
  return {};
}

function toNode(row: Row): GraphNode {
  return {
    id: cell(row, "id"),
    kind: cell(row, "kind"),
    title: cell(row, "title"),
    text: cell(row, "text"),
    fields: parseFields(cell(row, "fields")),
    status: cell(row, "status") || "active",
  };
}

/**
 * Read-only view over the state.db tables the owner responder is allowed to quote.
 * The DDL is the column subset of schema/state.sql used by these queries.
 */
export class SpecialistStateDb {
  readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  static memory(): SpecialistStateDb {
    const db = new DatabaseSync(":memory:");
    db.exec(DDL);
    return new SpecialistStateDb(db);
  }

  insertNode(node: {
    id: string;
    kind: string;
    title: string;
    text?: string;
    fields?: Readonly<Record<string, unknown>>;
    status?: string;
  }): void {
    this.db
      .prepare(
        "INSERT INTO nodes (id, kind, title, text, fields, status) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(
        node.id,
        node.kind,
        node.title,
        node.text ?? "",
        JSON.stringify(node.fields ?? {}),
        node.status ?? "active",
      );
  }

  insertEdge(edge: { src: string; type: string; dst: string }): void {
    this.db
      .prepare("INSERT INTO edges (src, type, dst, valid_to_rev) VALUES (?, ?, ?, NULL)")
      .run(edge.src, edge.type, edge.dst);
  }

  insertTask(task: { taskId: string; featureId: string; state: string }): void {
    this.db
      .prepare("INSERT INTO task_runtime (task, feature, state) VALUES (?, ?, ?)")
      .run(task.taskId, task.featureId, task.state);
  }

  insertHold(hold: { taskId: string; reason: string; source: string }): void {
    this.db
      .prepare("INSERT INTO task_holds (task, reason, source) VALUES (?, ?, ?)")
      .run(hold.taskId, hold.reason, hold.source);
  }

  insertTable(table: { name: string; ownerNodeId: string }): void {
    this.db
      .prepare("INSERT INTO names (kind, value, owner_node) VALUES ('db_table', ?, ?)")
      .run(table.name, table.ownerNodeId);
  }

  insertReceipt(receipt: { checkId: string; attemptId: string; status: string; receiptId: string }): void {
    this.db
      .prepare("INSERT INTO check_results (check_id, attempt, status, receipt) VALUES (?, ?, ?, ?)")
      .run(receipt.checkId, receipt.attemptId, receipt.status, receipt.receiptId);
  }

  getNode(id: string): GraphNode | null {
    const row = this.db.prepare("SELECT * FROM nodes WHERE id = ? AND status = 'active'").get(id) as
      | Row
      | undefined;
    return row ? toNode(row) : null;
  }

  nodesOfKind(kind: string): readonly GraphNode[] {
    const rows = this.db.prepare("SELECT * FROM nodes WHERE kind = ? AND status = 'active'").all(kind) as Row[];
    return rows.map(toNode);
  }

  tasksForFeature(featureId: string): readonly TaskFact[] {
    const rows = this.db.prepare("SELECT task, feature, state FROM task_runtime WHERE feature = ?").all(featureId) as Row[];
    return rows.map((row) => ({
      taskId: cell(row, "task"),
      featureId: cell(row, "feature"),
      state: cell(row, "state"),
    }));
  }

  holdsFor(taskId: string): readonly HoldFact[] {
    const rows = this.db.prepare("SELECT task, reason, source FROM task_holds WHERE task = ?").all(taskId) as Row[];
    return rows.map((row) => ({
      taskId: cell(row, "task"),
      reason: cell(row, "reason"),
      source: cell(row, "source"),
    }));
  }

  dependencyIds(taskId: string): readonly string[] {
    const rows = this.db
      .prepare(
        "SELECT dst FROM edges WHERE src = ? AND type = 'depends_on' AND valid_to_rev IS NULL",
      )
      .all(taskId) as Row[];
    return rows.map((row) => cell(row, "dst"));
  }

  tablesAbout(topic: string): readonly TableFact[] {
    const needle = topic.toLowerCase();
    const rows = this.db
      .prepare(
        `SELECT names.value AS value, names.owner_node AS owner_node, nodes.title AS title, nodes.text AS text
         FROM names JOIN nodes ON nodes.id = names.owner_node
         WHERE names.kind = 'db_table' AND nodes.status = 'active'`,
      )
      .all() as Row[];
    return rows
      .map((row) => ({
        table: cell(row, "value"),
        ownerNodeId: cell(row, "owner_node"),
        title: cell(row, "title"),
        text: cell(row, "text"),
      }))
      .filter((fact) => `${fact.table} ${fact.title} ${fact.text}`.toLowerCase().includes(needle));
  }

  receiptsAbout(topic: string): readonly ReceiptFact[] {
    const needle = topic.toLowerCase();
    const rows = this.db
      .prepare(
        `SELECT check_results.check_id AS check_id, check_results.attempt AS attempt,
                check_results.status AS status, check_results.receipt AS receipt,
                nodes.title AS title, nodes.text AS text
         FROM check_results JOIN nodes ON nodes.id = check_results.check_id`,
      )
      .all() as Row[];
    return rows
      .map((row) => {
        const checkId = cell(row, "check_id");
        const attemptId = cell(row, "attempt");
        const receipt = cell(row, "receipt");
        return {
          receiptId: receipt || `${checkId}:${attemptId}`,
          checkId,
          attemptId,
          status: cell(row, "status"),
          title: cell(row, "title"),
          text: cell(row, "text"),
        };
      })
      .filter((fact) => `${fact.title} ${fact.text} ${fact.checkId}`.toLowerCase().includes(needle));
  }

  nodeIds(): ReadonlySet<string> {
    const rows = this.db.prepare("SELECT id FROM nodes WHERE status = 'active'").all() as Row[];
    return new Set(rows.map((row) => cell(row, "id")));
  }

  receiptIds(): ReadonlySet<string> {
    const rows = this.db.prepare("SELECT check_id, attempt, receipt FROM check_results").all() as Row[];
    const ids = new Set<string>();
    for (const row of rows) {
      const checkId = cell(row, "check_id");
      const attempt = cell(row, "attempt");
      const receipt = cell(row, "receipt");
      if (receipt) ids.add(receipt);
      ids.add(`${checkId}:${attempt}`);
    }
    return ids;
  }

  filePaths(): ReadonlyMap<string, ReadonlySet<number>> {
    const files = new Map<string, Set<number>>();
    for (const node of this.nodesOfKind("task").concat(this.allNodes())) {
      const file = node.fields.file;
      if (typeof file === "string" && file.length > 0) {
        files.set(file, files.get(file) ?? new Set<number>());
      }
    }
    return files;
  }

  private allNodes(): readonly GraphNode[] {
    const rows = this.db.prepare("SELECT * FROM nodes WHERE status = 'active'").all() as Row[];
    return rows.map(toNode);
  }
}
