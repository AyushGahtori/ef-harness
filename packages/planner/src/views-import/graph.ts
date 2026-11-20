import fs from "node:fs";
import { DatabaseSync, type SQLInputValue, type SQLOutputValue } from "node:sqlite";
import { canonicalAssetAbsolute } from "@ef-harness/shared-contracts";
import { canonicalJson, contentHash, isFieldMap } from "./hash.js";
import type {
  ChangeSetProposal,
  ChangeSetRecord,
  CommitResult,
  EdgeMutation,
  FieldMap,
  GraphEdge,
  GraphNode,
  KnowledgeGraphRepo,
  NameRecord,
  NodeMutation,
  NodeStatus,
  NodeVersionRecord,
  TaskRuntimeRecord,
} from "./types.js";
import { NODE_STATUSES } from "./types.js";

export class StaleNodeError extends Error {
  readonly nodeId: string;
  readonly expected: number;
  readonly actual: number;

  constructor(nodeId: string, expected: number, actual: number) {
    super(`stale node ${nodeId}: expected version ${String(expected)} but found ${String(actual)}`);
    this.name = "StaleNodeError";
    this.nodeId = nodeId;
    this.expected = expected;
    this.actual = actual;
  }
}

type Row = Record<string, SQLOutputValue>;

/**
 * Local port of Task 017 `KnowledgeGraphRepo`.
 * Applies `schema/state.sql` and writes change sets, nodes, edges, and name-registry rows.
 */
export class LocalSqliteKnowledgeGraph implements KnowledgeGraphRepo {
  private constructor(private readonly db: DatabaseSync) {}

