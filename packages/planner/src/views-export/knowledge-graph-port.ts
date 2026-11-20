/**
 * Local port of the Task 017 `KnowledgeGraphRepo` read surface this exporter uses:
 * current revision, current nodes, current edges, and `getDirtyNodesSince`
 * (`export_dirty_nodes`: node changes and edge interval changes after `lastRev`).
 */

import { compareText } from "./canonical-hash.js";

export type NodeStatus = "draft" | "active" | "retired" | "superseded";

export interface ViewNode {
  readonly id: string;
  readonly kind: string;
  readonly version: number;
  readonly contentHash: string;
  readonly title: string;
  readonly text: string;
  readonly fields: unknown;
  readonly status: NodeStatus;
  readonly feature: string | null;
  readonly basis: string | null;
  readonly ownerRole: string | null;
  readonly createdRev: number;
  readonly updatedRev: number;
}

export interface ViewEdge {
  readonly src: string;
  readonly type: string;
  readonly dst: string;
  readonly dstVersionPin: number | null;
  readonly validFromRev: number;
  readonly validToRev: number | null;
}

export interface KnowledgeViewSource {
  currentRevision(): number;
  listNodes(): readonly ViewNode[];
  listEdges(): readonly ViewEdge[];
  getDirtyNodesSince(lastRev: number): readonly string[];
}

export function compareNodes(left: ViewNode, right: ViewNode): number {
  const order = displayOrder(left) - displayOrder(right);
  if (order !== 0) return order;
  return compareText(left.id, right.id);
}

export function displayOrder(node: ViewNode): number {
  const fields = asRecord(node.fields);
  const value = fields.display_order;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return Number.POSITIVE_INFINITY;
}

export function asRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

export function stringField(node: ViewNode, key: string): string | null {
  const value = asRecord(node.fields)[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

export class MemoryKnowledgeViewSource implements KnowledgeViewSource {
  private readonly nodes = new Map<string, ViewNode>();
  private edges: ViewEdge[] = [];
  private revision = 0;

  currentRevision(): number {
    return this.revision;
  }

  setRevision(revision: number): void {
    this.revision = revision;
  }

  upsertNode(node: ViewNode): void {
    this.nodes.set(node.id, node);
    this.revision = Math.max(this.revision, node.updatedRev, node.createdRev);
  }

  replaceEdges(edges: readonly ViewEdge[]): void {
    this.edges = [...edges];
    for (const edge of edges) {
      this.revision = Math.max(this.revision, edge.validFromRev, edge.validToRev ?? 0);
    }
  }

  listNodes(): readonly ViewNode[] {
    return [...this.nodes.values()].sort((left, right) => compareText(left.id, right.id));
  }

  listEdges(): readonly ViewEdge[] {
    return [...this.edges].sort(compareEdges);
  }

  getDirtyNodesSince(lastRev: number): readonly string[] {
    const ids = new Set<string>();
    for (const node of this.nodes.values()) {
      if (node.updatedRev > lastRev) ids.add(node.id);
    }
    for (const edge of this.edges) {
      if (edge.validFromRev > lastRev || (edge.validToRev !== null && edge.validToRev > lastRev)) {
        ids.add(edge.src);
      }
    }
    return [...ids].sort(compareText);
  }
}

function compareEdges(left: ViewEdge, right: ViewEdge): number {
  return compareText(left.src, right.src) || compareText(left.type, right.type) || compareText(left.dst, right.dst);
}
