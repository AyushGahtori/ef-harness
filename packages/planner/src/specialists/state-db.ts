import fs from "node:fs";
import {
  bindKnowledgeGraph,
  bindKnowledgeSearch,
  type KnowledgeGraphRepo,
  type KnowledgeSearchService,
  type ProjectStateDb,
} from "@ef-harness/db";
import { openPlannerState, tempPlannerRoot } from "../state/project-db.js";
import type { GraphNode, HoldFact, ReceiptFact, TableFact, TaskFact } from "./types.js";

type Row = Readonly<Record<string, unknown>>;

function cell(row: Row, key: string): string {
  const value = row[key];
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "bigint") return String(value);
  return "";
}

function parseFields(raw: unknown): Record<string, unknown> {
  if (typeof raw !== "string") return {};
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
    fields: parseFields(row.fields),
    status: cell(row, "status") || "active",
  };
}

/**
 * Canonical `ProjectStateDb` view for the owner responder (`ask-owner-responder@1`).
 * Backed by full `schema/state.sql` (`nodes`, `edges`, `task_runtime`, `task_holds`, `names`,
 * `check_results`, and `KnowledgeSearchService` FTS5). Zero private DDL.
 */
export class SpecialistStateDb {
  readonly stateDb: ProjectStateDb;
  private readonly kg: KnowledgeGraphRepo;
  private readonly search: KnowledgeSearchService;
  private attemptCounter = 1;

  private constructor(
    stateDb: ProjectStateDb,
    private readonly ownsState: boolean,
    private readonly cleanupRoot: string | null,
  ) {
    this.stateDb = stateDb;
    this.kg = bindKnowledgeGraph(stateDb);
    this.search = bindKnowledgeSearch(stateDb);
  }

  /** Binds to an already-open caller `ProjectStateDb` (`close()` does not close caller handle). */
  static fromState(stateDb: ProjectStateDb): SpecialistStateDb {
    return new SpecialistStateDb(stateDb, false, null);
  }

  /** Opens a project `state.db` under `rootDir` using canonical `openPlannerState`. */
  static open(rootDir: string): SpecialistStateDb {
    return new SpecialistStateDb(openPlannerState(rootDir), true, null);
  }

  /** Opens an isolated ephemeral `ProjectStateDb` backed by canonical `schema/state.sql`. */
  static memory(): SpecialistStateDb {
    const rootDir = tempPlannerRoot("ef-spec-db-");
    return new SpecialistStateDb(openPlannerState(rootDir), true, rootDir);
  }

  close(): void {
    if (this.ownsState) {
      this.stateDb.close();
    }
    if (this.cleanupRoot !== null) {
      fs.rmSync(this.cleanupRoot, { recursive: true, force: true });
    }
  }

  insertNode(node: {
    id: string;
    kind: string;
    title: string;
    text?: string;
    fields?: Readonly<Record<string, unknown>>;
    status?: string;
  }): void {
    const existing = this.kg.getNode(node.id);
    if (existing) {
      this.kg.commitChangeSet({
        origin: "planner",
        author: "specialists",
        summary: `Update node ${node.id}`,
        reads: [{ target: node.id, version: existing.version }],
        nodes: [
          {
            op: "update",
            id: node.id,
            class: "compatible",
            title: node.title,
            text: node.text ?? "",
            fields: node.fields ?? {},
            ...(node.status === "draft" ||
            node.status === "active" ||
            node.status === "retired" ||
            node.status === "superseded"
              ? { status: node.status }
              : {}),
          },
        ],
      });
      return;
    }
    this.kg.commitChangeSet({
      origin: "planner",
      author: "specialists",
      summary: `Create node ${node.id}`,
      nodes: [
        {
          op: "create",
          id: node.id,
          kind: node.kind,
          title: node.title,
          text: node.text ?? "",
          fields: node.fields ?? {},
          status: node.status === "draft" ? "draft" : "active",
        },
      ],
    });
  }

  insertEdge(edge: { src: string; type: string; dst: string }): void {
    this.kg.commitChangeSet({
      origin: "planner",
      author: "specialists",
      summary: `Edge ${edge.src} -> ${edge.dst}`,
      edges: [{ op: "create", src: edge.src, type: edge.type, dst: edge.dst }],
    });
  }

