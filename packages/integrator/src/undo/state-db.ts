import { DatabaseSync } from "node:sqlite";
import { UndoError } from "./errors.js";
import type {
  FeatureRecord,
  FeatureRegistration,
  InboxQuestion,
  OwnershipRecord,
  UsageEdge,
  UsageEdgeType,
  WorkerRecord,
} from "./types.js";

export type SqlValue = null | number | string | bigint | Uint8Array;

const DDL = `
CREATE TABLE IF NOT EXISTS undo_nodes (
  feature_id          TEXT PRIMARY KEY,
  title               TEXT NOT NULL,
  lifecycle           TEXT NOT NULL,
  node_status         TEXT NOT NULL,
  branch              TEXT NOT NULL,
  merge_sha           TEXT NOT NULL DEFAULT '',
  specs               TEXT NOT NULL DEFAULT '',
  decisions_json      TEXT NOT NULL DEFAULT '[]',
  tasks_json          TEXT NOT NULL DEFAULT '[]',
  landed              INTEGER NOT NULL DEFAULT 0,
  previous_lifecycle  TEXT NOT NULL DEFAULT ''
) STRICT;

CREATE TABLE IF NOT EXISTS undo_edges (
  src           TEXT NOT NULL,
  type          TEXT NOT NULL,
  dst           TEXT NOT NULL,
  artifact_path TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (src, type, dst, artifact_path)
) STRICT, WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS undo_inbox (
  id          TEXT PRIMARY KEY,
  feature_id  TEXT NOT NULL,
  exclusive   INTEGER NOT NULL,
  status      TEXT NOT NULL,
  text        TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS undo_workers (
  id          TEXT PRIMARY KEY,
  feature_id  TEXT NOT NULL,
  pid         INTEGER NOT NULL,
  halted      INTEGER NOT NULL DEFAULT 0
) STRICT;

CREATE TABLE IF NOT EXISTS undo_ownership (
  path              TEXT PRIMARY KEY,
  owner_feature_id  TEXT NOT NULL,
  previous_owner    TEXT NOT NULL,
  transferred_at    INTEGER NOT NULL
) STRICT, WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS ref_leases (
  ref          TEXT PRIMARY KEY,
  holder       TEXT NOT NULL,
  epoch        INTEGER NOT NULL,
  expected_sha TEXT,
  expires_at   INTEGER
) STRICT, WITHOUT ROWID;
`;

/**
 * Local port of Task 017 `KnowledgeGraphRepo`.
 * Frozen `schema/state.sql` cannot store node status `undone` (nodes.status and
 * feature_states are closed lists). Undo archival lives in this runtime database
 * until a schema change accepts `undone` while preserving `feature_id`.
 * Usage edges accept the task vocabulary `consumes` plus the frozen name
 * `consumes_contract`, and `depends_on` / `implements`.
 */
export class KnowledgeGraphPort {
  private constructor(private readonly db: UndoDb) {}

