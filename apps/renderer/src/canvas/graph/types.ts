export const SEMANTIC_ZOOM_THRESHOLDS = {
  level1Max: 0.45,
  level2Max: 0.85,
  level3Max: 1.35,
} as const;

export type SemanticZoomLevel = 1 | 2 | 3 | 4;

export type ProjectPhase = "discover" | "plan" | "build" | "ship";

export type NodeBasis =
  | "explicit"
  | "derived"
  | "delegated"
  | "defaulted"
  | "proposed"
  | "observed";

export type BrownfieldLayer = "today" | "change" | "both";

export type CanvasNodeKind =
  | "decision"
  | "requirement"
  | "rule"
  | "feature"
  | "entity"
  | "contract"
  | "api_endpoint"
  | "screen_spec"
  | "task"
  | "arch_node"
  | "spec_item"
  | "brownfield_module"
  | "scope"
  | "project"
  | "integration"
  | "seam"
  | "conflict";

export type ImpactEdgeType =
  | "depends_on"
  | "derived_from"
  | "implements"
  | "consumes"
  | "consumes_contract"
  | "contradicts";

export const FOCUS_NEIGHBORHOOD_EDGE_TYPES: readonly ImpactEdgeType[] = [
  "depends_on",
  "derived_from",
  "implements",
  "consumes",
  "consumes_contract",
  "contradicts",
];

export type CanvasStatusFilter =
  | "all"
  | "open"
  | "conflicts"
  | "delegated"
  | "working"
  | "held"
  | "done";

export type CanvasNodeTypeFilter = CanvasNodeKind | "all";

export type TaskRuntimeBadge = "working" | "verifying" | "held" | "done" | "queued";

export interface CanonicalGraphNode {
  readonly id: string;
  readonly kind: CanvasNodeKind;
  readonly title: string;
  readonly text: string;
  readonly basis: NodeBasis | null;
  readonly status: "draft" | "active" | "retired" | "superseded";
  readonly phase: ProjectPhase;
  readonly feature: string | null;
  readonly fields: Readonly<Record<string, unknown>>;
  readonly taskBadge: TaskRuntimeBadge | null;
  readonly agentId: string | null;
  readonly brownfieldLayer: "today" | "change" | null;
  readonly skeletonLocked: boolean;
  readonly hasConflict: boolean;
}

export interface CanonicalGraphEdge {
  readonly src: string;
  readonly dst: string;
  readonly type: string;
}

export interface CanvasViewportState {
  readonly x: number;
  readonly y: number;
  readonly zoom: number;
}

export interface CanvasFilterState {
  readonly status: CanvasStatusFilter;
  readonly nodeType: CanvasNodeTypeFilter;
  readonly brownfieldLayer: BrownfieldLayer;
  readonly searchQuery: string;
  readonly phase: ProjectPhase | "all";
}

export interface SavedLayoutPosition {
  readonly nodeId: string;
  readonly viewLevel: SemanticZoomLevel;
  readonly x: number;
  readonly y: number;
  readonly pinnedByUser: boolean;
}

export interface LayoutPoint {
  readonly nodeId: string;
  readonly x: number;
  readonly y: number;
}

export interface GraphViewNode {
  readonly id: string;
  readonly label: string;
  readonly kind: CanvasNodeKind;
  readonly basis: NodeBasis | null;
  readonly dimmed: boolean;
  readonly highlighted: boolean;
  readonly conflictBubble: boolean;
  readonly aggregateBadge: string | null;
  readonly taskBadge: TaskRuntimeBadge | null;
  readonly agentId: string | null;
  readonly skeletonLocked: boolean;
  readonly x: number;
  readonly y: number;
}

export interface GraphViewEdge {
  readonly id: string;
  readonly source: string;
  readonly target: string;
  readonly type: string;
  readonly dimmed: boolean;
  readonly conflict: boolean;
}

export interface CanvasGraphSnapshot {
  readonly nodes: readonly GraphViewNode[];
  readonly edges: readonly GraphViewEdge[];
  readonly viewport: CanvasViewportState;
  readonly semanticLevel: SemanticZoomLevel;
  readonly focusNodeId: string | null;
  readonly matchNodeIds: readonly string[];
  readonly minimapCollapsed: boolean;
  readonly searchArmed: boolean;
  readonly panning: boolean;
}

export interface ShellLayoutCanvasSlice {
  readonly viewport: CanvasViewportState;
  readonly filters: CanvasFilterState;
}