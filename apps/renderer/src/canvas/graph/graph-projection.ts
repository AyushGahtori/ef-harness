import { conflictBubblesForLevel } from "./conflict-bubbling.js";
import { focusNeighborhood } from "./focus-neighborhood.js";
import type { CanvasSearchAndFilterBar } from "./canvas-search-and-filter-bar.js";
import type { SemanticZoomController } from "./semantic-zoom.js";
import type { SavedNodePositionStore } from "./saved-node-position-store.js";
import type {
  CanonicalGraphEdge,
  CanonicalGraphNode,
  CanvasGraphSnapshot,
  CanvasViewportState,
  GraphViewEdge,
  GraphViewNode,
} from "./types.js";
import { FOCUS_NEIGHBORHOOD_EDGE_TYPES } from "./types.js";

export interface ProjectGraphInput {
  readonly nodes: readonly CanonicalGraphNode[];
  readonly edges: readonly CanonicalGraphEdge[];
  readonly viewport: CanvasViewportState;
  readonly zoomController: SemanticZoomController;
  readonly positions: SavedNodePositionStore;
  readonly filters: CanvasSearchAndFilterBar;
  readonly focusNodeId: string | null;
  readonly focusNeighborhood: boolean;
}

export function projectCanvasGraph(input: ProjectGraphInput): CanvasGraphSnapshot {
  const level = input.zoomController.applyViewportZoom(input.viewport.zoom);
  const bubbles = conflictBubblesForLevel(input.nodes, input.edges, level);
  const filterState = input.filters.getFilters();
  const searchMatches = filterState.searchQuery.trim()
    ? input.filters.searchMatches(filterState.searchQuery)
    : [];

  const neighborhood =
    input.focusNeighborhood && input.focusNodeId
      ? focusNeighborhood(input.focusNodeId, input.edges, FOCUS_NEIGHBORHOOD_EDGE_TYPES)
      : null;

  const viewNodes: GraphViewNode[] = [];
  for (const node of input.nodes) {
    if (!input.zoomController.nodeVisibleAtLevel(node, level)) continue;
    const passes = input.filters.nodePasses(node, filterState);
    const pos = input.positions.positionFor(node.id, level);
    let dimmed = neighborhood ? !neighborhood.has(node.id) : !passes;
    let highlighted = searchMatches.includes(node.id);
    if (!neighborhood && (filterState.brownfieldLayer === "both" || filterState.brownfieldLayer === "change")) {
      if (node.brownfieldLayer === "today") dimmed = true;
      if (node.brownfieldLayer === "change") highlighted = true;
    }
    viewNodes.push({
      id: node.id,
      label: node.kind === "task" && node.agentId ? `${node.agentId} · ${node.title}` : node.title,
      kind: node.kind,
      basis: node.basis,
      dimmed,
      highlighted,
      conflictBubble: bubbles.get(node.id) ?? false,
      aggregateBadge:
        level === 1 && node.kind === "feature"
          ? input.zoomController.clusterLabel(node.id, input.nodes)
          : null,
      taskBadge: node.taskBadge,
      agentId: node.agentId,
      skeletonLocked: node.skeletonLocked,
      x: pos?.x ?? 0,
      y: pos?.y ?? 0,
    });
  }

  const visibleNodes = collapseLevel1Clusters(viewNodes, input.nodes);
  const visibleIds = new Set(visibleNodes.map((node) => node.id));
  const viewEdges: GraphViewEdge[] = [];
  input.edges.forEach((edge, index) => {
    if (!visibleIds.has(edge.src) || !visibleIds.has(edge.dst)) return;
    const conflict = edge.type === "contradicts";
    const dimmed = neighborhood ? !neighborhood.has(edge.src) || !neighborhood.has(edge.dst) : false;
    viewEdges.push({
      id: `edge-${String(index)}`,
      source: edge.src,
      target: edge.dst,
      type: edge.type,
      dimmed,
      conflict,
    });
  });

  return {
    nodes: visibleNodes,
    edges: viewEdges,
    viewport: input.viewport,
    semanticLevel: level,
    focusNodeId: input.focusNodeId,
    matchNodeIds: searchMatches,
    minimapCollapsed: false,
    searchArmed: false,
    panning: false,
  };
}

const LEVEL1_CLUSTER_CAP = 15;

function collapseLevel1Clusters(
  viewNodes: readonly GraphViewNode[],
  source: readonly CanonicalGraphNode[],
): GraphViewNode[] {
  const features = viewNodes.filter((node) => node.kind === "feature");
  if (features.length <= LEVEL1_CLUSTER_CAP) return [...viewNodes];
  const clusters: GraphViewNode[] = [];
  for (let index = 0; index < LEVEL1_CLUSTER_CAP; index += 1) {
    const members = features.filter((_, memberIndex) => memberIndex % LEVEL1_CLUSTER_CAP === index);
    const first = members[0];
    if (!first) continue;
    const featureIds = new Set(members.map((member) => member.id));
    const tasks = source.filter(
      (node) => node.kind === "task" && node.feature !== null && featureIds.has(node.feature),
    );
    const done = tasks.filter((task) => task.taskBadge === "done").length;
    const held = tasks.filter((task) => task.taskBadge === "held").length;
    const title = members.length === 1 ? first.label : `${first.label} +${String(members.length - 1)}`;
    clusters.push({
      ...first,
      id: `cluster-${String(index)}`,
      label: title,
      conflictBubble: members.some((member) => member.conflictBubble),
      highlighted: members.some((member) => member.highlighted),
      dimmed: members.every((member) => member.dimmed),
      aggregateBadge: `${title} · ${String(done)}/${String(tasks.length)} done${held > 0 ? ` · ${String(held)} held` : ""}`,
      x: first.x,
      y: index * 88,
    });
  }
  return [...viewNodes.filter((node) => node.kind !== "feature"), ...clusters];
}

export function initialComfortableZoom(nodeCount: number): number {
  if (nodeCount <= 5) return 1;
  if (nodeCount <= 40) return 0.85;
  if (nodeCount <= 150) return 0.6;
  return 0.35;
}