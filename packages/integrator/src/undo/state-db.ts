import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { openSharedStateFile } from "../shared-state.js";
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

const CHANGE_SET = "CS-UNDO";

const FEATURE_STATES = new Set([
  "PLANNED",
  "JIT_READY",
  "IN_WAVE",
  "LEAVES_MERGED",
  "WIRED",
  "JOURNEY_PASSED",
  "QUEUED_FOR_MERGE",
  "MERGED",
  "DONE",
  "BLOCKED",
  "REOPENED",
  "DEFERRED",
  "ABANDONED",
  "UNDONE",
]);

/**
 * Features live on canonical nodes plus feature_runtime.
 * `nodes.status` has no `undone` value, so an archived feature is `retired`
 * with feature_runtime state `UNDONE`. The public nodeStatus stays `undone`.
 * Inbox questions stay on undo_inbox: canonical inbox_items cannot store `retired`.
 * Usage edges stay on undo_edges because `consumes` is not a canonical edge type.
 */
export class KnowledgeGraphPort {
  private constructor(private readonly db: UndoDb) {}

  static open(filePath: string): KnowledgeGraphPort {
    return new KnowledgeGraphPort(new UndoDb(openSharedStateFile(filePath)));
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
    this.writeFeature({
      featureId: input.featureId,
      title: input.title,
      lifecycle: input.lifecycle,
      nodeStatus: "active",
      runtimeState: runtimeStateFor(input.lifecycle),
      branch: input.branch,
      mergeSha: input.mergeSha ?? existing?.mergeSha ?? "",
      specs: input.specs ?? existing?.specs ?? "",
      decisions: input.decisions ?? existing?.decisions ?? [],
      taskIds: input.taskIds ?? existing?.taskIds ?? [],
      landed: input.landed,
      previousLifecycle: existing?.previousLifecycle ?? "",
    });
    const stored = this.getFeature(input.featureId);
    if (!stored) throw new UndoError("feature_missing", input.featureId);
    return stored;
  }

  getFeature(featureId: string): FeatureRecord | null {
    const row = this.db.get(`${FEATURE_SELECT} WHERE n.id = ? AND n.kind = 'feature'`, [featureId]);
    return row ? featureFromRow(row) : null;
  }

  listFeatures(): FeatureRecord[] {
    return this.db.all(`${FEATURE_SELECT} WHERE n.kind = 'feature' ORDER BY n.id`, []).map(featureFromRow);
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
    this.writeFeature({
      ...current,
      lifecycle: "undone",
      nodeStatus: "retired",
      runtimeState: "UNDONE",
      previousLifecycle: current.lifecycle,
    });
  }

  revive(featureId: string): FeatureRecord {
    const current = this.getFeature(featureId);
    if (!current) throw new UndoError("feature_missing", featureId);
    if (current.nodeStatus !== "undone") {
      throw new UndoError("not_undone", `${featureId} is ${current.nodeStatus}, not archived as undone.`);
    }
    this.writeFeature({
      ...current,
      lifecycle: "active",
      nodeStatus: "active",
      runtimeState: "REOPENED",
    });
    const revived = this.getFeature(featureId);
    if (!revived) throw new UndoError("feature_missing", featureId);
    return revived;
  }

