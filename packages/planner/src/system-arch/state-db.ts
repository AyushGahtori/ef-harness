import { createHash } from "node:crypto";
import fs from "node:fs";
import { DatabaseSync, type SQLInputValue, type SQLOutputValue } from "node:sqlite";
import { stateSchemaPath } from "./paths.js";

export interface GraphNode {
  readonly id: string;
  readonly kind: string;
  readonly version: number;
  readonly title: string;
  readonly text: string;
  readonly fields: Readonly<Record<string, unknown>>;
  readonly status: string;
  readonly feature: string | null;
  readonly basis: string | null;
}

export interface GraphEdge {
  readonly src: string;
  readonly type: string;
  readonly dst: string;
}

export interface NameRecord {
  readonly kind: string;
  readonly value: string;
  readonly ownerNode: string;
  readonly feature: string | null;
}

export interface NodeDraft {
  readonly id: string;
  readonly kind: string;
  readonly title: string;
  readonly text?: string;
  readonly fields: Readonly<Record<string, unknown>>;
  readonly status?: "draft" | "active" | "retired" | "superseded";
  readonly ownerRole?: string | null;
}

export interface EdgeDraft {
  readonly src: string;
  readonly type: string;
  readonly dst: string;
}

export interface ChangeSetDraft {
  readonly author: string;
  readonly summary: string;
  readonly nodes?: readonly NodeDraft[];
  readonly edges?: readonly EdgeDraft[];
}

export interface CommitResult {
  readonly rev: number;
  readonly changeSetId: string;
}

/**
 * Local port of Task 017 `KnowledgeGraphRepo` and Task 019 `NameRegistryService`.
 * Writes the real `schema/state.sql` database with node:sqlite.
 */
export class ArchitectureStore {
  private inTransaction = false;

  private constructor(private readonly db: DatabaseSync) {}

  static open(location = ":memory:"): ArchitectureStore {
    const db = new DatabaseSync(location);
    db.exec("PRAGMA foreign_keys = ON");
    db.exec("PRAGMA busy_timeout = 5000");
    db.function("ef_search_text", { deterministic: true }, (value: SQLOutputValue) => splitSearchText(value));
    db.exec(fs.readFileSync(stateSchemaPath(), "utf8"));
    db.exec(
      "INSERT INTO meta(key, value) VALUES ('last_rev', '0'), ('skeleton_locked', 'false') ON CONFLICT(key) DO NOTHING",
    );
    db.exec(
      "INSERT INTO edge_types(type, invalidates) VALUES ('justified_by', 0), ('contradicts', 1) ON CONFLICT(type) DO NOTHING",
    );
    return new ArchitectureStore(db);
  }

  commitChangeSet(draft: ChangeSetDraft, now = Date.now()): CommitResult {
    this.begin();
    try {
      const rev = this.nextRev();
      const changeSetId = `CS-arch-${rev}`;
      this.db
        .prepare(
          "INSERT INTO change_sets(id, rev, origin, origin_ref, author, created_at, summary) VALUES (?, ?, 'planner', 'system-architect@1', ?, ?, ?)",
        )
        .run(changeSetId, rev, draft.author, now, draft.summary);
      for (const node of draft.nodes ?? []) {
        this.upsertNode(changeSetId, rev, node);
      }
      for (const edge of draft.edges ?? []) {
        this.ensureEdge(changeSetId, rev, edge);
      }
      this.db.prepare("UPDATE meta SET value = ? WHERE key = 'last_rev'").run(String(rev));
      this.commit();
      return { rev, changeSetId };
    } catch (error) {
      this.rollback();
      throw error;
    }
  }

  getNode(id: string): GraphNode | undefined {
    const row = this.db.prepare("SELECT * FROM nodes WHERE id = ?").get(id);
    return row ? toNode(row) : undefined;
  }

  listNodes(): GraphNode[] {
    return this.db.prepare("SELECT * FROM nodes ORDER BY id ASC").all().map((row) => toNode(row));
  }

  listEdges(): GraphEdge[] {
    return this.db
      .prepare(
        "SELECT src, type, dst FROM edges WHERE valid_to_rev IS NULL ORDER BY src ASC, type ASC, dst ASC",
      )
      .all()
      .map((row) => ({
        src: asText(row.src),
        type: asText(row.type),
        dst: asText(row.dst),
      }));
  }

  listNames(): NameRecord[] {
    return this.db
      .prepare("SELECT kind, value, owner_node, feature FROM names ORDER BY kind ASC, value ASC")
      .all()
      .map((row) => ({
        kind: asText(row.kind),
        value: asText(row.value),
        ownerNode: asText(row.owner_node),
        feature: row.feature === null || row.feature === undefined ? null : asText(row.feature),
      }));
  }

  relationsInFields(): string[] {
    return this.db
      .prepare(
        `SELECT id FROM nodes
          WHERE status = 'active'
            AND (fields ->> '$.depends_on' IS NOT NULL OR fields ->> '$.implements' IS NOT NULL
                 OR fields ->> '$.verifies' IS NOT NULL OR fields ->> '$.consumes' IS NOT NULL)
          ORDER BY id ASC`,
      )
      .all()
      .map((row) => asText(row.id));
  }

