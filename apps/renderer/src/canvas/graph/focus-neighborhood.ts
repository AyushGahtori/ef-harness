import type { CanonicalGraphEdge, ImpactEdgeType } from "./types.js";

export function focusNeighborhood(
  nodeId: string,
  edges: readonly CanonicalGraphEdge[],
  edgeTypes: readonly ImpactEdgeType[],
): ReadonlySet<string> {
  const allowed = new Set<string>(edgeTypes);
  const keep = new Set<string>([nodeId]);
  for (const edge of edges) {
    if (!allowed.has(edge.type as ImpactEdgeType)) continue;
    if (edge.src === nodeId) keep.add(edge.dst);
    if (edge.dst === nodeId) keep.add(edge.src);
  }
  return keep;
}