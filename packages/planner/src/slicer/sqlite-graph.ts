import { DatabaseSync, type SQLOutputValue } from "node:sqlite";
import { hashCanonical } from "./canonical.js";
import { compareText } from "./tokens.js";
import {
  fieldString,
  fieldStrings,
  normalizeLevel,
  type Json,
  type ModuleCardRecord,
  type SliceEdge,
  type SliceGraph,
  type SliceNode,
  type WorkerLevel,
} from "./types.js";

export const SLICE_DDL = `
CREATE TABLE nodes (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  version INTEGER NOT NULL,
  content_hash TEXT NOT NULL,
  title TEXT NOT NULL,
  text TEXT NOT NULL DEFAULT '',
  fields TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'active'
);
CREATE TABLE node_versions (
  id TEXT NOT NULL,
  version INTEGER NOT NULL,
  kind TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  title TEXT NOT NULL,
  text TEXT NOT NULL,
  fields TEXT NOT NULL,
  status TEXT NOT NULL,
  PRIMARY KEY (id, version)
);
CREATE TABLE edges (
  src TEXT NOT NULL,
  type TEXT NOT NULL,
  dst TEXT NOT NULL,
  dst_version_pin INTEGER,
  valid_to_rev INTEGER,
  PRIMARY KEY (src, type, dst)
);
CREATE TABLE task_runtime (
  task TEXT PRIMARY KEY,
  feature TEXT NOT NULL,
  state TEXT NOT NULL,
  level TEXT NOT NULL,
  epoch INTEGER NOT NULL DEFAULT 0,
  base_branch TEXT NOT NULL DEFAULT 'harness/integration',
  base_commit TEXT NOT NULL DEFAULT 'pinned'
);
CREATE TABLE task_scopes (
  task TEXT NOT NULL,
  path_prefix TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'write',
  PRIMARY KEY (task, path_prefix, mode)
);
CREATE TABLE module_cards (
  path TEXT NOT NULL,
  file_hash TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (path, file_hash)
);
CREATE TABLE attempts (
  id TEXT PRIMARY KEY,
  task TEXT NOT NULL,
  brief_version INTEGER NOT NULL
);
CREATE TABLE read_sets (
  attempt TEXT NOT NULL,
  node TEXT NOT NULL,
  version INTEGER NOT NULL,
  hash TEXT NOT NULL,
  how TEXT NOT NULL,
  PRIMARY KEY (attempt, node, version)
);
CREATE TABLE slicer_brief_manifests (
  attempt_id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  level TEXT NOT NULL,
  brief_text TEXT NOT NULL,
  manifest_json TEXT NOT NULL,
  slice_sha256 TEXT NOT NULL
);
`;

export function createSliceDatabase(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(SLICE_DDL);
  return db;
}

export function contentHashFor(node: Pick<SliceNode, "title" | "text" | "fields">): string {
  return hashCanonical({
    fields: fieldsCanonical(node.fields),
    text: node.text,
    title: node.title,
  });
}

export class SqliteSliceGraph {
  readonly source = "local-port:task-017" as const;

  constructor(private readonly db: DatabaseSync) {}

