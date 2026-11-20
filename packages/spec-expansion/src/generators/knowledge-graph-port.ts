/**
 * Local port of Task 017 `KnowledgeGraphRepo` read surface used by matrix
 * generation (`getNode`, list settled axes). Writes go through
 * `MatrixCellPersistenceRepo`, which speaks `state.db` directly because the
 * Task 017 repository is not on this base.
 */

import { type AxisNode, isSettledBasis, type SettledProjectGraph } from "./types.js";

export interface KnowledgeNodeRecord {
  readonly id: string;
  readonly kind: string;
  readonly title: string;
  readonly featureId: string;
  readonly version: number;
}

export class LocalKnowledgeGraphPort {
  private readonly byId: ReadonlyMap<string, AxisNode>;

  constructor(private readonly graph: SettledProjectGraph) {
    const byId = new Map<string, AxisNode>();
    for (const node of graph.nodes) {
      if (byId.has(node.nodeId)) {
        throw new Error(`duplicate settled node id: ${node.nodeId}`);
      }
      byId.set(node.nodeId, node);
    }
    this.byId = byId;
  }

  getNode(id: string): KnowledgeNodeRecord | null {
    const node = this.byId.get(id);
    if (!node || !isSettledBasis(node)) return null;
    return {
      id: node.nodeId,
      kind: node.kind,
      title: node.title,
      featureId: node.featureId,
      version: 1,
    };
  }

  /** Settled axes only. Proposed or unknown-basis nodes are invisible. */
  listSettledAxes(): readonly AxisNode[] {
    const settled: AxisNode[] = [];
    for (const node of this.graph.nodes) {
      if (isSettledBasis(node)) settled.push(node);
    }
    settled.sort((left, right) => (left.nodeId < right.nodeId ? -1 : left.nodeId > right.nodeId ? 1 : 0));
    return settled;
  }
}
