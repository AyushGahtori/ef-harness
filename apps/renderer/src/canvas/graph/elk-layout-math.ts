import type { CanonicalGraphEdge, LayoutPoint, SavedLayoutPosition } from "./types.js";

export const CANVAS_NODE_WIDTH = 180;
export const CANVAS_NODE_HEIGHT = 56;
export const CANVAS_LAYOUT_GAP = 64;

export interface ElkLayoutInput {
  readonly nodeIds: readonly string[];
  readonly edges: readonly CanonicalGraphEdge[];
  readonly pinned: readonly SavedLayoutPosition[];
  readonly width?: number;
  readonly height?: number;
}

export interface ElkChildPoint {
  readonly id: string;
  readonly x: number;
  readonly y: number;
}

export interface ElkGraphPayload {
  readonly id: "root";
  readonly layoutOptions: Readonly<Record<string, string>>;
  readonly children: readonly {
    readonly id: string;
    readonly width: number;
    readonly height: number;
  }[];
  readonly edges: readonly {
    readonly id: string;
    readonly sources: readonly string[];
    readonly targets: readonly string[];
  }[];
}

const LAYERED_OPTIONS: Readonly<Record<string, string>> = {
  "elk.algorithm": "layered",
  "elk.direction": "RIGHT",
  "elk.edgeRouting": "ORTHOGONAL",
  "org.eclipse.elk.layered.spacing.nodeNodeBetweenLayers": "48",
  "org.eclipse.elk.spacing.nodeNode": "32",
};

export function unpinnedElkGraph(input: ElkLayoutInput): ElkGraphPayload {
  const pinned = new Set(input.pinned.map((row) => row.nodeId));
  const freeIds = input.nodeIds.filter((id) => !pinned.has(id));
  const free = new Set(freeIds);
  const width = input.width ?? CANVAS_NODE_WIDTH;
  const height = input.height ?? CANVAS_NODE_HEIGHT;
  const edges = input.edges
    .filter((edge) => free.has(edge.src) && free.has(edge.dst))
    .map((edge, index) => ({
      id: `e-${String(index)}`,
      sources: [edge.src],
      targets: [edge.dst],
    }));
  return {
    id: "root",
    layoutOptions: LAYERED_OPTIONS,
    children: freeIds.map((id) => ({ id, width, height })),
    edges,
  };
}

export function placeBesidePinned(
  input: ElkLayoutInput,
  elkFree: readonly ElkChildPoint[],
): readonly LayoutPoint[] {
  const width = input.width ?? CANVAS_NODE_WIDTH;
  const pinnedPoints: LayoutPoint[] = input.pinned
    .filter((row) => input.nodeIds.includes(row.nodeId))
    .map((row) => ({ nodeId: row.nodeId, x: row.x, y: row.y }));
  if (elkFree.length === 0) return pinnedPoints;
  if (pinnedPoints.length === 0) {
    return elkFree.map((child) => ({ nodeId: child.id, x: child.x, y: child.y }));
  }

  let pinnedMaxX = Number.NEGATIVE_INFINITY;
  let pinnedMinY = Number.POSITIVE_INFINITY;
  for (const pin of pinnedPoints) {
    pinnedMaxX = Math.max(pinnedMaxX, pin.x + width);
    pinnedMinY = Math.min(pinnedMinY, pin.y);
  }
  let freeMinX = Number.POSITIVE_INFINITY;
  let freeMinY = Number.POSITIVE_INFINITY;
  for (const child of elkFree) {
    freeMinX = Math.min(freeMinX, child.x);
    freeMinY = Math.min(freeMinY, child.y);
  }
  const dx = pinnedMaxX + CANVAS_LAYOUT_GAP - freeMinX;
  const dy = pinnedMinY - freeMinY;
  const moved: LayoutPoint[] = elkFree.map((child) => ({
    nodeId: child.id,
    x: child.x + dx,
    y: child.y + dy,
  }));
  return [...pinnedPoints, ...moved];
}

export function boxesOverlap(
  a: LayoutPoint,
  b: LayoutPoint,
  width = CANVAS_NODE_WIDTH,
  height = CANVAS_NODE_HEIGHT,
): boolean {
  const separated =
    a.x + width <= b.x || b.x + width <= a.x || a.y + height <= b.y || b.y + height <= a.y;
  return !separated;
}