  neighborhood(taskId: string): SliceGraph {
    const nodes = (
      this.db
        .prepare(
          `SELECT id, kind, version, content_hash, title, text, fields, status
         FROM nodes`,
        )
        .all() as Record<string, SQLOutputValue>[]
    ).map(rowToNode);
    const edges = (
      this.db
        .prepare(
          `SELECT src, type, dst, dst_version_pin
         FROM edges
         WHERE valid_to_rev IS NULL`,
        )
        .all() as Record<string, SQLOutputValue>[]
    ).map(rowToEdge);
    const task = nodes.find((node) => node.id === taskId);
    if (!task) throw new Error(`missing task node ${taskId}`);
    const runtime = this.db
      .prepare(
        `SELECT feature, level, epoch, base_branch, base_commit
         FROM task_runtime WHERE task = ?`,
      )
      .get(taskId) as Record<string, SQLOutputValue> | undefined;
    const level = normalizeLevel(text(runtime?.level) || fieldString(task.fields, "level") || "junior");
    const featureId = text(runtime?.feature) || fieldString(task.fields, "feature");
    const scopes = this.db
      .prepare(`SELECT path_prefix, mode FROM task_scopes WHERE task = ?`)
      .all(taskId) as Record<string, SQLOutputValue>[];
    const writeFromTable = scopes
      .filter((row) => text(row.mode) !== "read")
      .map((row) => text(row.path_prefix));
    const readFromTable = scopes.filter((row) => text(row.mode) === "read").map((row) => text(row.path_prefix));
    const writeScope = unique([...writeFromTable, ...fieldStrings(task.fields, "writeScope")]);
    const readScope = unique([...readFromTable, ...fieldStrings(task.fields, "readScope")]);
    const moduleCards = this.readModuleCards();
    return {
      taskId,
      nodes,
      edges,
      writeScope,
      readScope,
      moduleCards,
      level,
      featureId,
      baseBranch: text(runtime?.base_branch) || fieldString(task.fields, "baseBranch") || "harness/integration",
      baseCommit: text(runtime?.base_commit) || fieldString(task.fields, "baseCommit") || "pinned",
      epoch: integer(runtime?.epoch),
    };
  }

  getNode(id: string): SliceNode | null {
    const row = this.db
      .prepare(
        `SELECT id, kind, version, content_hash, title, text, fields, status
         FROM nodes WHERE id = ?`,
      )
      .get(id) as Record<string, SQLOutputValue> | undefined;
    return row ? rowToNode(row) : null;
  }

  getNodeAsOf(id: string, version: number): SliceNode | null {
    const row = this.db
      .prepare(
        `SELECT id, kind, version, content_hash, title, text, fields, status
         FROM node_versions WHERE id = ? AND version = ?`,
      )
      .get(id, version) as Record<string, SQLOutputValue> | undefined;
    return row ? rowToNode(row) : null;
  }

  private readModuleCards(): ModuleCardRecord[] {
    const columns = this.db
      .prepare(`SELECT name FROM pragma_table_info('module_cards')`)
      .all() as Record<string, SQLOutputValue>[];
    const names = new Set(columns.map((row) => text(row.name)));
    if (!names.has("summary")) return [];
    return (this.db.prepare(`SELECT path, file_hash, summary FROM module_cards`).all() as Record<string, SQLOutputValue>[]).map(
      (row) => ({
        path: text(row.path),
        fileHash: text(row.file_hash),
        summary: text(row.summary),
      }),
    );
  }
}

export interface NodeDraft {
  readonly id: string;
  readonly kind: string;
  readonly version?: number;
  readonly title: string;
  readonly text?: string;
  readonly fields?: Readonly<Record<string, Json>>;
  readonly status?: string;
  readonly contentHash?: string;
}