  static open(filePath: string): KnowledgeGraphPort {
    const sqlite = new DatabaseSync(filePath);
    sqlite.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = FULL;
      PRAGMA foreign_keys = ON;
      PRAGMA busy_timeout = 5000;
    `);
    sqlite.exec(DDL);
    return new KnowledgeGraphPort(new UndoDb(sqlite));
  }

  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn);
  }

  get(sql: string, params: readonly SqlValue[]): Readonly<Record<string, SqlValue>> | undefined {
    return this.db.get(sql, params);
  }

  all(sql: string, params: readonly SqlValue[]): readonly Readonly<Record<string, SqlValue>>[] {
    return this.db.all(sql, params);
  }

  run(sql: string, params: readonly SqlValue[]): number {
    return this.db.run(sql, params);
  }

  registerFeature(input: FeatureRegistration): FeatureRecord {
    const existing = this.getFeature(input.featureId);
    const decisions = JSON.stringify(input.decisions ?? existing?.decisions ?? []);
    const tasks = JSON.stringify(input.taskIds ?? existing?.taskIds ?? []);
    this.db.run(
      `INSERT INTO undo_nodes (
         feature_id, title, lifecycle, node_status, branch, merge_sha, specs, decisions_json, tasks_json, landed, previous_lifecycle
       ) VALUES (?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, '')
       ON CONFLICT(feature_id) DO UPDATE SET
         title = excluded.title,
         lifecycle = excluded.lifecycle,
         node_status = 'active',
         branch = excluded.branch,
         merge_sha = excluded.merge_sha,
         specs = excluded.specs,
         decisions_json = excluded.decisions_json,
         tasks_json = excluded.tasks_json,
         landed = excluded.landed`,
      [
        input.featureId,
        input.title,
        input.lifecycle,
        input.branch,
        input.mergeSha ?? existing?.mergeSha ?? "",
        input.specs ?? existing?.specs ?? "",
        decisions,
        tasks,
        input.landed ? 1 : 0,
      ],
    );
    const stored = this.getFeature(input.featureId);
    if (!stored) throw new UndoError("feature_missing", input.featureId);
    return stored;
  }

  getFeature(featureId: string): FeatureRecord | null {
    const row = this.db.get("SELECT * FROM undo_nodes WHERE feature_id = ?", [featureId]);
    return row ? rowToFeature(row) : null;
  }

  listFeatures(): FeatureRecord[] {
    return this.db.all("SELECT * FROM undo_nodes ORDER BY feature_id", []).map(rowToFeature);
  }

  addEdge(edge: UsageEdge): void {
    this.db.run(
      `INSERT INTO undo_edges (src, type, dst, artifact_path) VALUES (?, ?, ?, ?)
       ON CONFLICT(src, type, dst, artifact_path) DO NOTHING`,
      [edge.src, edge.type, edge.dst, edge.artifactPath],
    );
  }

  listEdges(): UsageEdge[] {
    return this.db.all("SELECT src, type, dst, artifact_path FROM undo_edges", []).map((row) => ({
      src: sqlText(row, "src"),
      type: sqlText(row, "type") as UsageEdgeType,
      dst: sqlText(row, "dst"),
      artifactPath: sqlText(row, "artifact_path"),
    }));
  }

  addInbox(question: InboxQuestion): void {
    this.db.run(
      `INSERT INTO undo_inbox (id, feature_id, exclusive, status, text) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET feature_id = excluded.feature_id, exclusive = excluded.exclusive, status = excluded.status, text = excluded.text`,
      [question.id, question.featureId, question.exclusive ? 1 : 0, question.status, question.text],
    );
  }

  listInbox(featureId?: string): InboxQuestion[] {
    const rows = featureId
      ? this.db.all("SELECT * FROM undo_inbox WHERE feature_id = ? ORDER BY id", [featureId])
      : this.db.all("SELECT * FROM undo_inbox ORDER BY id", []);
    return rows.map(rowToInbox);
  }

  addWorker(worker: { id: string; featureId: string; pid: number }): void {
    this.db.run(
      `INSERT INTO undo_workers (id, feature_id, pid, halted) VALUES (?, ?, ?, 0)
       ON CONFLICT(id) DO UPDATE SET feature_id = excluded.feature_id, pid = excluded.pid`,
      [worker.id, worker.featureId, worker.pid],
    );
  }

  listWorkers(featureId: string): WorkerRecord[] {
    return this.db.all("SELECT * FROM undo_workers WHERE feature_id = ? ORDER BY id", [featureId]).map(rowToWorker);
  }

  haltWorkers(featureId: string): string[] {
    const open = this.listWorkers(featureId).filter((worker) => !worker.halted);
    this.db.run("UPDATE undo_workers SET halted = 1 WHERE feature_id = ?", [featureId]);
    return open.map((worker) => worker.id);
  }

  retireExclusiveInbox(featureId: string): string[] {
    const open = this.listInbox(featureId).filter((item) => item.exclusive && item.status === "open");
    this.db.run("UPDATE undo_inbox SET status = 'retired' WHERE feature_id = ? AND exclusive = 1 AND status = 'open'", [
      featureId,
    ]);
    return open.map((item) => item.id);
  }

  transferOwnership(path: string, ownerFeatureId: string, previousOwner: string, at: number): void {
    this.db.run(
      `INSERT INTO undo_ownership (path, owner_feature_id, previous_owner, transferred_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(path) DO UPDATE SET owner_feature_id = excluded.owner_feature_id, previous_owner = excluded.previous_owner, transferred_at = excluded.transferred_at`,
      [path, ownerFeatureId, previousOwner, at],
    );
  }

  listOwnership(): OwnershipRecord[] {
    return this.db.all("SELECT path, owner_feature_id, previous_owner FROM undo_ownership ORDER BY path", []).map((row) => ({
      path: sqlText(row, "path"),
      ownerFeatureId: sqlText(row, "owner_feature_id"),
      previousOwner: sqlText(row, "previous_owner"),
    }));
  }

  markUndone(featureId: string): void {
    const current = this.getFeature(featureId);
    if (!current) throw new UndoError("feature_missing", featureId);
    this.db.run(
      `UPDATE undo_nodes
       SET previous_lifecycle = lifecycle, lifecycle = 'undone', node_status = 'undone'
       WHERE feature_id = ?`,
      [featureId],
    );
  }

  revive(featureId: string): FeatureRecord {
    const current = this.getFeature(featureId);
    if (!current) throw new UndoError("feature_missing", featureId);
    if (current.nodeStatus !== "undone") {
      throw new UndoError("not_undone", `${featureId} is ${current.nodeStatus}, not archived as undone.`);
    }
    this.db.run("UPDATE undo_nodes SET lifecycle = 'active', node_status = 'active' WHERE feature_id = ?", [featureId]);
    const revived = this.getFeature(featureId);
    if (!revived) throw new UndoError("feature_missing", featureId);
    return revived;
  }

  findUndoneByText(text: string): FeatureRecord | null {
    const tokens = searchTokens(text);
    let best: FeatureRecord | null = null;
    let bestScore = 0;
    for (const feature of this.listFeatures()) {
      if (feature.nodeStatus !== "undone") continue;
      const haystack = `${feature.featureId} ${feature.title} ${feature.specs} ${feature.decisions.join(" ")}`.toLowerCase();
      let score = 0;
      for (const token of tokens) {
        if (haystack.includes(token)) score += token.length;
      }
      if (score > bestScore) {
        best = feature;
        bestScore = score;
      }
    }
    return best;
  }

  close(): void {
    this.db.close();
  }
}

export class UndoDb {
  constructor(private readonly db: DatabaseSync) {}

  transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const value = fn();
      this.db.exec("COMMIT");
      return value;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  get(sql: string, params: readonly SqlValue[]): Readonly<Record<string, SqlValue>> | undefined {
    const row = this.db.prepare(sql).get(...params);
    if (!row || typeof row !== "object") return undefined;
    return normalizeRow(row as Record<string, unknown>);
  }

  all(sql: string, params: readonly SqlValue[]): readonly Readonly<Record<string, SqlValue>>[] {
    return this.db
      .prepare(sql)
      .all(...params)
      .map((row) => normalizeRow(row as Record<string, unknown>));
  }

  run(sql: string, params: readonly SqlValue[]): number {
    const result = this.db.prepare(sql).run(...params);
    return typeof result.changes === "bigint" ? Number(result.changes) : result.changes;
  }

  close(): void {
    this.db.close();
  }
}

function normalizeRow(row: Record<string, unknown>): Readonly<Record<string, SqlValue>> {
  const normalized: Record<string, SqlValue> = {};
  for (const [key, value] of Object.entries(row)) {
    if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "bigint") {
      normalized[key] = value;
    } else if (value instanceof Uint8Array) {
      normalized[key] = value;
    } else if (typeof value === "boolean") {
      normalized[key] = value ? 1 : 0;
    } else {
      normalized[key] = value === undefined ? null : String(value);
    }
  }
  return normalized;
}

export function sqlText(row: Readonly<Record<string, SqlValue>> | undefined, key: string): string {
  const value = row?.[key];
  return typeof value === "string" ? value : value === undefined || value === null ? "" : String(value);
}

export function sqlNumber(row: Readonly<Record<string, SqlValue>> | undefined, key: string): number {
  const value = row?.[key];
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string" && value.trim() !== "") return Number(value);
  return 0;
}

function rowToFeature(row: Readonly<Record<string, SqlValue>>): FeatureRecord {
  return {
    featureId: sqlText(row, "feature_id"),
    title: sqlText(row, "title"),
    lifecycle: sqlText(row, "lifecycle"),
    nodeStatus: sqlText(row, "node_status"),
    branch: sqlText(row, "branch"),
    mergeSha: sqlText(row, "merge_sha"),
    specs: sqlText(row, "specs"),
    decisions: parseStringArray(sqlText(row, "decisions_json")),
    taskIds: parseStringArray(sqlText(row, "tasks_json")),
    landed: sqlNumber(row, "landed") === 1,
    previousLifecycle: sqlText(row, "previous_lifecycle"),
  };
}

function rowToInbox(row: Readonly<Record<string, SqlValue>>): InboxQuestion {
  const status = sqlText(row, "status") === "retired" ? "retired" : "open";
  return {
    id: sqlText(row, "id"),
    featureId: sqlText(row, "feature_id"),
    exclusive: sqlNumber(row, "exclusive") === 1,
    status,
    text: sqlText(row, "text"),
  };
}

function rowToWorker(row: Readonly<Record<string, SqlValue>>): WorkerRecord {
  return {
    id: sqlText(row, "id"),
    featureId: sqlText(row, "feature_id"),
    pid: sqlNumber(row, "pid"),
    halted: sqlNumber(row, "halted") === 1,
  };
}

function parseStringArray(text: string): string[] {
  try {
    const value = JSON.parse(text) as unknown;
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is string => typeof item === "string");
  } catch {
    return [];
  }
}

const SEARCH_STOP = new Set(["add", "the", "back", "page", "actually", "bring", "view", "please", "feature", "this", "that", "with"]);

function searchTokens(text: string): string[] {
  const tokens = text
    .toLowerCase()
    .split(/[^a-z0-9-]+/)
    .filter((token) => token.length >= 4 && !SEARCH_STOP.has(token));
  return [...new Set(tokens)];
}
