import fs from "node:fs";
import { DatabaseSync, type SQLInputValue, type StatementSync } from "node:sqlite";
import { canonicalAssetAbsolute } from "@ef-harness/shared-contracts";
import { computeNodeContentHash, formatSpecItemId } from "./canonical.js";
import type { ReadinessSnapshot } from "./types.js";

/**
 * Local port of Task 017 `KnowledgeGraphRepo` over canonical `schema/state.sql`.
 * The filler writes requirement nodes here. Replace `openFillerStateDb` with
 * `KnowledgeGraphRepo` when `packages/db` exports it.
 */

export interface GraphNode {
  readonly id: string;
  readonly kind: string;
  readonly version: number;
  readonly contentHash: string;
  readonly title: string;
  readonly text: string;
  readonly fields: Record<string, unknown>;
  readonly status: string;
  readonly feature: string | null;
  readonly basis: string | null;
}

export interface GraphEdge {
  readonly src: string;
  readonly type: string;
  readonly dst: string;
}

export interface NodeCreate {
  readonly op: "create";
  readonly id: string;
  readonly kind: string;
  readonly title: string;
  readonly text?: string;
  readonly fields?: Record<string, unknown>;
  readonly status?: "draft" | "active";
}

export interface NodeUpdate {
  readonly op: "update";
  readonly id: string;
  readonly title?: string;
  readonly text?: string;
  readonly fields?: Record<string, unknown>;
  readonly status?: "draft" | "active" | "retired" | "superseded";
}

export interface EdgeCreate {
  readonly op: "create";
  readonly src: string;
  readonly type: string;
  readonly dst: string;
}

export interface ChangeSetProposal {
  readonly id: string;
  readonly origin: "kernel";
  readonly author: string;
  readonly summary?: string;
  readonly nodes?: readonly (NodeCreate | NodeUpdate)[];
  readonly edges?: readonly EdgeCreate[];
}

export interface CommitResult {
  readonly rev: number;
  readonly changeSetId: string;
  readonly noop: boolean;
  readonly idempotent: boolean;
}

type SqlParams = Record<string, SQLInputValue>;

export class FillerStateDb {
  private depth = 0;
  private readonly db: DatabaseSync;

  constructor(location = ":memory:", schemaPath?: string) {
    this.db = new DatabaseSync(location);
    this.db.exec("PRAGMA foreign_keys = ON");
    this.db.exec("PRAGMA busy_timeout = 5000");
    this.db.function("ef_search_text", { deterministic: true }, (value: SQLInputValue | null) =>
      splitSearchText(value),
    );
    const schema = fs.readFileSync(schemaPath ?? canonicalAssetAbsolute("stateSql"), "utf8");
    this.db.exec(schema);
    this.db.exec("INSERT INTO meta(key, value) VALUES ('last_rev', '0')");
  }

  close(): void {
    this.db.close();
  }

  commitChangeSet(proposal: ChangeSetProposal): CommitResult {
    return this.transaction(() => this.apply(proposal));
  }

  getNode(id: string): GraphNode | null {
    const row = this.get(
      `SELECT id, kind, version, content_hash, title, text, fields, status, feature, basis
         FROM nodes WHERE id = :id`,
      { id },
    );
    return row ? mapNode(row) : null;
  }

  listNodes(kind?: string): GraphNode[] {
    const rows = kind
      ? this.all(
          `SELECT id, kind, version, content_hash, title, text, fields, status, feature, basis
             FROM nodes WHERE kind = :kind ORDER BY id`,
          { kind },
        )
      : this.all(
          `SELECT id, kind, version, content_hash, title, text, fields, status, feature, basis
             FROM nodes ORDER BY id`,
          {},
        );
    return rows.map((row) => mapNode(row));
  }

  edgesFrom(src: string): GraphEdge[] {
    return this.all(
      `SELECT src, type, dst FROM edges
        WHERE src = :src AND valid_to_rev IS NULL
        ORDER BY type, dst`,
      { src },
    ).map((row) => ({
      src: String(row.src),
      type: String(row.type),
      dst: String(row.dst),
    }));
  }