  insertTask(task: { taskId: string; featureId: string; state: string }): void {
    if (!this.kg.getNode(task.taskId)) {
      this.insertNode({
        id: task.taskId,
        kind: "task",
        title: task.taskId,
        fields: { feature: task.featureId },
      });
    }
    const rev = Math.max(1, this.kg.currentRevision());
    this.stateDb.writer.run(
      `INSERT INTO task_runtime (task, feature, state, level, updated_rev)
       VALUES (?, ?, ?, 'leaf', ?)
       ON CONFLICT(task) DO UPDATE SET feature = excluded.feature, state = excluded.state, updated_rev = excluded.updated_rev`,
      [task.taskId, task.featureId, task.state, rev],
    );
  }

  insertHold(hold: { taskId: string; reason: string; source: string }): void {
    this.stateDb.writer.run(
      "INSERT OR IGNORE INTO task_holds (task, reason, source, created_at) VALUES (?, ?, ?, ?)",
      [hold.taskId, hold.reason, hold.source, Date.now()],
    );
  }

  insertTable(table: { name: string; ownerNodeId: string }): void {
    const owner = this.kg.getNode(table.ownerNodeId);
    this.stateDb.writer.run(
      `INSERT INTO names (kind, value, owner_node, feature)
       VALUES ('db_table', ?, ?, ?)
       ON CONFLICT(kind, value) DO UPDATE SET owner_node = excluded.owner_node, feature = excluded.feature`,
      [table.name, table.ownerNodeId, owner?.feature ?? null],
    );
  }

  insertReceipt(receipt: { checkId: string; attemptId: string; status: string; receiptId: string }): void {
    if (!this.kg.getNode(receipt.checkId)) {
      this.insertNode({ id: receipt.checkId, kind: "check", title: receipt.checkId });
    }
    const existingAttempt = this.stateDb.writer.get(
      "SELECT id FROM attempts WHERE id = ?",
      [receipt.attemptId],
    );
    if (!existingAttempt) {
      const taskId = `__attempt_task:${receipt.checkId}`;
      if (!this.kg.getNode(taskId)) {
        this.insertTask({ taskId, featureId: "__checks", state: "ACCEPTED" });
      }
      const n = this.attemptCounter;
      this.attemptCounter += 1;
      this.stateDb.writer.run(
        `INSERT INTO attempts (id, task, n, epoch, brief_version, runtime, model, connection, base_commit, state, started_at)
         VALUES (?, ?, ?, 0, 1, 'local', 'test', 'direct', 'HEAD', 'accepted', ?)`,
        [receipt.attemptId, taskId, n, Date.now()],
      );
    }
    this.stateDb.writer.run(
      `INSERT INTO check_results (check_id, attempt, check_version, artifact_digest, status, receipt, recorded_at)
       VALUES (?, ?, 1, 'sha256:0000', ?, ?, ?)
       ON CONFLICT(check_id, attempt, check_version) DO UPDATE SET status = excluded.status, receipt = excluded.receipt, recorded_at = excluded.recorded_at`,
      [receipt.checkId, receipt.attemptId, receipt.status, receipt.receiptId, Date.now()],
    );
  }

  getNode(id: string): GraphNode | null {
    const row = this.stateDb.writer.get(
      "SELECT id, kind, title, text, fields, status FROM nodes WHERE id = ? AND status = 'active'",
      [id],
    ) as Row | undefined;
    return row ? toNode(row) : null;
  }

  nodesOfKind(kind: string): readonly GraphNode[] {
    const rows = this.stateDb.writer.all(
      "SELECT id, kind, title, text, fields, status FROM nodes WHERE kind = ? AND status = 'active'",
      [kind],
    ) as Row[];
    return rows.map(toNode);
  }

  allNodes(): readonly GraphNode[] {
    const rows = this.stateDb.writer.all(
      "SELECT id, kind, title, text, fields, status FROM nodes WHERE status = 'active'",
      [],
    ) as Row[];
    return rows.map(toNode);
  }

  searchNodes(query: string, limit = 10): readonly GraphNode[] {
    const page = this.search.searchNodes({ query, limit });
    const nodes: GraphNode[] = [];
    for (const hit of page.items) {
      const full = this.getNode(hit.id);
      if (full) nodes.push(full);
    }
    return nodes;
  }

