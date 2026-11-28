import type { CanonicalGraphEdge, CanonicalGraphNode } from "../../src/canvas/graph/types.js";

export function node(partial: Partial<CanonicalGraphNode> & Pick<CanonicalGraphNode, "id" | "kind" | "title">): CanonicalGraphNode {
  return {
    text: "",
    basis: "explicit",
    status: "active",
    phase: "discover",
    feature: null,
    fields: {},
    taskBadge: null,
    agentId: null,
    brownfieldLayer: null,
    skeletonLocked: false,
    hasConflict: false,
    ...partial,
  };
}

export function edge(src: string, dst: string, type: string): CanonicalGraphEdge {
  return { src, dst, type };
}

export function buildSyntheticGraph(count: number): { nodes: CanonicalGraphNode[]; edges: CanonicalGraphEdge[] } {
  const nodes: CanonicalGraphNode[] = [];
  const edges: CanonicalGraphEdge[] = [];
  const features = Math.max(3, Math.floor(count / 8));
  for (let f = 0; f < features; f += 1) {
    const featureId = `F${f + 1}`;
    nodes.push(
      node({ id: featureId, kind: "feature", title: `Feature ${f + 1}`, phase: "build", feature: featureId }),
    );
  }
  for (let i = 0; i < count; i += 1) {
    const id = `N${i + 1}`;
    const feature = `F${(i % features) + 1}`;
    const kind = i % 17 === 0 ? "decision" : i % 13 === 0 ? "task" : "requirement";
    nodes.push(
      node({
        id,
        kind,
        title: `Node ${i + 1}`,
        feature,
        taskBadge: kind === "task" ? "working" : null,
        agentId: kind === "task" ? "A0014" : null,
        brownfieldLayer: i % 11 === 0 ? "today" : i % 23 === 0 ? "change" : null,
      }),
    );
    if (i > 0) edges.push(edge(`N${i}`, id, i % 5 === 0 ? "contradicts" : "depends_on"));
    if (i % 20 === 0 && i > 0) edges.push(edge(feature, id, "depends_on"));
  }
  for (let k = 0; edges.length < count * 2 && k < count * 4; k += 1) {
    const src = `N${(k % count) + 1}`;
    const dst = `N${((k * 7 + 1) % count) + 1}`;
    if (src === dst) continue;
    edges.push(edge(src, dst, k % 7 === 0 ? "implements" : "derived_from"));
  }
  return { nodes, edges };
}