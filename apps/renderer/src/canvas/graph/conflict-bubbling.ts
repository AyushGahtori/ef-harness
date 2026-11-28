import type { CanonicalGraphEdge, CanonicalGraphNode, SemanticZoomLevel } from "./types.js";

export function conflictNodes(edges: readonly CanonicalGraphEdge[]): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const edge of edges) {
    if (edge.type === "contradicts") {
      ids.add(edge.src);
      ids.add(edge.dst);
    }
  }
  return ids;
}

export function conflictBubblesForLevel(
  nodes: readonly CanonicalGraphNode[],
  edges: readonly CanonicalGraphEdge[],
  level: SemanticZoomLevel,
): ReadonlyMap<string, boolean> {
  const direct = conflictNodes(edges);
  const bubbles = new Map<string, boolean>();
  const featureOf = new Map<string, string | null>();
  for (const node of nodes) featureOf.set(node.id, node.feature);

  for (const node of nodes) {
    let show = direct.has(node.id);
    if (!show && level <= 2) {
      for (const conflictId of direct) {
        const feature = featureOf.get(conflictId);
        if (feature && node.feature === feature && (node.kind === "feature" || node.kind === "arch_node")) {
          show = true;
          break;
        }
      }
    }
    bubbles.set(node.id, show);
  }
  return bubbles;
}