  tasksForFeature(featureId: string): readonly TaskFact[] {
    const rows = this.stateDb.writer.all(
      "SELECT task, feature, state FROM task_runtime WHERE feature = ?",
      [featureId],
    ) as Row[];
    return rows.map((row) => ({
      taskId: cell(row, "task"),
      featureId: cell(row, "feature"),
      state: cell(row, "state"),
    }));
  }

  allTasks(): readonly TaskFact[] {
    const rows = this.stateDb.writer.all("SELECT task, feature, state FROM task_runtime", []) as Row[];
    return rows.map((row) => ({
      taskId: cell(row, "task"),
      featureId: cell(row, "feature"),
      state: cell(row, "state"),
    }));
  }

  holdsFor(taskId: string): readonly HoldFact[] {
    const rows = this.stateDb.writer.all(
      "SELECT task, reason, source FROM task_holds WHERE task = ?",
      [taskId],
    ) as Row[];
    return rows.map((row) => ({
      taskId: cell(row, "task"),
      reason: cell(row, "reason"),
      source: cell(row, "source"),
    }));
  }

  dependencyIds(taskId: string): readonly string[] {
    const rows = this.stateDb.writer.all(
      "SELECT dst FROM edges WHERE src = ? AND type = 'depends_on' AND valid_to_rev IS NULL",
      [taskId],
    ) as Row[];
    return rows.map((row) => cell(row, "dst"));
  }

  tablesAbout(topic: string): readonly TableFact[] {
    const needle = topic.toLowerCase();
    const rows = this.stateDb.writer.all(
      `SELECT names.value AS value, names.owner_node AS owner_node, nodes.title AS title, nodes.text AS text
         FROM names JOIN nodes ON nodes.id = names.owner_node
        WHERE names.kind = 'db_table' AND nodes.status = 'active'`,
      [],
    ) as Row[];
    return rows
      .map((row) => ({
        table: cell(row, "value"),
        ownerNodeId: cell(row, "owner_node"),
        title: cell(row, "title"),
        text: cell(row, "text"),
      }))
      .filter((fact) => `${fact.table} ${fact.title} ${fact.text}`.toLowerCase().includes(needle));
  }

  allTables(): readonly TableFact[] {
    const rows = this.stateDb.writer.all(
      `SELECT names.value AS value, names.owner_node AS owner_node, nodes.title AS title, nodes.text AS text
         FROM names JOIN nodes ON nodes.id = names.owner_node
        WHERE names.kind = 'db_table' AND nodes.status = 'active'`,
      [],
    ) as Row[];
    return rows.map((row) => ({
      table: cell(row, "value"),
      ownerNodeId: cell(row, "owner_node"),
      title: cell(row, "title"),
      text: cell(row, "text"),
    }));
  }

  receiptsAbout(topic: string): readonly ReceiptFact[] {
    const needle = topic.toLowerCase();
    return this.allReceipts().filter((fact) =>
      `${fact.title} ${fact.checkId} ${fact.receiptId}`.toLowerCase().includes(needle),
    );
  }

  allReceipts(): readonly ReceiptFact[] {
    const rows = this.stateDb.writer.all(
      `SELECT check_results.check_id AS check_id, check_results.attempt AS attempt,
              check_results.status AS status, check_results.receipt AS receipt,
              nodes.title AS title, nodes.text AS text
         FROM check_results JOIN nodes ON nodes.id = check_results.check_id`,
      [],
    ) as Row[];
    return rows.map((row) => {
      const checkId = cell(row, "check_id");
      const attemptId = cell(row, "attempt");
      const receipt = cell(row, "receipt");
      return {
        receiptId: receipt || `${checkId}:${attemptId}`,
        checkId,
        attemptId,
        status: cell(row, "status"),
        title: cell(row, "title"),
      };
    });
  }

  nodeIds(): ReadonlySet<string> {
    const rows = this.stateDb.writer.all(
      "SELECT id FROM nodes WHERE status = 'active'",
      [],
    ) as Row[];
    return new Set(rows.map((row) => cell(row, "id")));
  }

  receiptIds(): ReadonlySet<string> {
    const rows = this.stateDb.writer.all(
      "SELECT check_id, attempt, receipt FROM check_results",
      [],
    ) as Row[];
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
    for (const node of this.allNodes()) {
      const file = node.fields.file;
      if (typeof file === "string" && file.length > 0) {
        files.set(file, files.get(file) ?? new Set<number>());
      }
    }
    return files;
  }
}