  countContradicts(): number {
    const row = this.db
      .prepare(
        `SELECT count(*) AS c FROM edges e
          WHERE e.type = 'contradicts' AND e.valid_to_rev IS NULL
            AND EXISTS (SELECT 1 FROM nodes s WHERE s.id = e.src AND s.status = 'active')
            AND EXISTS (SELECT 1 FROM nodes d WHERE d.id = e.dst AND d.status = 'active')`,
      )
      .get();
    return asNumber(row?.c);
  }

  getMeta(key: string): string | null {
    const row = this.db.prepare("SELECT value FROM meta WHERE key = ?").get(key);
    if (!row) return null;
    return asText(row.value);
  }

  setMeta(key: string, value: string): void {
    this.db
      .prepare("INSERT INTO meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run(key, value);
  }

  close(): void {
    this.db.close();
  }

  private upsertNode(changeSetId: string, rev: number, draft: NodeDraft): void {
    const title = draft.title.normalize("NFC");
    const text = (draft.text ?? "").normalize("NFC");
    const status = draft.status ?? "active";
    const fields = canonicalJson(draft.fields);
    const hash = contentHash(title, text, fields, status);
    const ownerRole = draft.ownerRole ?? null;
    const existing = this.db.prepare("SELECT version, content_hash, status FROM nodes WHERE id = ?").get(draft.id);
    if (!existing) {
      this.db
        .prepare(
          `INSERT INTO nodes(id, kind, version, content_hash, title, text, fields, status, owner_role, change_set, created_rev, updated_rev)
           VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(draft.id, draft.kind, hash, title, text, fields, status, ownerRole, changeSetId, rev, rev);
      this.db
        .prepare(
          "INSERT INTO node_changes(change_set, id, old_version, new_version, class) VALUES (?, ?, NULL, 1, 'created')",
        )
        .run(changeSetId, draft.id);
      return;
    }
    const version = asNumber(existing.version);
    if (asText(existing.content_hash) === hash && asText(existing.status) === status) return;
    const next = version + 1;
    this.db
      .prepare(
        `UPDATE nodes
            SET version = ?, content_hash = ?, title = ?, text = ?, fields = ?, status = ?, owner_role = ?, change_set = ?, updated_rev = ?
          WHERE id = ?`,
      )
      .run(next, hash, title, text, fields, status, ownerRole, changeSetId, rev, draft.id);
    this.db
      .prepare(
        "INSERT INTO node_changes(change_set, id, old_version, new_version, class) VALUES (?, ?, ?, ?, 'compatible')",
      )
      .run(changeSetId, draft.id, version, next);
  }

  private ensureEdge(changeSetId: string, rev: number, edge: EdgeDraft): void {
    const existing = this.db
      .prepare("SELECT 1 AS ok FROM edges WHERE src = ? AND type = ? AND dst = ? AND valid_to_rev IS NULL")
      .get(edge.src, edge.type, edge.dst);
    if (existing) return;
    this.db
      .prepare("INSERT INTO edges(src, type, dst, change_set, valid_from_rev) VALUES (?, ?, ?, ?, ?)")
      .run(edge.src, edge.type, edge.dst, changeSetId, rev);
  }

  private nextRev(): number {
    return asNumber(this.db.prepare("SELECT value FROM meta WHERE key = 'last_rev'").get()?.value) + 1;
  }

  private begin(): void {
    this.db.exec("BEGIN IMMEDIATE");
    this.inTransaction = true;
  }

  private commit(): void {
    this.db.exec("COMMIT");
    this.inTransaction = false;
  }

  private rollback(): void {
    if (!this.inTransaction) return;
    this.db.exec("ROLLBACK");
    this.inTransaction = false;
  }
}

export function openArchitectureStore(location = ":memory:"): ArchitectureStore {
  return ArchitectureStore.open(location);
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

export function contentHash(title: string, text: string, fields: string, status: string): string {
  const body = [title, text, fields, status].join("\n");
  return `sha256:${createHash("sha256").update(body).digest("hex")}`;
}

export function readString(fields: Readonly<Record<string, unknown>>, key: string): string | undefined {
  const value = fields[key];
  return typeof value === "string" ? value : undefined;
}

export function readStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => sortValue(item));
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
      left.localeCompare(right),
    );
    const sorted: Record<string, unknown> = {};
    for (const [key, inner] of entries) sorted[key] = sortValue(inner);
    return sorted;
  }
  return value;
}

function toNode(row: Record<string, SQLOutputValue>): GraphNode {
  const fields = JSON.parse(asText(row.fields)) as unknown;
  return {
    id: asText(row.id),
    kind: asText(row.kind),
    version: asNumber(row.version),
    title: asText(row.title),
    text: asText(row.text),
    fields: isFields(fields) ? fields : {},
    status: asText(row.status),
    feature: row.feature === null || row.feature === undefined ? null : asText(row.feature),
    basis: row.basis === null || row.basis === undefined ? null : asText(row.basis),
  };
}

function isFields(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function splitSearchText(value: SQLOutputValue): SQLInputValue {
  if (typeof value !== "string" || value.length === 0) return "";
  const extra = value.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_\-./:]+/g, " ");
  return `${value} ${extra}`;
}

function asText(value: SQLOutputValue | undefined): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "bigint" || typeof value === "boolean") return String(value);
  return "";
}

function asNumber(value: SQLOutputValue | undefined): number {
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string") return Number(value);
  return 0;
}