  static open(filePath = ":memory:"): LocalSqliteKnowledgeGraph {
    const db = new DatabaseSync(filePath);
    db.exec("PRAGMA foreign_keys = ON");
    db.function("ef_search_text", { deterministic: true }, (value: SQLOutputValue): SQLInputValue => {
      if (typeof value !== "string" || value.length === 0) return "";
      const extra = value.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_\-./:]+/g, " ");
      return `${value} ${extra}`;
    });
    db.exec(fs.readFileSync(canonicalAssetAbsolute("stateSql"), "utf8"));
    return new LocalSqliteKnowledgeGraph(db);
  }

  close(): void {
    this.db.close();
  }

  currentRevision(): number {
    const row = this.db.prepare("SELECT COALESCE(MAX(rev), 0) AS rev FROM change_sets").get();
    return row ? asNumber(row.rev, "rev") : 0;
  }

  getNode(id: string): GraphNode | null {
    const row = this.db
      .prepare(
        `SELECT id, kind, version, content_hash, title, text, fields, status, feature, basis, change_set, created_rev, updated_rev
           FROM nodes WHERE id = ?`,
      )
      .get(id);
    return row ? mapNode(row) : null;
  }

  getNodeVersion(id: string, version: number): GraphNode | null {
    const row = this.db
      .prepare(
        `SELECT id, kind, version, content_hash, title, text, fields, status, change_set, valid_from_rev
           FROM node_versions WHERE id = ? AND version = ?`,
      )
      .get(id, version);
    if (!row) return null;
    const fields = parseFields(asText(row.fields, "fields"));
    const feature = typeof fields.feature === "string" ? fields.feature : null;
    const basis = typeof fields.basis === "string" ? fields.basis : null;
    return {
      id: asText(row.id, "id"),
      kind: asText(row.kind, "kind"),
      version: asNumber(row.version, "version"),
      contentHash: asText(row.content_hash, "content_hash"),
      title: asText(row.title, "title"),
      text: asText(row.text, "text"),
      fields,
      status: asStatus(row.status),
      feature,
      basis,
      changeSetId: asText(row.change_set, "change_set"),
      createdRev: asNumber(row.valid_from_rev, "valid_from_rev"),
      updatedRev: asNumber(row.valid_from_rev, "valid_from_rev"),
    };
  }

  listNodeIds(): readonly string[] {
    return this.db
      .prepare("SELECT id FROM nodes ORDER BY id")
      .all()
      .map((row) => asText(row.id, "id"));
  }

  listCurrentEdges(): readonly GraphEdge[] {
    return this.db
      .prepare("SELECT src, type, dst FROM edges WHERE valid_to_rev IS NULL ORDER BY src, type, dst")
      .all()
      .map((row) => ({
        src: asText(row.src, "src"),
        type: asText(row.type, "type"),
        dst: asText(row.dst, "dst"),
      }));
  }

  listNames(ownerNode: string): readonly NameRecord[] {
    return this.db
      .prepare("SELECT kind, value, owner_node FROM names WHERE owner_node = ? ORDER BY kind, value")
      .all(ownerNode)
      .map((row) => ({
        kind: asText(row.kind, "kind"),
        value: asText(row.value, "value"),
        ownerNode: asText(row.owner_node, "owner_node"),
      }));
  }

  listChangeSets(): readonly ChangeSetRecord[] {
    return this.db
      .prepare(
        `SELECT id, rev, origin, author, summary, created_at, origin_ref
           FROM change_sets ORDER BY rev`,
      )
      .all()
      .map((row) => ({
        id: asText(row.id, "id"),
        rev: asNumber(row.rev, "rev"),
        origin: asText(row.origin, "origin"),
        author: asText(row.author, "author"),
        summary: row.summary === null || row.summary === undefined ? "" : asText(row.summary, "summary"),
        createdAt: asNumber(row.created_at, "created_at"),
        originRef: row.origin_ref === null || row.origin_ref === undefined ? null : asText(row.origin_ref, "origin_ref"),
      }));
  }

  listNodeVersions(id: string): readonly NodeVersionRecord[] {
    return this.db
      .prepare(
        `SELECT id, version, title, text, fields, status, change_set, content_hash
           FROM node_versions WHERE id = ? ORDER BY version`,
      )
      .all(id)
      .map((row) => ({
        id: asText(row.id, "id"),
        version: asNumber(row.version, "version"),
        title: asText(row.title, "title"),
        text: asText(row.text, "text"),
        fields: parseFields(asText(row.fields, "fields")),
        status: asText(row.status, "status"),
        changeSetId: asText(row.change_set, "change_set"),
        contentHash: asText(row.content_hash, "content_hash"),
      }));
  }

  taskRuntime(taskId: string): TaskRuntimeRecord | null {
    const row = this.db.prepare("SELECT task, state, epoch, feature FROM task_runtime WHERE task = ?").get(taskId);
    if (!row) return null;
    return {
      task: asText(row.task, "task"),
      state: asText(row.state, "state"),
      epoch: asNumber(row.epoch, "epoch"),
      feature: asText(row.feature, "feature"),
    };
  }

  insertTaskRuntime(taskId: string, feature: string, state: string, rev: number): void {
    this.db
      .prepare(
        `INSERT INTO task_runtime(task, feature, state, level, epoch, updated_rev)
         VALUES (?, ?, ?, 'Mid', 0, ?)`,
      )
      .run(taskId, feature, state, rev);
  }

  commitChangeSet(proposal: ChangeSetProposal): CommitResult {
    const createdAt = proposal.createdAt ?? Date.now();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const rev = this.currentRevision() + 1;
      const changeSetId = proposal.id ?? `CS-${String(rev)}`;
      const nodes = proposal.nodes ?? [];
      const edges = proposal.edges ?? [];
      if (nodes.length === 0 && edges.length === 0) {
        this.db.exec("ROLLBACK");
        return { rev: this.currentRevision(), changeSetId, noop: true };
      }
      this.db
        .prepare(
          `INSERT INTO change_sets(id, rev, origin, origin_ref, author, created_at, summary)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          changeSetId,
          rev,
          proposal.origin,
          proposal.originRef ?? null,
          proposal.author,
          createdAt,
          proposal.summary ?? "",
        );
      for (const node of nodes) this.applyNode(node, changeSetId, rev);
      for (const edge of edges) this.applyEdge(edge, changeSetId, rev);
      this.db.exec("COMMIT");
      return { rev, changeSetId, noop: false };
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  private applyNode(node: NodeMutation, changeSetId: string, rev: number): void {
    if (node.op === "create") {
      const fields = node.fields ?? {};
      const text = node.text ?? "";
      const status = node.status ?? "active";
      const hash = contentHash({ kind: node.kind, title: node.title, text, fields });
      this.db
        .prepare(
          `INSERT INTO nodes(id, kind, version, content_hash, title, text, fields, status, change_set, created_rev, updated_rev)
           VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(node.id, node.kind, hash, node.title, text, canonicalJson(fields), status, changeSetId, rev, rev);
      this.db
        .prepare(
          `INSERT INTO node_changes(change_set, id, old_version, new_version, class) VALUES (?, ?, NULL, 1, 'created')`,
        )
        .run(changeSetId, node.id);
      return;
    }
    const current = this.getNode(node.id);
    if (!current) throw new Error(`unknown node ${node.id}`);
    if (current.version !== node.expectedVersion) {
      throw new StaleNodeError(node.id, node.expectedVersion, current.version);
    }
    const nextStatus = node.op === "retire" ? (node.status ?? "retired") : (node.status ?? current.status);
    const nextTitle = node.op === "update" ? (node.title ?? current.title) : current.title;
    const nextText = node.op === "update" ? (node.text ?? current.text) : current.text;
    const nextFields = node.op === "update" ? (node.fields ?? current.fields) : current.fields;
    const hash = contentHash({ kind: current.kind, title: nextTitle, text: nextText, fields: nextFields });
    const changed =
      hash !== current.contentHash ||
      nextStatus !== current.status ||
      nextTitle !== current.title ||
      nextText !== current.text ||
      canonicalJson(nextFields) !== canonicalJson(current.fields);
    this.db
      .prepare(`INSERT INTO change_set_reads(change_set, target, dir, edge_type, version) VALUES (?, ?, '', '', ?)`)
      .run(changeSetId, node.id, current.version);
    if (!changed && node.op !== "retire") return;
    const nextVersion = current.version + 1;
    this.db
      .prepare(
        `UPDATE nodes
            SET version = ?, content_hash = ?, title = ?, text = ?, fields = ?, status = ?, change_set = ?, updated_rev = ?
          WHERE id = ?`,
      )
      .run(nextVersion, hash, nextTitle, nextText, canonicalJson(nextFields), nextStatus, changeSetId, rev, node.id);
    const changeClass = node.op === "retire" ? "retired" : node.class;
    this.db
      .prepare(`INSERT INTO node_changes(change_set, id, old_version, new_version, class) VALUES (?, ?, ?, ?, ?)`)
      .run(changeSetId, node.id, current.version, nextVersion, changeClass);
  }

  private applyEdge(edge: EdgeMutation, changeSetId: string, rev: number): void {
    if (edge.op === "create") {
      this.db
        .prepare(`INSERT INTO edges(src, type, dst, change_set, valid_from_rev) VALUES (?, ?, ?, ?, ?)`)
        .run(edge.src, edge.type, edge.dst, changeSetId, rev);
      return;
    }
    this.db
      .prepare(
        `UPDATE edges SET valid_to_rev = ?
          WHERE src = ? AND type = ? AND dst = ? AND valid_to_rev IS NULL`,
      )
      .run(rev, edge.src, edge.type, edge.dst);
  }
}

