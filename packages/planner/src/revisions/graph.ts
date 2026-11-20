import { DatabaseSync, type SQLOutputValue, type StatementSync } from "node:sqlite";

import { REVISION_SCHEMA_SQL } from "./schema.js";
import type { GraphNode, LinkedCheck, TaskRuntimeRow } from "./types.js";

export interface ImpactClassRow {
  readonly id: string;
  readonly kind: string;
  readonly role: string;
  readonly surface: string;
  readonly state: string | null;
}

const impactClassStatements = new WeakMap<DatabaseSync, StatementSync>();

export function openRevisionDatabase(path = ":memory:"): DatabaseSync {
  const db = new DatabaseSync(path);
  db.exec(REVISION_SCHEMA_SQL);
  return db;
}

export function sqlText(value: SQLOutputValue | undefined): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "bigint") return String(value);
  return "";
}

export function sqlInt(value: SQLOutputValue | undefined): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "bigint") return Number(value);
  return 0;
}

export function parseFields(raw: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(raw);
    if (isRecord(value)) return value;
  } catch {
    return {};
  }
  return {};
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export class RevisionGraph {
  constructor(readonly db: DatabaseSync) {}

  loadImpactRows(ids: readonly string[]): Map<string, ImpactClassRow> {
    const found = new Map<string, ImpactClassRow>();
    if (ids.length === 0) return found;
    const rows = this.impactClassStatement().all({ ids: JSON.stringify(ids) });
    for (const row of rows) {
      const id = sqlText(row.id);
      found.set(id, {
        id,
        kind: sqlText(row.kind),
        role: sqlText(row.role),
        surface: sqlText(row.surface),
        state: row.state === null || row.state === undefined ? null : sqlText(row.state),
      });
    }
    return found;
  }

  private impactClassStatement(): StatementSync {
    const cached = impactClassStatements.get(this.db);
    if (cached) return cached;
    const statement = this.db.prepare(
      `SELECT n.id AS id, n.kind AS kind,
              n.fields ->> '$.role' AS role,
              n.fields ->> '$.surface' AS surface,
              tr.state AS state
         FROM json_each(:ids) AS wanted
         JOIN nodes n ON n.id = wanted.value
         LEFT JOIN task_runtime tr ON tr.task = n.id`,
    );
    impactClassStatements.set(this.db, statement);
    return statement;
  }

  loadNode(id: string): GraphNode | null {
    const row = this.db
      .prepare(
        `SELECT id, kind, title, text, fields, status FROM nodes WHERE id = :id`,
      )
      .get({ id });
    if (!row) return null;
    return {
      id: sqlText(row.id),
      kind: sqlText(row.kind),
      title: sqlText(row.title),
      text: sqlText(row.text),
      fields: parseFields(sqlText(row.fields)),
      status: sqlText(row.status),
    };
  }

  updateNode(id: string, text: string, fields: Readonly<Record<string, unknown>>): void {
    this.db
      .prepare(`UPDATE nodes SET text = :text, fields = :fields WHERE id = :id`)
      .run({ id, text, fields: JSON.stringify(fields) });
  }

  dependents(id: string): string[] {
    const rows = this.db
      .prepare(
        `SELECT e.src AS id
           FROM edges e
           JOIN edge_types t ON t.type = e.type
          WHERE e.dst = :id
            AND e.valid_to_rev IS NULL
            AND (t.invalidates = 1 OR t.type = 'belongs_to' OR t.type = 'consumes')
          ORDER BY e.src`,
      )
      .all({ id });
    return rows.map((row) => sqlText(row.id)).filter((value) => value.length > 0);
  }

  taskRuntime(taskId: string): TaskRuntimeRow | null {
    const row = this.db
      .prepare(
        `SELECT task, state, title, verified_under_rev FROM task_runtime WHERE task = :task`,
      )
      .get({ task: taskId });
    if (!row) return null;
    return {
      taskId: sqlText(row.task),
      state: sqlText(row.state),
      title: sqlText(row.title),
      verifiedUnderRev: sqlInt(row.verified_under_rev) === 1,
    };
  }

  taskTitle(taskId: string, fallback: string): string {
    const runtime = this.taskRuntime(taskId);
    if (runtime && runtime.title.length > 0) return runtime.title;
    return fallback;
  }

  allTaskIds(): string[] {
    const rows = this.db.prepare(`SELECT id FROM nodes WHERE kind = 'task' ORDER BY id`).all();
    return rows.map((row) => sqlText(row.id)).filter((id) => id.length > 0);
  }

  markVerified(taskId: string): void {
    this.db
      .prepare(`UPDATE task_runtime SET verified_under_rev = 1 WHERE task = :task`)
      .run({ task: taskId });
  }

  placeHold(taskId: string, reason: string, source: string, createdAt: number): void {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO task_holds(task, reason, source, created_at)
         VALUES (:task, :reason, :source, :created_at)`,
      )
      .run({ task: taskId, reason, source, created_at: createdAt });
  }

  holdTaskIds(reason: string): string[] {
    const rows = this.db
      .prepare(`SELECT task FROM task_holds WHERE reason = :reason ORDER BY task`)
      .all({ reason });
    return rows.map((row) => sqlText(row.task)).filter((id) => id.length > 0);
  }

  insertSpawn(input: {
    id: string;
    revisionId: string;
    kind: "additive" | "rework";
    sourceTask: string | null;
    payload: unknown;
  }): void {
    this.db
      .prepare(
        `INSERT INTO revision_spawned_tasks(id, revision_id, kind, source_task, payload)
         VALUES (:id, :revision_id, :kind, :source_task, :payload)`,
      )
      .run({
        id: input.id,
        revision_id: input.revisionId,
        kind: input.kind,
        source_task: input.sourceTask,
        payload: JSON.stringify(input.payload),
      });
  }

  checksForTask(taskId: string): LinkedCheck[] {
    const rows = this.db
      .prepare(
        `SELECT c.id AS id, c.title AS title, c.text AS text, cv.dst AS requirement_id
           FROM edges tv
           JOIN edges cv
             ON cv.dst = tv.dst
            AND cv.type = 'verifies'
            AND cv.valid_to_rev IS NULL
           JOIN nodes c ON c.id = cv.src AND c.kind = 'check'
          WHERE tv.src = :task
            AND tv.type IN ('implements', 'depends_on', 'obeys', 'handles_edge_case')
            AND tv.valid_to_rev IS NULL
          ORDER BY c.id`,
      )
      .all({ task: taskId });
    return rows.map((row) => ({
      id: sqlText(row.id),
      title: sqlText(row.title),
      text: sqlText(row.text),
      requirementId: sqlText(row.requirement_id),
    }));
  }

  satisfiedChecks(node: GraphNode): Set<string> {
    const raw = node.fields.satisfiedChecks;
    if (!Array.isArray(raw)) return new Set();
    return new Set(raw.filter((item): item is string => typeof item === "string"));
  }
}
