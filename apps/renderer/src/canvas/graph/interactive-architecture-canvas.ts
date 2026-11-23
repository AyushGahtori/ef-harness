import { CanvasSearchAndFilterBar } from "./canvas-search-and-filter-bar.js";
import { CanvasSelectionContext } from "./canvas-selection-context.js";
import type { ElkLayoutInput } from "./elk-incremental-layout-engine.js";
import { CanvasFrameBatcher } from "./frame-batcher.js";
import { initialComfortableZoom, projectCanvasGraph } from "./graph-projection.js";
import { reduceCanvasKey, spatialNeighbor, tabOrderIds } from "./keyboard-navigation.js";
import { createLayoutWorkerClient, type LayoutWorkerClient } from "./layout-worker-client.js";
import type {
  GraphEventStreamPort,
  KnowledgeGraphRepoPort,
  ShellLayoutContextPort,
  WorkerInspectorPort,
} from "./ports.js";
import { SavedNodePositionStore } from "./saved-node-position-store.js";
import { SemanticZoomController } from "./semantic-zoom.js";
import type { CanvasGraphSnapshot, CanvasViewportState, ProjectPhase, SemanticZoomLevel } from "./types.js";

export interface InteractiveArchitectureCanvasOptions {
  readonly graph: KnowledgeGraphRepoPort;
  readonly events: GraphEventStreamPort;
  readonly shell: ShellLayoutContextPort;
  readonly positions: SavedNodePositionStore;
  readonly inspector?: WorkerInspectorPort;
  readonly useLayoutWorker?: boolean;
}

export class InteractiveArchitectureCanvas {
  readonly selection = new CanvasSelectionContext();
  readonly zoomController = new SemanticZoomController();
  readonly filters = new CanvasSearchAndFilterBar();

  private readonly graph: KnowledgeGraphRepoPort;
  private readonly events: GraphEventStreamPort;
  private readonly shell: ShellLayoutContextPort;
  private readonly positions: SavedNodePositionStore;
  private readonly inspector: WorkerInspectorPort | null;
  private readonly layoutWorker: LayoutWorkerClient;
  private readonly eventBatcher = new CanvasFrameBatcher<number>();
  private unsubscribe: (() => void) | null = null;
  private snapshot: CanvasGraphSnapshot | null = null;
  private tabFocusId: string | null = null;
  private panning = false;
  private minimapCollapsed = false;
  private searchArmed = false;
  private layoutPassCount = 0;

  constructor(options: InteractiveArchitectureCanvasOptions) {
    this.graph = options.graph;
    this.events = options.events;
    this.shell = options.shell;
    this.positions = options.positions;
    this.inspector = options.inspector ?? null;
    this.layoutWorker = createLayoutWorkerClient(options.useLayoutWorker ?? false);
    this.unsubscribe = this.events.subscribe((patch) => {
      const count = patch.edgeCount ?? patch.nodeIds?.length ?? 1;
      this.eventBatcher.push(count, () => {
        void this.refreshLayout();
      });
    });
  }

  dispose(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.layoutWorker.dispose();
  }

  async bootstrap(): Promise<void> {
    const nodes = this.graph.listActiveNodes();
    const saved = this.shell.readCanvas();
    const level = this.zoomController.applyViewportZoom(saved.viewport.zoom);
    this.positions.hydrate(level);
    this.filters.rebuildIndex(nodes);
    this.filters.setFilters(saved.filters);
    if (!this.shell.hasSavedSession()) {
      const zoom = initialComfortableZoom(nodes.length);
      this.writeViewport({ ...this.readViewport(), zoom });
    }
    await this.refreshLayout();
  }

  readSnapshot(): CanvasGraphSnapshot | null {
    return this.snapshot;
  }

  reproject(): CanvasGraphSnapshot {
    const nodes = this.graph.listActiveNodes();
    const edges = this.graph.listActiveEdges();
    this.filters.rebuildIndex(nodes);
    const selection = this.selection.snapshot();
    const snapshot = projectCanvasGraph({
      nodes,
      edges,
      viewport: this.readViewport(),
      zoomController: this.zoomController,
      positions: this.positions,
      filters: this.filters,
      focusNodeId: selection.focusedNodeId,
      focusNeighborhood: selection.focusNeighborhoodActive,
    });
    this.snapshot = {
      ...snapshot,
      minimapCollapsed: this.minimapCollapsed,
      searchArmed: this.searchArmed,
      panning: this.panning,
    };
    return this.snapshot;
  }

  get passes(): number {
    return this.layoutPassCount;
  }

