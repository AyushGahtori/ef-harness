import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { computeNodeContentHash, openProjectStateDb, type ProjectStateDb } from "@ef-harness/db";

import type { GraphNode, HoldFact, ReceiptFact, TableFact, TaskFact } from "./types.js";

type SqlValue = string | number | bigint | null;
type SqlRow = Record<string, SqlValue>;
type Writer = ProjectStateDb["writer"];

function isRow(value: unknown): value is SqlRow {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cell(row: SqlRow, key: string): string {
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

function toNode(row: SqlRow): GraphNode {
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
 * Read-only quotes over the open `ProjectStateDb` writer.
 * Insert helpers exist so tests and the responder can record the rows they quote.
 */
export class SpecialistStateDb {
  private revCounter: number;

  private constructor(private readonly writer: Writer) {
    const row = this.one("SELECT COALESCE(MAX(rev), 0) AS n FROM change_sets");
    this.revCounter = row ? Number(row.n) : 0;
  }

  static memory(): SpecialistStateDb {
    const root = mkdtempSync(path.join(tmpdir(), "ef-ask-owner-"));
    mkdirSync(root, { recursive: true });
    const projectId = `q${createHash("sha256").update(root).digest("hex").slice(0, 24)}`;
    const state = openProjectStateDb({ projectId, rootDir: root });
    return new SpecialistStateDb(state.writer);
  }

  static open(state: ProjectStateDb): SpecialistStateDb {
    return new SpecialistStateDb(state.writer);
  }

  insertNode(node: {
    id: string;
    kind: string;
    title: string;
    text?: string;
    fields?: Readonly<Record<string, unknown>>;
    status?: string;
  }): void {
    const text = node.text ?? "";
    const fields = node.fields ?? {};
    const status = node.status ?? "active";
    const rev = this.changeSet(`node ${node.id}`);
    const hash = computeNodeContentHash({ kind: node.kind, title: node.title, text, fields });
    this.run(
      `INSERT INTO nodes(id, kind, version, content_hash, title, text, fields, status, change_set, created_rev, updated_rev)
       VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?)`,
      node.id,
      node.kind,
      hash,
      node.title,
      text,
      JSON.stringify(fields),
      status,
      `CS-${rev}`,
      rev,
      rev,
    );
  }

  insertEdge(edge: { src: string; type: string; dst: string }): void {
    const rev = this.changeSet(`edge ${edge.src} ${edge.type} ${edge.dst}`);
    this.run(
      `INSERT INTO edges(src, type, dst, change_set, valid_from_rev) VALUES (?, ?, ?, ?, ?)`,
      edge.src,
      edge.type,
      edge.dst,
      `CS-${rev}`,
      rev,
    );
  }

  insertTask(task: { taskId: string; featureId: string; state: string }): void {
    const rev = this.changeSet(`task ${task.taskId}`);
    this.run(
      `INSERT INTO task_runtime(task, feature, state, level, epoch, submission_pending, updated_rev)
       VALUES (?, ?, ?, 'Mid', 0, 0, ?)`,
      task.taskId,
      task.featureId,
      task.state,
      rev,
    );
  }

  insertHold(hold: { taskId: string; reason: string; source: string }): void {
    this.run(
      `INSERT INTO task_holds(task, reason, source, created_at) VALUES (?, ?, ?, ?)`,
      hold.taskId,
      hold.reason,
      hold.source,
      Date.now(),
    );
  }

  insertTable(table: { name: string; ownerNodeId: string }): void {
    this.run(
      `INSERT INTO names(kind, value, owner_node) VALUES ('db_table', ?, ?)`,
      table.name,
      table.ownerNodeId,
    );
  }

  insertReceipt(receipt: { checkId: string; attemptId: string; status: string; receiptId: string }): void {
    const taskId = `TASK-FOR-${receipt.attemptId}`;
    if (!this.getNode(taskId)) {
      this.insertNode({ id: taskId, kind: "task", title: taskId, text: "" });
      this.insertTask({ taskId, featureId: taskId, state: "ACCEPTED" });
    }
    const existing = this.one("SELECT id FROM attempts WHERE id = ?", receipt.attemptId);
    if (!existing) {
      const now = Date.now();
      this.run(
        `INSERT INTO attempts(
           id, task, n, epoch, brief_version, runtime, model, connection, base_commit, state, started_at, ended_at
         ) VALUES (?, ?, 1, 0, 1, 'scripted', 'scripted', 'local', ?, 'accepted', ?, ?)`,
        receipt.attemptId,
        taskId,
        "0".repeat(40),
        now,
        now,
      );
    }
    this.run(
      `INSERT INTO check_results(check_id, attempt, check_version, artifact_digest, status, receipt, recorded_at)
       VALUES (?, ?, 1, ?, ?, ?, ?)`,
      receipt.checkId,
      receipt.attemptId,
      computeNodeContentHash({ kind: "check", title: receipt.checkId, text: receipt.receiptId }),
      receipt.status,
      receipt.receiptId,
      Date.now(),
    );
  }

  getNode(id: string): GraphNode | null {
    const row = this.one("SELECT id, kind, title, text, fields, status FROM nodes WHERE id = ? AND status = 'active'", id);
    return row ? toNode(row) : null;
  }

  nodesOfKind(kind: string): readonly GraphNode[] {
    return this.all(
      "SELECT id, kind, title, text, fields, status FROM nodes WHERE kind = ? AND status = 'active'",
      kind,
    ).map(toNode);
  }

  tasksForFeature(featureId: string): readonly TaskFact[] {
    return this.all("SELECT task, feature, state FROM task_runtime WHERE feature = ?", featureId).map((row) => ({
      taskId: cell(row, "task"),
      featureId: cell(row, "feature"),
      state: cell(row, "state"),
    }));
  }

  holdsFor(taskId: string): readonly HoldFact[] {
    return this.all("SELECT task, reason, source FROM task_holds WHERE task = ?", taskId).map((row) => ({
      taskId: cell(row, "task"),
      reason: cell(row, "reason"),
      source: cell(row, "source"),
    }));
  }

  dependencyIds(taskId: string): readonly string[] {
    return this.all(
      "SELECT dst FROM edges WHERE src = ? AND type = 'depends_on' AND valid_to_rev IS NULL",
      taskId,
    ).map((row) => cell(row, "dst"));
  }

  tablesAbout(topic: string): readonly TableFact[] {
    const needle = topic.toLowerCase();
    return this.all(
      `SELECT names.value AS value, names.owner_node AS owner_node, nodes.title AS title, nodes.text AS text
         FROM names JOIN nodes ON nodes.id = names.owner_node
        WHERE names.kind = 'db_table' AND nodes.status = 'active'`,
    )
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
    return this.all(
      `SELECT check_results.check_id AS check_id, check_results.attempt AS attempt,
              check_results.status AS status, check_results.receipt AS receipt,
              nodes.title AS title, nodes.text AS text
         FROM check_results JOIN nodes ON nodes.id = check_results.check_id`,
    )
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
    return new Set(this.all("SELECT id FROM nodes WHERE status = 'active'").map((row) => cell(row, "id")));
  }

  receiptIds(): ReadonlySet<string> {
    const ids = new Set<string>();
    for (const row of this.all("SELECT check_id, attempt, receipt FROM check_results")) {
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
    for (const node of this.nodesOfKind("task").concat([...this.nodesOfKind("contract"), ...this.nodesOfKind("source")])) {
      const file = node.fields.file;
      if (typeof file === "string" && file.length > 0 && !files.has(file)) {
        files.set(file, lineSet(typeof node.text === "string" ? node.text : ""));
      }
    }
    for (const node of this.allNodes()) {
      const file = node.fields.file;
      if (typeof file !== "string" || file.length === 0 || files.has(file)) continue;
      files.set(file, lineSet(node.text));
    }
    return files;
  }

  private allNodes(): readonly GraphNode[] {
    return this.all("SELECT id, kind, title, text, fields, status FROM nodes WHERE status = 'active'").map(toNode);
  }

  private changeSet(summary: string): number {
    this.revCounter += 1;
    const rev = this.revCounter;
    this.run(
      `INSERT INTO change_sets(id, rev, origin, author, created_at, summary)
       VALUES (?, ?, 'planner', 'ask-owner', ?, ?)`,
      `CS-${rev}`,
      rev,
      rev,
      summary,
    );
    return rev;
  }

  private run(sql: string, ...params: SqlValue[]): void {
    this.writer.run(sql, params);
  }

  private one(sql: string, ...params: SqlValue[]): SqlRow | null {
    const row = this.writer.get(sql, params);
    return isRow(row) ? row : null;
  }

  private all(sql: string, ...params: SqlValue[]): SqlRow[] {
    return this.writer.all(sql, params).flatMap((row: unknown) => (isRow(row) ? [row] : []));
  }
}

function lineSet(text: string): Set<number> {
  const count = text.length === 0 ? 0 : text.split(/\r?\n/).length;
  const lines = new Set<number>();
  for (let line = 1; line <= count; line += 1) lines.add(line);
  return lines;
}
