import type {
  CanonicalGraphEdge,
  CanonicalGraphNode,
  ImpactEdgeType,
  SavedLayoutPosition,
  ShellLayoutCanvasSlice,
} from "./types.js";

/** Local port of Task 017 `KnowledgeGraphRepo` canvas read surface. */
export interface KnowledgeGraphRepoPort {
  listActiveNodes(): readonly CanonicalGraphNode[];
  listActiveEdges(): readonly CanonicalGraphEdge[];
  getNode(nodeId: string): CanonicalGraphNode | null;
  impactWalk(nodeId: string, edgeTypes: readonly ImpactEdgeType[]): readonly string[];
}

/** Local port of Task 032 incremental graph event stream. */
export interface GraphEventStreamPort {
  subscribe(listener: (patch: GraphEventPatch) => void): () => void;
}

export interface GraphEventPatch {
  readonly kind: "nodes_upserted" | "nodes_retired" | "edges_upserted" | "edges_retired" | "batch";
  readonly nodeIds?: readonly string[];
  readonly edgeCount?: number;
}

/** Persists rows shaped like `state.db.canvas_layout`. */
export interface CanvasLayoutPersistencePort {
  loadAll(viewLevel: number): readonly SavedLayoutPosition[];
  upsert(row: SavedLayoutPosition): void;
  clearUnpinned(viewLevel: number): void;
  clearLevel(viewLevel: number): void;
}

/** Local port of Task 122 `ShellLayoutContext` canvas slice. */
export interface ShellLayoutContextPort {
  readCanvas(): ShellLayoutCanvasSlice;
  writeCanvas(slice: Partial<ShellLayoutCanvasSlice>): void;
  hasSavedSession(): boolean;
}

export interface WorkerInspectorPort {
  openTaskInspector(taskNodeId: string): void;
}