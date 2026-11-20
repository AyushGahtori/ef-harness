import type { DecisionFields, NodeLifecycle } from "./types.js";
import {
  type ChangeSetProposal,
  type CommitChangeSetResult,
  type EdgeMutation,
  type KnowledgeGraphPort,
  type NodeMutation,
} from "./graph-port.js";

export interface DecisionEdge {
  readonly type: string;
  readonly dst: string;
}

export interface DecisionWrite {
  readonly id: string;
  readonly kind: string;
  readonly title: string;
  readonly text: string;
  readonly fields: DecisionFields;
  readonly nodeStatus: NodeLifecycle;
  readonly edges: readonly DecisionEdge[];
  readonly retireEdges: readonly DecisionEdge[];
  readonly summary: string;
}

export function writeDecision(graph: KnowledgeGraphPort, write: DecisionWrite): CommitChangeSetResult {
  const existing = graph.getNode(write.id);
  const proposal: ChangeSetProposal = {
    origin: "kernel",
    author: "entailment-checker@1",
    summary: write.summary,
    nodes: [
      existing
        ? {
            op: "update",
            id: write.id,
            class: "breaking",
            title: write.title,
            text: write.text,
            fields: write.fields,
            status: write.nodeStatus,
          }
        : {
            op: "create",
            id: write.id,
            kind: write.kind,
            title: write.title,
            text: write.text,
            fields: write.fields,
            status: write.nodeStatus === "draft" || write.nodeStatus === "active" ? write.nodeStatus : "active",
          },
    ],
    edges: [
      ...write.retireEdges.map(
        (edge): EdgeMutation => ({ op: "retire", src: write.id, type: edge.type, dst: edge.dst }),
      ),
      ...write.edges.map((edge): EdgeMutation => ({ op: "create", src: write.id, type: edge.type, dst: edge.dst })),
    ],
  };
  return graph.commitChangeSet(proposal);
}

export function writeMany(
  graph: KnowledgeGraphPort,
  writes: readonly DecisionWrite[],
  summary: string,
): CommitChangeSetResult | null {
  if (writes.length === 0) return null;
  const nodes: NodeMutation[] = [];
  const edges: EdgeMutation[] = [];
  for (const write of writes) {
    const existing = graph.getNode(write.id);
    nodes.push(
      existing
        ? {
            op: "update",
            id: write.id,
            class: "breaking",
            title: write.title,
            text: write.text,
            fields: write.fields,
            status: write.nodeStatus,
          }
        : {
            op: "create",
            id: write.id,
            kind: write.kind,
            title: write.title,
            text: write.text,
            fields: write.fields,
            status: write.nodeStatus === "draft" || write.nodeStatus === "active" ? write.nodeStatus : "active",
          },
    );
    for (const edge of write.retireEdges) {
      edges.push({ op: "retire", src: write.id, type: edge.type, dst: edge.dst });
    }
    for (const edge of write.edges) {
      edges.push({ op: "create", src: write.id, type: edge.type, dst: edge.dst });
    }
  }
  return graph.commitChangeSet({
    origin: "kernel",
    author: "entailment-checker@1",
    summary,
    nodes,
    edges,
  });
}