  async refreshLayout(onlyNodeIds?: readonly string[]): Promise<void> {
    this.layoutPassCount += 1;
    const nodes = this.graph.listActiveNodes();
    const edges = this.graph.listActiveEdges();
    const level = this.zoomController.getLevel();
    const visibleIds = onlyNodeIds ?? nodes.map((n) => n.id);
    const pinned = this.positions.listPinned(level);
    const input: ElkLayoutInput = { nodeIds: visibleIds, edges, pinned };
    const points = await this.layoutWorker.layout(input);
    this.positions.applyLayout(points, level);
    this.reproject();
  }

  async autoArrangeLayout(): Promise<void> {
    const level = this.zoomController.getLevel();
    this.positions.resetAutoArrange(level);
    await this.refreshLayout();
  }

  onNodeDragEnd(nodeId: string, x: number, y: number): void {
    const level = this.zoomController.getLevel();
    this.positions.pinDragged(nodeId, level, x, y);
    this.reproject();
  }

  setSemanticZoomPill(level: SemanticZoomLevel): void {
    this.zoomController.setLevelPill(level);
    const zoom = level === 1 ? 0.35 : level === 2 ? 0.65 : level === 3 ? 1.0 : 1.5;
    this.writeViewport({ ...this.readViewport(), zoom });
    this.persistViewport();
    this.reproject();
  }

  async flushPendingGraphUpdates(): Promise<void> {
    await new Promise<void>((resolve) => {
      this.eventBatcher.flushNow(() => {
        void this.refreshLayout().then(() => resolve());
      });
    });
  }

  setPhase(phase: ProjectPhase): void {
    this.filters.setFilters({ phase });
    this.persistFilters();
    this.reproject();
  }

  toggleMinimap(): void {
    this.minimapCollapsed = !this.minimapCollapsed;
    this.reproject();
  }

  get searchOpen(): boolean {
    return this.searchArmed;
  }

  setSearchQuery(query: string): void {
    this.filters.setFilters({ searchQuery: query });
    const matches = this.filters.searchMatches(query);
    if (matches[0]) this.centerOnNode(matches[0]);
    this.persistFilters();
    this.reproject();
  }

  centerOnNode(nodeId: string): void {
    const pos = this.positions.positionFor(nodeId, this.zoomController.getLevel());
    if (!pos) return;
    this.writeViewport({ ...this.readViewport(), x: -pos.x, y: -pos.y });
    this.persistViewport();
  }

  focusConnected(nodeId: string): void {
    this.selection.focusConnected(nodeId);
    this.reproject();
  }

  openTaskInspector(taskNodeId: string): void {
    this.inspector?.openTaskInspector(taskNodeId);
  }

  handleKey(input: Parameters<typeof reduceCanvasKey>[0]): void {
    const cmd = reduceCanvasKey(input);
    if (!cmd) return;
    if (cmd.kind === "focus_search") {
      this.searchArmed = true;
      this.reproject();
      return;
    }
    if (cmd.kind === "pan_toggle") {
      this.panning = !this.panning;
      return;
    }
    if (cmd.kind === "zoom_in" || cmd.kind === "zoom_out" || cmd.kind === "zoom_fit") {
      const viewport = this.readViewport();
      const zoom =
        cmd.kind === "zoom_fit"
          ? initialComfortableZoom(this.graph.listActiveNodes().length)
          : cmd.kind === "zoom_in"
            ? Math.min(4, viewport.zoom + 0.1)
            : Math.max(0.1, viewport.zoom - 0.1);
      this.writeViewport({ ...viewport, zoom });
      this.persistViewport();
      this.reproject();
      return;
    }
    if (cmd.kind === "move_focus") {
      const visible = (this.snapshot?.nodes ?? []).filter((node) => !node.dimmed);
      const visibleIds = visible.map((node) => node.id);
      if (cmd.direction === "next" || cmd.direction === "prev") {
        this.tabFocusId = tabOrderIds(visibleIds, this.tabFocusId, cmd.direction);
      } else {
        this.tabFocusId = spatialNeighbor(visible, this.tabFocusId, cmd.direction);
      }
      if (this.tabFocusId) this.centerOnNode(this.tabFocusId);
    }
  }

  syncFromShell(): void {
    const canvas = this.shell.readCanvas();
    this.filters.setFilters(canvas.filters);
    this.reproject();
  }

  syncToShell(): void {
    const canvas = this.shell.readCanvas();
    this.shell.writeCanvas({
      viewport: this.readViewport(),
      filters: { ...canvas.filters, ...this.filters.getFilters() },
    });
  }

  private readViewport(): CanvasViewportState {
    return this.shell.readCanvas().viewport;
  }

  private writeViewport(viewport: CanvasViewportState): void {
    this.shell.writeCanvas({ viewport });
  }

  private persistViewport(): void {
    this.shell.writeCanvas({ viewport: this.readViewport() });
  }

  private persistFilters(): void {
    this.shell.writeCanvas({ filters: this.filters.getFilters() });
  }
}