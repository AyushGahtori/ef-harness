import type { DatabaseSync } from "node:sqlite";

import {
  HybridRevisionEngine,
  openRevisionDatabase,
  type ChangeClass,
  type RevisionEdit,
} from "../../src/revisions/index.js";

export function openDb(): DatabaseSync {
  return openRevisionDatabase();
}

export function insertNode(
  db: DatabaseSync,
  node: {
    readonly id: string;
    readonly kind: string;
    readonly title: string;
    readonly text: string;
    readonly fields?: Readonly<Record<string, unknown>>;
  },
): void {
  db.prepare(
    `INSERT INTO nodes(id, kind, title, text, fields, status)
     VALUES (:id, :kind, :title, :text, :fields, 'active')`,
  ).run({
    id: node.id,
    kind: node.kind,
    title: node.title,
    text: node.text,
    fields: JSON.stringify(node.fields ?? {}),
  });
}

export function insertEdge(
  db: DatabaseSync,
  edge: { readonly src: string; readonly type: string; readonly dst: string; readonly retired?: boolean },
): void {
  db.prepare(
    `INSERT INTO edges(src, type, dst, valid_to_rev) VALUES (:src, :type, :dst, :valid_to_rev)`,
  ).run({
    src: edge.src,
    type: edge.type,
    dst: edge.dst,
    valid_to_rev: edge.retired ? 1 : null,
  });
}

export function insertTask(
  db: DatabaseSync,
  task: { readonly id: string; readonly state: string; readonly title: string },
): void {
  db.prepare(
    `INSERT INTO task_runtime(task, state, title, verified_under_rev)
     VALUES (:task, :state, :title, 0)`,
  ).run({ task: task.id, state: task.state, title: task.title });
}

export function edit(input: {
  readonly nodeId: string;
  readonly nodeKind?: string;
  readonly beforeText: string;
  readonly afterText: string;
  readonly beforeFields?: Readonly<Record<string, unknown>>;
  readonly afterFields?: Readonly<Record<string, unknown>>;
  readonly triggerSource?: string;
  readonly requestedClass?: ChangeClass;
}): RevisionEdit {
  return {
    nodeId: input.nodeId,
    nodeKind: input.nodeKind ?? "decision",
    beforeText: input.beforeText,
    afterText: input.afterText,
    beforeFields: input.beforeFields ?? {},
    afterFields: input.afterFields ?? {},
    triggerSource: input.triggerSource ?? "chat",
    ...(input.requestedClass ? { requestedClass: input.requestedClass } : {}),
  };
}

export function engineFor(db: DatabaseSync): HybridRevisionEngine {
  return new HybridRevisionEngine({ db });
}

export function holdTasks(db: DatabaseSync): string[] {
  return db
    .prepare(`SELECT task FROM task_holds ORDER BY task`)
    .all()
    .map((row) => String(row.task));
}

export function taskRow(db: DatabaseSync, taskId: string): { state: string; verified: number } {
  const row = db
    .prepare(`SELECT state, verified_under_rev FROM task_runtime WHERE task = :task`)
    .get({ task: taskId });
  if (!row) throw new Error(`missing task ${taskId}`);
  return { state: String(row.state), verified: Number(row.verified_under_rev) };
}

export function spawnCount(db: DatabaseSync, kind: string): number {
  const row = db
    .prepare(`SELECT COUNT(*) AS n FROM revision_spawned_tasks WHERE kind = :kind`)
    .get({ kind });
  return Number(row?.n ?? 0);
}