  requirements(): GraphNode[] {
    return this.listNodes("spec_item");
  }

  nextSpecItemId(): string {
    const rows = this.all("SELECT id FROM nodes WHERE id LIKE 'SI-%'", {});
    let max = 0;
    for (const row of rows) {
      const match = /^SI-(\d+)$/.exec(String(row.id));
      if (!match?.[1]) continue;
      max = Math.max(max, Number(match[1]));
    }
    return formatSpecItemId(max + 1);
  }

  findRequirementByNorm(featureId: string, earsNorm: string): GraphNode | null {
    const rows = this.requirements();
    return (
      rows.find((node) => {
        if (node.status === "retired" || node.status === "superseded") return false;
        return node.feature === featureId && node.fields.ears_norm === earsNorm;
      }) ?? null
    );
  }

  readiness(): ReadinessSnapshot {
    const specs = this.requirements();
    let pendingMedium = 0;
    let settledRequirements = 0;
    let rejected = 0;
    for (const node of specs) {
      const review = node.fields.review_status;
      if (node.status === "superseded" || review === "rejected") rejected += 1;
      else if (node.status === "active" && (node.basis === "explicit" || node.basis === "derived" || node.basis === "delegated" || node.basis === "defaulted" || review === "auto_accepted" || review === "settled")) {
        settledRequirements += 1;
      }
      if (node.status === "draft" && node.basis === "proposed" && review === "proposed") pendingMedium += 1;
    }
    const blockingMustAsk = this.listNodes("decision").filter(
      (node) => node.status === "draft" && node.fields.must_ask === true && node.fields.blocking === true,
    ).length;
    return { pendingMedium, blockingMustAsk, settledRequirements, rejected };
  }

  private apply(proposal: ChangeSetProposal): CommitResult {
    const existing = this.get("SELECT rev FROM change_sets WHERE id = :id", { id: proposal.id });
    if (existing) {
      return {
        rev: Number(existing.rev),
        changeSetId: proposal.id,
        noop: false,
        idempotent: true,
      };
    }
    const rev = this.bumpRev();
    this.run(
      `INSERT INTO change_sets(id, rev, origin, origin_ref, author, created_at, summary)
       VALUES (:id, :rev, 'kernel', NULL, :author, :created_at, :summary)`,
      {
        id: proposal.id,
        rev,
        author: proposal.author,
        created_at: 1_700_000_000_000,
        summary: proposal.summary ?? "",
      },
    );
    let wrote = false;
    for (const node of proposal.nodes ?? []) {
      if (node.op === "create") wrote = this.insertNode(node, proposal.id, rev) || wrote;
      else wrote = this.updateNode(node, proposal.id, rev) || wrote;
    }
    for (const edge of proposal.edges ?? []) {
      wrote = this.insertEdge(edge, proposal.id, rev) || wrote;
    }
    return { rev, changeSetId: proposal.id, noop: !wrote, idempotent: false };
  }

  private insertNode(node: NodeCreate, changeSetId: string, rev: number): boolean {
    if (this.getNode(node.id)) return false;
    const text = node.text ?? "";
    const fields = node.fields ?? {};
    const status = node.status ?? "active";
    const contentHash = computeNodeContentHash({
      kind: node.kind,
      title: node.title,
      text,
      fields,
    });
    this.run(
      `INSERT INTO nodes(id, kind, version, content_hash, title, text, fields, status, owner_role, change_set, created_rev, updated_rev)
       VALUES (:id, :kind, 1, :content_hash, :title, :text, :fields, :status, NULL, :change_set, :rev, :rev)`,
      {
        id: node.id,
        kind: node.kind,
        content_hash: contentHash,
        title: node.title,
        text,
        fields: JSON.stringify(fields),
        status,
        change_set: changeSetId,
        rev,
      },
    );
    this.recordChange(changeSetId, node.id, null, 1, "created");
    return true;
  }

