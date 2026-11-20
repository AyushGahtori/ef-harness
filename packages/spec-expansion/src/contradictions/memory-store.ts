import { createHash } from "node:crypto";
import type {
  ChangeSetProposal,
  CommitChangeSetResult,
  ConflictInboxItem,
  ConflictInboxPort,
  EdgeAsOf,
  EdgeMutation,
  KnowledgeGraphPort,
  NodeLifecycle,
  NodeMutation,
  NodeRecord,
} from "./ports.js";
import { readRecord, readString } from "./ports.js";

interface StoredEdge {
  readonly src: string;
  readonly type: string;
  readonly dst: string;
  validFromRev: number;
  validToRev: number | null;
}

/**
 * In-memory stand-in for Task 017 `KnowledgeGraphRepo` plus conflict inbox rows.
 * Accepts `edges(type = 'contradicts')` even though foundation `edge_types` does not
 * seed that type yet.
 */
export class InMemoryContradictionStore implements KnowledgeGraphPort, ConflictInboxPort {
  private revision = 0;
  private nid = 0;
  private changeSeq = 0;
  private readonly nodes = new Map<string, NodeRecord>();
  private readonly edges: StoredEdge[] = [];
  private readonly inbox = new Map<string, ConflictInboxItem>();

  currentRevision(): number {
    return this.revision;
  }

  getNode(id: string): NodeRecord | null {
    return this.nodes.get(id) ?? null;
  }

  listNodes(): readonly NodeRecord[] {
    return [...this.nodes.values()];
  }

  getEdgesAsOf(rev: number): readonly EdgeAsOf[] {
    const visible: EdgeAsOf[] = [];
    for (const edge of this.edges) {
      if (edge.validFromRev > rev) continue;
      if (edge.validToRev !== null && edge.validToRev <= rev) continue;
      visible.push({ src: edge.src, type: edge.type, dst: edge.dst });
    }
    return visible;
  }

  commitChangeSet(proposal: ChangeSetProposal): CommitChangeSetResult {
    const changeSetId = proposal.id ?? `cs-contradiction-${String(this.changeSeq + 1)}`;
    let changed = false;
    const nodes = proposal.nodes ?? [];
    const edges = proposal.edges ?? [];
    if (nodes.length === 0 && edges.length === 0) {
      return { rev: this.revision, changeSetId, noop: true, idempotent: true };
    }
    this.revision += 1;
    this.changeSeq += 1;
    for (const mutation of nodes) changed = this.applyNode(mutation, changeSetId) || changed;
    for (const mutation of edges) changed = this.applyEdge(mutation) || changed;
    return { rev: this.revision, changeSetId, noop: !changed, idempotent: !changed };
  }

  upsertConflict(item: ConflictInboxItem): void {
    const previous = this.inbox.get(item.id);
    this.inbox.set(item.id, {
      ...item,
      status: "open",
      resolvedAt: null,
      createdAt: previous?.createdAt ?? item.createdAt,
    });
  }

  resolveConflict(id: string, resolvedAt: number): void {
    const current = this.inbox.get(id);
    if (current === undefined || current.status !== "open") return;
    this.inbox.set(id, { ...current, status: "answered", resolvedAt });
  }

  listOpenConflicts(): readonly ConflictInboxItem[] {
    return [...this.inbox.values()].filter((item) => item.status === "open");
  }

  supersede(id: string): void {
    const node = this.getNode(id);
    if (node === null) throw new Error(`unknown node ${id}`);
    this.commitChangeSet({
      origin: "kernel",
      author: "contradiction-checker",
      summary: `supersede ${id}`,
      nodes: [
        {
          op: "update",
          id,
          class: "breaking",
          title: node.title,
          text: node.text,
          fields: node.fields,
          status: "superseded",
        },
      ],
    });
  }

  private applyNode(mutation: NodeMutation, changeSetId: string): boolean {
    if (mutation.op === "create") {
      if (this.nodes.has(mutation.id)) return false;
      this.nid += 1;
      const status: NodeLifecycle = mutation.status ?? "active";
      const fields = mutation.fields ?? {};
      this.nodes.set(mutation.id, {
        nid: this.nid,
        id: mutation.id,
        kind: mutation.kind,
        version: 1,
        contentHash: hashNode(mutation.kind, mutation.title, mutation.text, fields, status),
        title: mutation.title,
        text: mutation.text,
        fields,
        status,
        feature: readString(readRecord(fields), "feature"),
        basis: readString(readRecord(fields), "basis"),
        ownerRole: mutation.ownerRole ?? null,
        changeSetId,
        createdRev: this.revision,
        updatedRev: this.revision,
      });
      return true;
    }
    const current = this.nodes.get(mutation.id);
    if (current === undefined) throw new Error(`unknown node ${mutation.id}`);
    const next: NodeRecord = {
      ...current,
      version: current.version + 1,
      contentHash: hashNode(current.kind, mutation.title, mutation.text, mutation.fields, mutation.status),
      title: mutation.title,
      text: mutation.text,
      fields: mutation.fields,
      status: mutation.status,
      feature: readString(readRecord(mutation.fields), "feature"),
      basis: readString(readRecord(mutation.fields), "basis"),
      changeSetId,
      updatedRev: this.revision,
    };
    this.nodes.set(mutation.id, next);
    return true;
  }

  private applyEdge(mutation: EdgeMutation): boolean {
    if (mutation.op === "create") {
      const current = this.edges.find(
        (edge) =>
          edge.src === mutation.src &&
          edge.type === mutation.type &&
          edge.dst === mutation.dst &&
          edge.validToRev === null,
      );
      if (current !== undefined) return false;
      this.edges.push({
        src: mutation.src,
        type: mutation.type,
        dst: mutation.dst,
        validFromRev: this.revision,
        validToRev: null,
      });
      return true;
    }
    const current = this.edges.find(
      (edge) =>
        edge.src === mutation.src &&
        edge.type === mutation.type &&
        edge.dst === mutation.dst &&
        edge.validToRev === null,
    );
    if (current === undefined) return false;
    current.validToRev = this.revision;
    return true;
  }
}

function hashNode(kind: string, title: string, text: string, fields: unknown, status: string): string {
  return createHash("sha256").update(JSON.stringify([kind, title, text, fields, status])).digest("hex");
}