function mapNode(row: Row): GraphNode {
  return {
    id: asText(row.id, "id"),
    kind: asText(row.kind, "kind"),
    version: asNumber(row.version, "version"),
    contentHash: asText(row.content_hash, "content_hash"),
    title: asText(row.title, "title"),
    text: asText(row.text, "text"),
    fields: parseFields(asText(row.fields, "fields")),
    status: asStatus(row.status),
    feature: row.feature === null || row.feature === undefined ? null : asText(row.feature, "feature"),
    basis: row.basis === null || row.basis === undefined ? null : asText(row.basis, "basis"),
    changeSetId: asText(row.change_set, "change_set"),
    createdRev: asNumber(row.created_rev, "created_rev"),
    updatedRev: asNumber(row.updated_rev, "updated_rev"),
  };
}

function parseFields(json: string): FieldMap {
  const parsed: unknown = JSON.parse(json);
  return isFieldMap(parsed) ? parsed : {};
}

function asStatus(value: SQLOutputValue | undefined): NodeStatus {
  const text = asText(value, "status");
  if (!NODE_STATUSES.includes(text as NodeStatus)) throw new Error(`invalid node status ${text}`);
  return text as NodeStatus;
}

function asText(value: SQLOutputValue | undefined, label: string): string {
  if (typeof value !== "string") throw new Error(`${label} is not text`);
  return value;
}

function asNumber(value: SQLOutputValue | undefined, label: string): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "bigint") return Number(value);
  throw new Error(`${label} is not a number`);
}