  private writeFeature(input: {
    readonly featureId: string;
    readonly title: string;
    readonly lifecycle: string;
    readonly nodeStatus: "active" | "retired";
    readonly runtimeState: string;
    readonly branch: string;
    readonly mergeSha: string;
    readonly specs: string;
    readonly decisions: readonly string[];
    readonly taskIds: readonly string[];
    readonly landed: boolean;
    readonly previousLifecycle: string;
  }): void {
    this.ensureChangeSet();
    const fields = JSON.stringify({
      feature: input.featureId,
      lifecycle: input.lifecycle,
      branch: input.branch,
      mergeSha: input.mergeSha,
      specs: input.specs,
      decisions: [...input.decisions],
      tasks: [...input.taskIds],
      landed: input.landed,
      previousLifecycle: input.previousLifecycle,
    });
    const hash = createHash("sha256").update(`${input.title}\n${fields}`).digest("hex");
    const current = this.db.get("SELECT version FROM nodes WHERE id = ?", [input.featureId]);
    if (!current) {
      this.db.run(
        `INSERT INTO nodes (id, kind, version, content_hash, title, text, fields, status, change_set, created_rev, updated_rev)
         VALUES (?, 'feature', 1, ?, ?, ?, ?, ?, ?, 1, 1)`,
        [input.featureId, hash, input.title, input.specs, fields, input.nodeStatus, CHANGE_SET],
      );
      this.db.run(
        `INSERT INTO feature_runtime (feature, state, epoch, branch, updated_rev) VALUES (?, ?, 1, ?, 1)`,
        [input.featureId, input.runtimeState, input.branch],
      );
      return;
    }
    const version = sqlNumber(current, "version") + 1;
    this.db.run(
      `UPDATE nodes
       SET version = ?, content_hash = ?, title = ?, text = ?, fields = ?, status = ?, updated_rev = ?
       WHERE id = ?`,
      [version, hash, input.title, input.specs, fields, input.nodeStatus, version, input.featureId],
    );
    this.db.run(
      `INSERT INTO feature_runtime (feature, state, epoch, branch, updated_rev)
       VALUES (?, ?, 1, ?, ?)
       ON CONFLICT(feature) DO UPDATE SET
         state = excluded.state,
         branch = excluded.branch,
         updated_rev = excluded.updated_rev`,
      [input.featureId, input.runtimeState, input.branch, version],
    );
  }

  private ensureChangeSet(): void {
    this.db.run(
      `INSERT INTO change_sets (id, rev, origin, origin_ref, author, created_at, summary)
       VALUES (?, NULL, 'undo', 'feature-undo', 'feature-undo', ?, 'feature undo archival')
       ON CONFLICT(id) DO NOTHING`,
      [CHANGE_SET, Date.now()],
    );
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

const FEATURE_SELECT = `
SELECT n.id AS feature_id, n.title, n.status AS node_status, n.fields, COALESCE(r.state, '') AS runtime_state
FROM nodes n
LEFT JOIN feature_runtime r ON r.feature = n.id
`;

function featureFromRow(row: Readonly<Record<string, SqlValue>>): FeatureRecord {
  const fields = parseFields(sqlText(row, "fields"));
  const retired = sqlText(row, "node_status") === "retired";
  const undone = retired && sqlText(row, "runtime_state") === "UNDONE";
  return {
    featureId: sqlText(row, "feature_id"),
    title: sqlText(row, "title"),
    lifecycle: fieldText(fields, "lifecycle"),
    nodeStatus: undone ? "undone" : "active",
    branch: fieldText(fields, "branch"),
    mergeSha: fieldText(fields, "mergeSha"),
    specs: fieldText(fields, "specs"),
    decisions: stringArray(fields.decisions),
    taskIds: stringArray(fields.tasks),
    landed: fields.landed === true,
    previousLifecycle: fieldText(fields, "previousLifecycle"),
  };
}

function runtimeStateFor(lifecycle: string): string {
  if (FEATURE_STATES.has(lifecycle)) return lifecycle;
  if (lifecycle === "active") return "REOPENED";
  if (lifecycle === "undone") return "UNDONE";
  return "PLANNED";
}

function parseFields(text: string): Record<string, unknown> {
  try {
    const value = JSON.parse(text) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return value as Record<string, unknown>;
  } catch {
    return {};
  }
}

function fieldText(fields: Record<string, unknown>, key: string): string {
  const value = fields[key];
  return typeof value === "string" ? value : "";
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
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

const SEARCH_STOP = new Set(["add", "the", "back", "page", "actually", "bring", "view", "please", "feature", "this", "that", "with"]);

function searchTokens(text: string): string[] {
  const tokens = text
    .toLowerCase()
    .split(/[^a-z0-9-]+/)
    .filter((token) => token.length >= 4 && !SEARCH_STOP.has(token));
  return [...new Set(tokens)];
}
