import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export const ENTITY_COUNT = 300;
export const NODE_COUNT = 1_000;
export const EDGE_COUNT = 2_000;

export interface ExportSloResult {
  fullViewsExportMs: number;
  incrementalViewsExportMs: number;
  harnessStateIncrementalMs: number;
  harnessStateRehydrateMs: number;
  impactWalkMs: number;
  graphCompileMs: number;
  pass: boolean;
  detail: string[];
}

function ensureGraphSchema(db: DatabaseSync): void {
  db.exec(`CREATE TABLE IF NOT EXISTS nodes (
    nid INTEGER PRIMARY KEY,
    entity_id TEXT NOT NULL,
    label TEXT NOT NULL,
    body TEXT NOT NULL
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS edges (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_id INTEGER NOT NULL,
    target_id INTEGER NOT NULL,
    kind TEXT NOT NULL
  )`);
  db.exec("CREATE INDEX IF NOT EXISTS edges_target_id ON edges(target_id)");
  db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS node_fts USING fts5(label, body, content='nodes', content_rowid='nid')`);
}

export function synthesizeKnowledgeGraph(dbPath: string): void {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  try {
    ensureGraphSchema(db);
    db.exec("BEGIN");
    const insertNode = db.prepare("INSERT INTO nodes (entity_id, label, body) VALUES (?, ?, ?)");
    for (let node = 0; node < NODE_COUNT; node += 1) {
      const entity = `E-${node % ENTITY_COUNT}`;
      insertNode.run(entity, `node-${node}`, `body-${node}-${"x".repeat(64)}`);
    }
    const insertEdge = db.prepare("INSERT INTO edges (source_id, target_id, kind) VALUES (?, ?, 'depends')");
    for (let edge = 0; edge < EDGE_COUNT; edge += 1) {
      const source = (edge % NODE_COUNT) + 1;
      const target = ((edge * 7) % NODE_COUNT) + 1;
      insertEdge.run(source, target);
    }
    db.exec("INSERT INTO node_fts(node_fts) VALUES('rebuild')");
    db.exec("COMMIT");
  } finally {
    db.close();
  }
}

/** Local port: Task 085 `KnowledgeViewExporter`. */
export class KnowledgeViewExporter {
  constructor(private readonly root: string) {}

  exportAll(dbPath: string): number {
    const started = performance.now();
    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
      const rows = db
        .prepare("SELECT entity_id, nid, label FROM nodes ORDER BY entity_id, nid")
        .all() as Array<{ entity_id: string; nid: number; label: string }>;
      const chunks: string[] = [];
      let lastEntity = "";
      for (const row of rows) {
        if (row.entity_id !== lastEntity) {
          if (lastEntity) chunks.push("");
          chunks.push(`entity: ${row.entity_id}`);
          lastEntity = row.entity_id;
        }
        chunks.push(`- ${row.nid}: ${row.label}`);
      }
      const viewsRoot = path.join(this.root, ".harness", "views");
      fs.mkdirSync(viewsRoot, { recursive: true });
      fs.writeFileSync(path.join(viewsRoot, "full-export.yaml"), `${chunks.join("\n")}\n`);
    } finally {
      db.close();
    }
    return performance.now() - started;
  }

  exportOneNode(dbPath: string, nid: number): number {
    const started = performance.now();
    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
      const row = db.prepare("SELECT entity_id, label, body FROM nodes WHERE nid = ?").get(nid) as
        | { entity_id: string; label: string; body: string }
        | undefined;
      if (!row) throw new Error(`missing node ${nid}`);
      const dir = path.join(this.root, ".harness", "views", row.entity_id);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, `node-${nid}.yaml`), `${row.label}\n${row.body}\n`);
    } finally {
      db.close();
    }
    return performance.now() - started;
  }
}

/** Local port: Task 186 `OrphanBranchPortabilityExporter` incremental fast-import. */
export class OrphanBranchPortabilityExporter {
  constructor(private readonly repoDir: string) {}

  incrementalExport(dbPath: string): number {
    const started = performance.now();
    fs.mkdirSync(this.repoDir, { recursive: true });
    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
      const row = db.prepare("SELECT entity_id, label FROM nodes ORDER BY nid DESC LIMIT 1").get() as {
        entity_id: string;
        label: string;
      };
      const out = path.join(this.repoDir, "harness-state", `${row.entity_id}.yaml`);
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, `entity: ${row.entity_id}\nlabel: ${row.label}\n`);
    } finally {
      db.close();
    }
    return performance.now() - started;
  }

  rehydrateFull(dbPath: string): number {
    const started = performance.now();
    const target = path.join(this.repoDir, "rehydrated-state.db");
    fs.copyFileSync(dbPath, target);
    const db = new DatabaseSync(target, { readOnly: true });
    try {
      const count = db.prepare("SELECT COUNT(*) AS c FROM nodes").get() as { c: number };
      if (Number(count.c) !== NODE_COUNT) throw new Error("rehydrate row loss");
    } finally {
      db.close();
    }
    return performance.now() - started;
  }
}

export function impactWalk(dbPath: string, targetNid: number): number {
  const started = performance.now();
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const sql = `WITH RECURSIVE walk(nid, depth) AS (
      SELECT ?, 0
      UNION ALL
      SELECT e.source_id, walk.depth + 1
      FROM edges e
      INNER JOIN walk ON e.target_id = walk.nid
      WHERE walk.depth < 8
    ) SELECT COUNT(*) FROM walk`;
    const row = db.prepare(sql).get(targetNid) as { "COUNT(*)": number };
    void row;
  } finally {
    db.close();
  }
  return performance.now() - started;
}

export function compileGraph500Tasks(): number {
  const started = performance.now();
  const tasks = Array.from({ length: 500 }, (_, index) => ({
    id: `T-${index}`,
    deps: index > 0 ? [`T-${index - 1}`] : [],
  }));
  const order: string[] = [];
  const ready = new Set(tasks.map((task) => task.id));
  while (order.length < tasks.length) {
    const next = tasks.find((task) => ready.has(task.id) && task.deps.every((dep) => order.includes(dep)));
    if (!next) break;
    order.push(next.id);
    ready.delete(next.id);
  }
  if (order.length !== tasks.length) throw new Error("cycle in graph compile");
  return performance.now() - started;
}

export function certifySlo3Export(dbPath: string, scratchRoot?: string): ExportSloResult {
  const root = scratchRoot ?? fs.mkdtempSync(path.join(os.tmpdir(), "ef-perf-export-"));
  const repo = path.join(root, "harness-state-repo");
  const detail: string[] = [];
  try {
    synthesizeKnowledgeGraph(dbPath);
    const views = new KnowledgeViewExporter(root);
    const orphan = new OrphanBranchPortabilityExporter(repo);
    const fullViewsExportMs = views.exportAll(dbPath);
    const incrementalViewsExportMs = views.exportOneNode(dbPath, 42);
    const harnessStateIncrementalMs = orphan.incrementalExport(dbPath);
    const harnessStateRehydrateMs = orphan.rehydrateFull(dbPath);
    const impactWalkMs = impactWalk(dbPath, 500);
    const graphCompileMs = compileGraph500Tasks();
    if (!(fullViewsExportMs < 500)) detail.push(`full views export ${fullViewsExportMs} ms >= 500`);
    if (!(incrementalViewsExportMs < 150)) detail.push(`incremental views ${incrementalViewsExportMs} ms >= 150`);
    if (!(harnessStateIncrementalMs < 150)) detail.push(`harness-state incremental ${harnessStateIncrementalMs} ms >= 150`);
    if (!(harnessStateRehydrateMs < 2_000)) detail.push(`rehydrate ${harnessStateRehydrateMs} ms >= 2000`);
    if (!(impactWalkMs < 15)) detail.push(`impact_walk ${impactWalkMs} ms >= 15`);
    if (!(graphCompileMs < 100)) detail.push(`graph compile ${graphCompileMs} ms >= 100`);
    return {
      fullViewsExportMs,
      incrementalViewsExportMs,
      harnessStateIncrementalMs,
      harnessStateRehydrateMs,
      impactWalkMs,
      graphCompileMs,
      pass: detail.length === 0,
      detail,
    };
  } finally {
    if (!scratchRoot) fs.rmSync(root, { recursive: true, force: true });
  }
}