import type { SQLOutputValue } from "node:sqlite";
import { localContentHash } from "./canonical-json.js";
import { DepthError, StaleDecisionError } from "./errors.js";
import { openStateDatabase } from "./sqlite-state.js";
import type { DatabaseSync } from "node:sqlite";

export type ChangeOrigin =
  | "chat"
  | "markdown_edit"
  | "research"
  | "planner"
  | "sweep"
  | "undo"
  | "intake"
  | "kernel"
  | "import";

export interface StoredNode {
  readonly id: string;
  readonly kind: string;
  readonly version: number;
  readonly title: string;
  readonly text: string;
  readonly fieldsJson: string;
  readonly basis: string | null;
  readonly status: string;
  readonly changeSetId: string;
  readonly createdRev: number;
  readonly updatedRev: number;
}

export interface NodeVersionRow {
  readonly version: number;
  readonly fieldsJson: string;
  readonly status: string;
  readonly validFromRev: number;
  readonly validToRev: number | null;
}

export interface EdgeRow {
  readonly src: string;
  readonly type: string;
  readonly dst: string;
}

/**
 * Local port of Task 017 `KnowledgeGraphRepo`.
 * The db barrel on this base does not export that type. This writer talks to
 * `schema/state.sql` through `node:sqlite` and covers the depth-control reads
 * and writes: change sets, decision nodes, the project stage node, scope rows,
 * and `derived_from` edges. Swap `openDepthKnowledgeGraph` for `openKnowledgeGraph`
 * from `@ef-harness/db` once Task 017 is integrated.
 */
export interface KnowledgeGraphRepo {
  transaction<T>(work: () => T): T;
  close(): void;
  insertChangeSet(input: {
    readonly origin: ChangeOrigin;
    readonly summary: string;
    readonly createdAt: number;
  }): { readonly id: string; readonly rev: number };
  insertNode(input: {
    readonly id: string;
    readonly kind: string;
    readonly title: string;
    readonly text: string;
    readonly fields: Record<string, unknown>;
    readonly changeSetId: string;
    readonly rev: number;
  }): void;
  updateNode(input: {
    readonly id: string;
    readonly title: string;
    readonly text: string;
    readonly fields: Record<string, unknown>;
    readonly changeSetId: string;
    readonly rev: number;
    readonly expectedVersion: number;
    readonly status?: string;
  }): void;
  getNode(id: string): StoredNode | null;
  listNodesByKind(kind: string): StoredNode[];
  listVersions(id: string): NodeVersionRow[];
  insertEdge(input: {
    readonly src: string;
    readonly type: string;
    readonly dst: string;
    readonly changeSetId: string;
    readonly rev: number;
  }): void;
  listCurrentEdges(type: string, dst: string): EdgeRow[];
  insertWorkItem(input: {
    readonly id: string;
    readonly title: string;
    readonly createdAt: number;
  }): void;
  insertScope(input: {
    readonly workItemId: string;
    readonly scopeRev: number;
    readonly createdRev: number;
    readonly reason: string;
  }): void;
  insertScopeCriterion(input: {
    readonly workItemId: string;
    readonly scopeRev: number;
    readonly decisionId: string;
    readonly neededForPlanning: boolean;
    readonly critical: boolean;
  }): void;
  latestScope(workItemId: string): { readonly scopeRev: number; readonly reason: string } | null;
}

export function openDepthKnowledgeGraph(filename = ":memory:"): KnowledgeGraphRepo {
  return new LocalSqliteKnowledgeGraph(filename);
}

export class LocalSqliteKnowledgeGraph implements KnowledgeGraphRepo {
  private readonly db: DatabaseSync;
  private depth = 0;
  private changeCounter = 0;
  private closed = false;

  constructor(private readonly filename: string) {
    this.db = openStateDatabase(filename);
  }

  transaction<T>(work: () => T): T {
    if (this.depth > 0) return work();
    this.db.exec("BEGIN IMMEDIATE");
    this.depth += 1;
    try {
      const result = work();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    } finally {
      this.depth -= 1;
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.filename !== ":memory:") {
      this.db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    }
    this.db.close();
  }

