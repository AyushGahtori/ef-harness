import type {
  CanvasLayoutPersistencePort,
  GraphEventPatch,
  GraphEventStreamPort,
  KnowledgeGraphRepoPort,
  ShellLayoutContextPort,
} from "./ports.js";
import type {
  CanonicalGraphEdge,
  CanonicalGraphNode,
  CanvasFilterState,
  CanvasViewportState,
  ImpactEdgeType,
  SavedLayoutPosition,
  ShellLayoutCanvasSlice,
} from "./types.js";

export class MemoryCanvasLayoutPersistence implements CanvasLayoutPersistencePort {
  private rows: SavedLayoutPosition[] = [];

  loadAll(viewLevel: number): readonly SavedLayoutPosition[] {
    return this.rows.filter((row) => row.viewLevel === viewLevel);
  }

  upsert(row: SavedLayoutPosition): void {
    const idx = this.rows.findIndex((r) => r.nodeId === row.nodeId && r.viewLevel === row.viewLevel);
    if (idx >= 0) this.rows[idx] = row;
    else this.rows.push(row);
  }

  clearUnpinned(viewLevel: number): void {
    this.rows = this.rows.filter((row) => row.viewLevel !== viewLevel || row.pinnedByUser);
  }

  clearLevel(viewLevel: number): void {
    this.rows = this.rows.filter((row) => row.viewLevel !== viewLevel);
  }
}

export class MemoryKnowledgeGraphRepo implements KnowledgeGraphRepoPort {
  constructor(
    private nodes: CanonicalGraphNode[] = [],
    private edges: CanonicalGraphEdge[] = [],
  ) {}

  load(nodes: readonly CanonicalGraphNode[], edges: readonly CanonicalGraphEdge[]): void {
    this.nodes = [...nodes];
    this.edges = [...edges];
  }

  listActiveNodes(): readonly CanonicalGraphNode[] {
    return this.nodes.filter((n) => n.status === "active" || n.status === "draft");
  }

  listActiveEdges(): readonly CanonicalGraphEdge[] {
    return this.edges;
  }

  getNode(nodeId: string): CanonicalGraphNode | null {
    return this.nodes.find((n) => n.id === nodeId) ?? null;
  }

  impactWalk(nodeId: string, edgeTypes: readonly ImpactEdgeType[]): readonly string[] {
    const allowed = new Set<string>(edgeTypes);
    const seen = new Set<string>([nodeId]);
    const queue = [nodeId];
    while (queue.length > 0) {
      const current = queue.shift();
      if (!current) break;
      for (const edge of this.edges) {
        if (!allowed.has(edge.type)) continue;
        if (edge.src === current && !seen.has(edge.dst)) {
          seen.add(edge.dst);
          queue.push(edge.dst);
        }
        if (edge.dst === current && !seen.has(edge.src)) {
          seen.add(edge.src);
          queue.push(edge.src);
        }
      }
    }
    return [...seen];
  }
}

export class MemoryGraphEventStream implements GraphEventStreamPort {
  private listeners = new Set<(patch: GraphEventPatch) => void>();

  subscribe(listener: (patch: GraphEventPatch) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(patch: GraphEventPatch): void {
    for (const listener of this.listeners) listener(patch);
  }
}

export class MemoryShellLayoutContext implements ShellLayoutContextPort {
  private saved = false;
  private slice: ShellLayoutCanvasSlice = {
    viewport: { x: 0, y: 0, zoom: 1 },
    filters: {
      status: "all",
      nodeType: "all",
      brownfieldLayer: "both",
      searchQuery: "",
      phase: "all",
    },
  };

  readCanvas(): ShellLayoutCanvasSlice {
    return this.slice;
  }

  writeCanvas(next: Partial<ShellLayoutCanvasSlice>): void {
    this.saved = true;
    if (next.viewport) this.slice = { ...this.slice, viewport: next.viewport };
    if (next.filters) this.slice = { ...this.slice, filters: { ...this.slice.filters, ...next.filters } };
  }

  hasSavedSession(): boolean {
    return this.saved;
  }
}

export function defaultCanvasFilters(): CanvasFilterState {
  return {
    status: "all",
    nodeType: "all",
    brownfieldLayer: "both",
    searchQuery: "",
    phase: "all",
  };
}

export function defaultViewport(): CanvasViewportState {
  return { x: 0, y: 0, zoom: 1 };
}