  private updateNode(node: NodeUpdate, changeSetId: string, rev: number): boolean {
    const current = this.getNode(node.id);
    if (!current) throw new Error(`cannot update missing node ${node.id}`);
    const title = node.title ?? current.title;
    const text = node.text ?? current.text;
    const fields = node.fields ?? current.fields;
    const status = node.status ?? current.status;
    const contentHash = computeNodeContentHash({
      kind: current.kind,
      title,
      text,
      fields,
    });
    if (
      contentHash === current.contentHash &&
      status === current.status &&
      title === current.title &&
      text === current.text
    ) {
      return false;
    }
    const version = current.version + 1;
    this.run(
      `UPDATE nodes
          SET version = :version, content_hash = :content_hash, title = :title, text = :text,
              fields = :fields, status = :status, change_set = :change_set, updated_rev = :rev
        WHERE id = :id`,
      {
        id: node.id,
        version,
        content_hash: contentHash,
        title,
        text,
        fields: JSON.stringify(fields),
        status,
        change_set: changeSetId,
        rev,
      },
    );
    const changeClass = status === "retired" || status === "superseded" ? status === "retired" ? "retired" : "breaking" : "compatible";
    this.recordChange(changeSetId, node.id, current.version, version, changeClass);
    return true;
  }

  private insertEdge(edge: EdgeCreate, changeSetId: string, rev: number): boolean {
    const existing = this.get(
      `SELECT src FROM edges
        WHERE src = :src AND type = :type AND dst = :dst AND valid_to_rev IS NULL`,
      { src: edge.src, type: edge.type, dst: edge.dst },
    );
    if (existing) return false;
    this.run(
      `INSERT INTO edges(src, type, dst, dst_version_pin, change_set, valid_from_rev, valid_to_rev)
       VALUES (:src, :type, :dst, NULL, :change_set, :rev, NULL)`,
      {
        src: edge.src,
        type: edge.type,
        dst: edge.dst,
        change_set: changeSetId,
        rev,
      },
    );
    return true;
  }

  private recordChange(
    changeSetId: string,
    id: string,
    oldVersion: number | null,
    newVersion: number,
    changeClass: string,
  ): void {
    this.run(
      `INSERT INTO node_changes(change_set, id, old_version, new_version, class)
       VALUES (:change_set, :id, :old_version, :new_version, :class)`,
      {
        change_set: changeSetId,
        id,
        old_version: oldVersion,
        new_version: newVersion,
        class: changeClass,
      },
    );
  }

  private bumpRev(): number {
    const row = this.get("SELECT value FROM meta WHERE key = 'last_rev'", {});
    const next = Number(row?.value ?? 0) + 1;
    this.run("UPDATE meta SET value = :rev WHERE key = 'last_rev'", { rev: String(next) });
    return next;
  }

  private transaction<T>(fn: () => T): T {
    if (this.depth > 0) return fn();
    this.depth += 1;
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    } finally {
      this.depth -= 1;
    }
  }

  private prepare(sql: string): StatementSync {
    const statement = this.db.prepare(sql);
    statement.setAllowBareNamedParameters(true);
    return statement;
  }

  private run(sql: string, params: SqlParams): void {
    this.prepare(sql).run(params);
  }

  private get(sql: string, params: SqlParams): Record<string, SQLInputValue> | undefined {
    return this.prepare(sql).get(params);
  }

  private all(sql: string, params: SqlParams): Record<string, SQLInputValue>[] {
    return this.prepare(sql).all(params);
  }
}

export function openFillerStateDb(location = ":memory:"): FillerStateDb {
  return new FillerStateDb(location);
}

function mapNode(row: Record<string, SQLInputValue>): GraphNode {
  const fields = JSON.parse(String(row.fields ?? "{}")) as Record<string, unknown>;
  return {
    id: String(row.id),
    kind: String(row.kind),
    version: Number(row.version),
    contentHash: String(row.content_hash),
    title: String(row.title),
    text: String(row.text),
    fields,
    status: String(row.status),
    feature: row.feature == null ? null : String(row.feature),
    basis: row.basis == null ? null : String(row.basis),
  };
}

function splitSearchText(value: SQLInputValue | null): string {
  if (value == null) return "";
  const original = String(value);
  const extra = original
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_\-./:]+/g, " ");
  return `${original} ${extra}`;
}