  insertChangeSet(input: {
    readonly origin: ChangeOrigin;
    readonly summary: string;
    readonly createdAt: number;
  }): { readonly id: string; readonly rev: number } {
    this.changeCounter += 1;
    const id = `CS-depth-${this.changeCounter}`;
    this.db
      .prepare(
        `INSERT INTO change_sets(id, rev, origin, author, created_at, summary)
         VALUES (?, (SELECT COALESCE(MAX(rev), 0) + 1 FROM change_sets), ?, 'depth-controls', ?, ?)`,
      )
      .run(id, input.origin, input.createdAt, input.summary);
    const rev = requiredInt(requiredRow(this.db.prepare("SELECT rev FROM change_sets WHERE id = ?").get(id)), "rev");
    return { id, rev };
  }

  insertNode(input: {
    readonly id: string;
    readonly kind: string;
    readonly title: string;
    readonly text: string;
    readonly fields: Record<string, unknown>;
    readonly changeSetId: string;
    readonly rev: number;
  }): void {
    const title = input.title.normalize("NFC");
    const text = input.text.normalize("NFC");
    const fieldsJson = JSON.stringify(input.fields);
    const hash = localContentHash({ kind: input.kind, title, text, fields: input.fields });
    this.db
      .prepare(
        `INSERT INTO nodes(id, kind, version, content_hash, title, text, fields, change_set, created_rev, updated_rev)
         VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(input.id, input.kind, hash, title, text, fieldsJson, input.changeSetId, input.rev, input.rev);
  }

  updateNode(input: {
    readonly id: string;
    readonly title: string;
    readonly text: string;
    readonly fields: Record<string, unknown>;
    readonly changeSetId: string;
    readonly rev: number;
    readonly expectedVersion: number;
    readonly status?: string;
  }): void {
    const current = this.getNode(input.id);
    if (!current) throw new DepthError(`node ${input.id} does not exist`);
    if (current.version !== input.expectedVersion) {
      throw new StaleDecisionError(`node ${input.id} version is ${current.version}, expected ${input.expectedVersion}`);
    }
    const title = input.title.normalize("NFC");
    const text = input.text.normalize("NFC");
    const fieldsJson = JSON.stringify(input.fields);
    const hash = localContentHash({ kind: current.kind, title, text, fields: input.fields });
    const status = input.status ?? current.status;
    const result = this.db
      .prepare(
        `UPDATE nodes
            SET version = ?, content_hash = ?, title = ?, text = ?, fields = ?, status = ?, change_set = ?, updated_rev = ?
          WHERE id = ? AND version = ?`,
      )
      .run(
        current.version + 1,
        hash,
        title,
        text,
        fieldsJson,
        status,
        input.changeSetId,
        input.rev,
        input.id,
        input.expectedVersion,
      );
    if (Number(result.changes) !== 1) {
      throw new StaleDecisionError(`node ${input.id} was not updated`);
    }
  }

  getNode(id: string): StoredNode | null {
    const row = this.db
      .prepare(
        `SELECT id, kind, version, title, text, fields, basis, status, change_set, created_rev, updated_rev
           FROM nodes WHERE id = ?`,
      )
      .get(id);
    return row ? mapNode(asRow(row)) : null;
  }

  listNodesByKind(kind: string): StoredNode[] {
    return this.db
      .prepare(
        `SELECT id, kind, version, title, text, fields, basis, status, change_set, created_rev, updated_rev
           FROM nodes WHERE kind = ? AND status = 'active' ORDER BY id`,
      )
      .all(kind)
      .map((row) => mapNode(asRow(row)));
  }

  listVersions(id: string): NodeVersionRow[] {
    return this.db
      .prepare(
        `SELECT version, fields, status, valid_from_rev, valid_to_rev
           FROM node_versions WHERE id = ? ORDER BY version`,
      )
      .all(id)
      .map((row) => {
        const record = asRow(row);
        const validTo = record.valid_to_rev;
        return {
          version: requiredInt(record, "version"),
          fieldsJson: requiredText(record, "fields"),
          status: requiredText(record, "status"),
          validFromRev: requiredInt(record, "valid_from_rev"),
          validToRev: typeof validTo === "number" || typeof validTo === "bigint" ? Number(validTo) : null,
        };
      });
  }

  insertEdge(input: {
    readonly src: string;
    readonly type: string;
    readonly dst: string;
    readonly changeSetId: string;
    readonly rev: number;
  }): void {
    this.db
      .prepare(
        `INSERT INTO edges(src, type, dst, change_set, valid_from_rev)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(input.src, input.type, input.dst, input.changeSetId, input.rev);
  }

  listCurrentEdges(type: string, dst: string): EdgeRow[] {
    return this.db
      .prepare(
        `SELECT src, type, dst FROM edges
          WHERE type = ? AND dst = ? AND valid_to_rev IS NULL
          ORDER BY src`,
      )
      .all(type, dst)
      .map((row) => {
        const record = asRow(row);
        return {
          src: requiredText(record, "src"),
          type: requiredText(record, "type"),
          dst: requiredText(record, "dst"),
        };
      });
  }

  insertWorkItem(input: { readonly id: string; readonly title: string; readonly createdAt: number }): void {
    this.db
      .prepare("INSERT INTO work_items(id, kind, title, status, created_at) VALUES (?, 'project', ?, 'discovering', ?)")
      .run(input.id, input.title, input.createdAt);
  }

  insertScope(input: {
    readonly workItemId: string;
    readonly scopeRev: number;
    readonly createdRev: number;
    readonly reason: string;
  }): void {
    this.db
      .prepare("INSERT INTO discovery_scopes(work_item, scope_rev, created_rev, reason) VALUES (?, ?, ?, ?)")
      .run(input.workItemId, input.scopeRev, input.createdRev, input.reason);
  }

  insertScopeCriterion(input: {
    readonly workItemId: string;
    readonly scopeRev: number;
    readonly decisionId: string;
    readonly neededForPlanning: boolean;
    readonly critical: boolean;
  }): void {
    this.db
      .prepare(
        `INSERT INTO scope_criteria(work_item, scope_rev, decision, needed_for_planning, critical)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        input.workItemId,
        input.scopeRev,
        input.decisionId,
        input.neededForPlanning ? 1 : 0,
        input.critical ? 1 : 0,
      );
  }

  latestScope(workItemId: string): { readonly scopeRev: number; readonly reason: string } | null {
    const row = this.db
      .prepare(
        `SELECT scope_rev, reason FROM discovery_scopes
          WHERE work_item = ? ORDER BY scope_rev DESC LIMIT 1`,
      )
      .get(workItemId);
    if (!row) return null;
    const record = asRow(row);
    return { scopeRev: requiredInt(record, "scope_rev"), reason: requiredText(record, "reason") };
  }
}

function mapNode(record: Record<string, SQLOutputValue>): StoredNode {
  const basis = record.basis;
  return {
    id: requiredText(record, "id"),
    kind: requiredText(record, "kind"),
    version: requiredInt(record, "version"),
    title: requiredText(record, "title"),
    text: requiredText(record, "text"),
    fieldsJson: requiredText(record, "fields"),
    basis: typeof basis === "string" ? basis : null,
    status: requiredText(record, "status"),
    changeSetId: requiredText(record, "change_set"),
    createdRev: requiredInt(record, "created_rev"),
    updatedRev: requiredInt(record, "updated_rev"),
  };
}

function asRow(value: unknown): Record<string, SQLOutputValue> {
  if (!value || typeof value !== "object") throw new DepthError("expected a database row");
  return value as Record<string, SQLOutputValue>;
}

function requiredRow(value: unknown): Record<string, SQLOutputValue> {
  if (!value) throw new DepthError("expected a database row");
  return asRow(value);
}

function requiredText(record: Record<string, SQLOutputValue>, key: string): string {
  const value = record[key];
  if (typeof value !== "string") throw new DepthError(`expected text in ${key}`);
  return value;
}

function requiredInt(record: Record<string, SQLOutputValue>, key: string): number {
  const value = record[key];
  if (typeof value !== "number" && typeof value !== "bigint") throw new DepthError(`expected integer in ${key}`);
  return Number(value);
}