export function insertNode(db: DatabaseSync, draft: NodeDraft): SliceNode {
  const node: SliceNode = {
    id: draft.id,
    kind: draft.kind,
    version: draft.version ?? 1,
    title: draft.title,
    text: draft.text ?? "",
    status: draft.status ?? "active",
    fields: draft.fields ?? {},
    contentHash: "",
  };
  const contentHash = draft.contentHash ?? contentHashFor(node);
  const stored: SliceNode = { ...node, contentHash };
  const fields = JSON.stringify(stored.fields);
  db.prepare(
    `INSERT INTO nodes (id, kind, version, content_hash, title, text, fields, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(stored.id, stored.kind, stored.version, stored.contentHash, stored.title, stored.text, fields, stored.status);
  db.prepare(
    `INSERT INTO node_versions (id, version, kind, content_hash, title, text, fields, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(stored.id, stored.version, stored.kind, stored.contentHash, stored.title, stored.text, fields, stored.status);
  return stored;
}

export function reviseNode(db: DatabaseSync, id: string, text: string): SliceNode {
  const current = new SqliteSliceGraph(db).getNode(id);
  if (!current) throw new Error(`missing node ${id}`);
  const next: SliceNode = {
    ...current,
    version: current.version + 1,
    text,
    contentHash: contentHashFor({ ...current, text }),
  };
  const fields = JSON.stringify(next.fields);
  db.prepare(
    `UPDATE nodes
     SET version = ?, content_hash = ?, text = ?
     WHERE id = ?`,
  ).run(next.version, next.contentHash, next.text, next.id);
  db.prepare(
    `INSERT INTO node_versions (id, version, kind, content_hash, title, text, fields, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(next.id, next.version, next.kind, next.contentHash, next.title, next.text, fields, next.status);
  return next;
}

export function insertEdge(
  db: DatabaseSync,
  edge: { src: string; type: string; dst: string; dstVersionPin?: number | null },
): void {
  db.prepare(
    `INSERT INTO edges (src, type, dst, dst_version_pin, valid_to_rev)
     VALUES (?, ?, ?, ?, NULL)`,
  ).run(edge.src, edge.type, edge.dst, edge.dstVersionPin ?? null);
}

export function insertRuntime(
  db: DatabaseSync,
  runtime: {
    task: string;
    feature: string;
    level?: WorkerLevel | string;
    state?: string;
    epoch?: number;
    baseBranch?: string;
    baseCommit?: string;
  },
): void {
  db.prepare(
    `INSERT INTO task_runtime (task, feature, state, level, epoch, base_branch, base_commit)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    runtime.task,
    runtime.feature,
    runtime.state ?? "READY",
    runtime.level ?? "junior",
    runtime.epoch ?? 1,
    runtime.baseBranch ?? "harness/integration",
    runtime.baseCommit ?? "pinned",
  );
}

export function insertScope(db: DatabaseSync, task: string, pathPrefix: string, mode: "write" | "read" = "write"): void {
  db.prepare(`INSERT INTO task_scopes (task, path_prefix, mode) VALUES (?, ?, ?)`).run(task, pathPrefix, mode);
}

export function insertModuleCard(db: DatabaseSync, card: ModuleCardRecord): void {
  db.prepare(`INSERT INTO module_cards (path, file_hash, summary) VALUES (?, ?, ?)`).run(card.path, card.fileHash, card.summary);
}

export function insertAttempt(db: DatabaseSync, attempt: { id: string; task: string; briefVersion: number }): void {
  db.prepare(`INSERT INTO attempts (id, task, brief_version) VALUES (?, ?, ?)`).run(attempt.id, attempt.task, attempt.briefVersion);
}

function rowToNode(row: Record<string, SQLOutputValue>): SliceNode {
  return {
    id: text(row.id),
    kind: text(row.kind),
    version: integer(row.version),
    contentHash: text(row.content_hash),
    title: text(row.title),
    text: text(row.text),
    status: text(row.status),
    fields: parseFields(text(row.fields)),
  };
}

function rowToEdge(row: Record<string, SQLOutputValue>): SliceEdge {
  const pin = row.dst_version_pin;
  return {
    src: text(row.src),
    type: text(row.type),
    dst: text(row.dst),
    dstVersionPin: typeof pin === "number" ? pin : typeof pin === "bigint" ? Number(pin) : null,
  };
}

function parseFields(raw: string): Readonly<Record<string, Json>> {
  if (!raw) return {};
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  return parsed as Record<string, Json>;
}

function fieldsCanonical(fields: Readonly<Record<string, Json>>): { readonly [key: string]: import("./canonical.js").Canonical } {
  const sorted: { [key: string]: import("./canonical.js").Canonical } = {};
  for (const key of Object.keys(fields).sort(compareText)) {
    sorted[key] = toCanonical(fields[key] ?? null);
  }
  return sorted;
}

function toCanonical(value: Json): import("./canonical.js").Canonical {
  if (value === null || typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "number") return Number.isInteger(value) ? value : Math.trunc(value);
  if (Array.isArray(value)) return value.map((entry) => toCanonical(entry));
  const record = value as Readonly<Record<string, Json>>;
  const sorted: { [key: string]: import("./canonical.js").Canonical } = {};
  for (const key of Object.keys(record).sort(compareText)) {
    sorted[key] = toCanonical(record[key] ?? null);
  }
  return sorted;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))].sort(compareText);
}

function text(value: SQLOutputValue | undefined): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "bigint") return String(value);
  return "";
}

function integer(value: SQLOutputValue | undefined): number {
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  return 0;
}
