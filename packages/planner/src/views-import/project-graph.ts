import {
  bindKnowledgeGraph,
  type KnowledgeGraphRepo as DbKnowledgeGraphRepo,
  type NodeMutation as DbNodeMutation,
  type NodeStatus as DbNodeStatus,
  type ProjectStateDb,
} from "@ef-harness/db";
import { isFieldMap } from "./hash.js";
import { StaleNodeError } from "./graph.js";
import type {
  ChangeSetProposal,
  ChangeSetRecord,
  CommitResult,
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

const CHANGE_ORIGINS = [
  "chat",
  "markdown_edit",
  "research",
  "planner",
  "sweep",
  "undo",
  "intake",
  "kernel",
  "import",
] as const;

type ChangeOrigin = (typeof CHANGE_ORIGINS)[number];
type UpdateClass = "cosmetic" | "clarifying" | "compatible" | "breaking";

/**
 * Importer graph port over the shared `ProjectStateDb` writer.
 * Commits go through `KnowledgeGraphRepo`.
 */
export class ProjectStateKnowledgeGraph implements KnowledgeGraphRepo {
  private readonly graph: DbKnowledgeGraphRepo;

  constructor(private readonly state: ProjectStateDb) {
    this.graph = bindKnowledgeGraph(state);
  }

  close(): void {
    if (!this.state.isClosed()) this.state.close();
  }

  currentRevision(): number {
    return this.graph.currentRevision();
  }

  getNode(id: string): GraphNode | null {
    const node = this.graph.getNode(id);
    return node ? toGraphNode(node) : null;
  }

  getNodeVersion(id: string, version: number): GraphNode | null {
    const current = this.getNode(id);
    if (current && current.version === version) return current;
    const row = this.state.writer
      .prepare(
        `SELECT id, kind, version, content_hash, title, text, fields, status, change_set, valid_from_rev
           FROM node_versions WHERE id = ? AND version = ?`,
      )
      .get([id, version]);
    if (!isRecord(row)) return null;
    return versionRow(row);
  }

  listNodeIds(): readonly string[] {
    const ids: string[] = [];
    let cursor: string | undefined;
    const rev = this.graph.currentRevision();
    for (;;) {
      const page = this.graph.getSnapshotAsOf(rev, cursor ? { nodeAfter: cursor, limit: 200 } : { limit: 200 });
      for (const node of page.nodes) ids.push(node.id);
      if (!page.hasMoreNodes || !page.nodesNextCursor) break;
      cursor = page.nodesNextCursor;
    }
    return ids;
  }

  listCurrentEdges(): readonly GraphEdge[] {
    const edges: GraphEdge[] = [];
    let cursor: string | undefined;
    const rev = this.graph.currentRevision();
    for (;;) {
      const page = this.graph.getEdgesAsOf(rev, cursor ? { after: cursor, limit: 200 } : { limit: 200 });
      for (const edge of page.edges) edges.push({ src: edge.src, type: edge.type, dst: edge.dst });
      if (!page.hasMore || !page.nextCursor) break;
      cursor = page.nextCursor;
    }
    return edges;
  }

  listNames(ownerNode: string): readonly NameRecord[] {
    const rows = this.state.writer.prepare("SELECT kind, value, owner_node FROM names WHERE owner_node = ?").all([ownerNode]);
    const names: NameRecord[] = [];
    for (const row of rows) {
      if (!isRecord(row) || typeof row.kind !== "string" || typeof row.value !== "string" || typeof row.owner_node !== "string") {
        continue;
      }
      names.push({ kind: row.kind, value: row.value, ownerNode: row.owner_node });
    }
    return names;
  }

  listChangeSets(): readonly ChangeSetRecord[] {
    const rows = this.state.writer
      .prepare("SELECT id, rev, origin, author, summary, created_at, origin_ref FROM change_sets ORDER BY rev")
      .all();
    const records: ChangeSetRecord[] = [];
    for (const row of rows) {
      if (!isRecord(row) || typeof row.id !== "string" || typeof row.rev !== "number") continue;
      if (typeof row.origin !== "string" || typeof row.author !== "string" || typeof row.created_at !== "number") continue;
      records.push({
        id: row.id,
        rev: row.rev,
        origin: row.origin,
        author: row.author,
        summary: typeof row.summary === "string" ? row.summary : "",
        createdAt: row.created_at,
        originRef: typeof row.origin_ref === "string" ? row.origin_ref : null,
      });
    }
    return records;
  }

  listNodeVersions(id: string): readonly NodeVersionRecord[] {
    const rows = this.state.writer
      .prepare(
        `SELECT version, title, text, fields, status, change_set, content_hash
           FROM node_versions WHERE id = ? ORDER BY version`,
      )
      .all([id]);
    const versions: NodeVersionRecord[] = [];
    for (const row of rows) {
      if (!isRecord(row) || typeof row.version !== "number" || typeof row.title !== "string" || typeof row.text !== "string") {
        continue;
      }
      if (typeof row.status !== "string" || typeof row.change_set !== "string" || typeof row.content_hash !== "string") continue;
      versions.push({
        id,
        version: row.version,
        title: row.title,
        text: row.text,
        fields: asFieldMap(parseJson(row.fields)),
        status: row.status,
        changeSetId: row.change_set,
        contentHash: row.content_hash,
      });
    }
    return versions;
  }

  taskRuntime(taskId: string): TaskRuntimeRecord | null {
    const row = this.state.writer
      .prepare("SELECT task, state, epoch, feature FROM task_runtime WHERE task = ?")
      .get([taskId]);
    if (!isRecord(row) || typeof row.task !== "string" || typeof row.state !== "string") return null;
    if (typeof row.epoch !== "number" || typeof row.feature !== "string") return null;
    return { task: row.task, state: row.state, epoch: row.epoch, feature: row.feature };
  }

  commitChangeSet(proposal: ChangeSetProposal): CommitResult {
    for (const node of proposal.nodes ?? []) {
      if (node.op === "create") continue;
      const current = this.getNode(node.id);
      if (!current) throw new Error(`unknown node ${node.id}`);
      if (current.version !== node.expectedVersion) {
        throw new StaleNodeError(node.id, node.expectedVersion, current.version);
      }
    }
    const result = this.graph.commitChangeSet({
      ...(proposal.id ? { id: proposal.id } : {}),
      origin: asOrigin(proposal.origin),
      ...(proposal.originRef !== undefined ? { originRef: proposal.originRef } : {}),
      author: proposal.author,
      ...(proposal.summary !== undefined ? { summary: proposal.summary } : {}),
      ...(proposal.createdAt !== undefined ? { createdAt: proposal.createdAt } : {}),
      nodes: (proposal.nodes ?? []).map(toDbNode),
      edges: (proposal.edges ?? []).map((edge) =>
        edge.op === "retire"
          ? { op: "retire" as const, src: edge.src, type: edge.type, dst: edge.dst }
          : { op: "create" as const, src: edge.src, type: edge.type, dst: edge.dst },
      ),
    });
    return {
      rev: result.rev,
      changeSetId: result.changeSetId ?? proposal.id ?? "",
      noop: result.noop,
    };
  }
}

function toDbNode(node: NodeMutation): DbNodeMutation {
  if (node.op === "create") {
    const created: DbNodeMutation = {
      op: "create",
      id: node.id,
      kind: node.kind,
      title: node.title,
      text: node.text ?? "",
      fields: node.fields ?? {},
      status: node.status === "draft" ? "draft" : "active",
    };
    return created;
  }
  if (node.op === "retire") {
    const retired: DbNodeMutation = {
      op: "retire",
      id: node.id,
      status: node.status === "superseded" ? "superseded" : "retired",
    };
    return retired;
  }
  const status = columnStatus(node.status);
  const updated: DbNodeMutation = {
    op: "update",
    id: node.id,
    class: updateClass(node.class),
    ...(node.title !== undefined ? { title: node.title } : {}),
    ...(node.text !== undefined ? { text: node.text } : {}),
    ...(node.fields !== undefined ? { fields: node.fields } : {}),
    ...(status ? { status } : {}),
  };
  return updated;
}

function columnStatus(status: string | undefined): DbNodeStatus | undefined {
  if (status === "draft" || status === "active" || status === "retired" || status === "superseded") return status;
  return undefined;
}

function updateClass(value: string): UpdateClass {
  if (value === "cosmetic" || value === "clarifying" || value === "compatible" || value === "breaking") return value;
  return "compatible";
}

function asOrigin(value: string): ChangeOrigin {
  for (const origin of CHANGE_ORIGINS) {
    if (origin === value) return origin;
  }
  return "markdown_edit";
}

function toGraphNode(node: {
  readonly id: string;
  readonly kind: string;
  readonly version: number;
  readonly contentHash: string;
  readonly title: string;
  readonly text: string;
  readonly fields: unknown;
  readonly status: string;
  readonly feature: string | null;
  readonly basis: string | null;
  readonly changeSetId: string;
  readonly createdRev: number;
  readonly updatedRev: number;
}): GraphNode {
  return {
    id: node.id,
    kind: node.kind,
    version: node.version,
    contentHash: node.contentHash,
    title: node.title,
    text: node.text,
    fields: asFieldMap(node.fields),
    status: asStatus(node.status),
    feature: node.feature,
    basis: node.basis,
    changeSetId: node.changeSetId,
    createdRev: node.createdRev,
    updatedRev: node.updatedRev,
  };
}

function versionRow(row: Record<string, unknown>): GraphNode | null {
  if (typeof row.id !== "string" || typeof row.kind !== "string" || typeof row.version !== "number") return null;
  if (typeof row.content_hash !== "string" || typeof row.title !== "string" || typeof row.text !== "string") return null;
  if (typeof row.status !== "string" || typeof row.change_set !== "string") return null;
  const fields = asFieldMap(parseJson(row.fields));
  const feature = typeof fields.feature === "string" ? fields.feature : null;
  const basis = typeof fields.basis === "string" ? fields.basis : null;
  const rev = typeof row.valid_from_rev === "number" ? row.valid_from_rev : row.version;
  return {
    id: row.id,
    kind: row.kind,
    version: row.version,
    contentHash: row.content_hash,
    title: row.title,
    text: row.text,
    fields,
    status: asStatus(row.status),
    feature,
    basis,
    changeSetId: row.change_set,
    createdRev: rev,
    updatedRev: rev,
  };
}

function asStatus(value: string): NodeStatus {
  if (value === "draft" || value === "active" || value === "retired" || value === "superseded") return value;
  return "active";
}

function asFieldMap(value: unknown): FieldMap {
  if (!isFieldMap(value)) return {};
  return value;
}

function parseJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return {};
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
