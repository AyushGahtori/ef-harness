import { beforeAll, describe, expect, it } from "vitest";
import { threadId } from "node:worker_threads";
import { renderToStaticMarkup } from "react-dom/server";
import { ElkIncrementalLayoutEngine } from "../../src/canvas/graph/elk-incremental-layout-engine.js";
import { InteractiveArchitectureCanvas } from "../../src/canvas/graph/interactive-architecture-canvas.js";
import { MemoryGraphEventStream, MemoryKnowledgeGraphRepo } from "../../src/canvas/graph/local-ports.js";
import { FixtureCanvasLayoutPersistence, FixtureShellLayoutContext } from "./memory-ports.js";
import { SavedNodePositionStore } from "../../src/canvas/graph/saved-node-position-store.js";
import { projectCanvasGraph } from "../../src/canvas/graph/graph-projection.js";
import { SemanticZoomController } from "../../src/canvas/graph/semantic-zoom.js";
import { CanvasSearchAndFilterBar } from "../../src/canvas/graph/canvas-search-and-filter-bar.js";
import { CANVAS_REACT_FLOW_DEFAULTS } from "../../src/canvas/graph/react-flow-config.js";
import { contrastRatioPass, visualGrammarForNode } from "../../src/canvas/graph/visual-grammar.js";
import { renderAccessibleCanvasList } from "../../src/canvas/graph/accessible-list-view.js";
import { renderCanvasSurface } from "../../src/canvas/graph/canvas-surface.js";
import { projectStateDbNode } from "../../src/canvas/graph/state-db-node.js";
import { buildSyntheticGraph, edge, node } from "./fixtures.js";
import { installNodeLayoutHost } from "./layout-host.js";

beforeAll(() => {
  installNodeLayoutHost();
});

function canvasHarness(): {
  canvas: InteractiveArchitectureCanvas;
  graph: MemoryKnowledgeGraphRepo;
  shell: FixtureShellLayoutContext;
  events: MemoryGraphEventStream;
} {
  const graph = new MemoryKnowledgeGraphRepo();
  const events = new MemoryGraphEventStream();
  const shell = new FixtureShellLayoutContext();
  const canvas = new InteractiveArchitectureCanvas({
    graph,
    events,
    shell,
    positions: new SavedNodePositionStore(new FixtureCanvasLayoutPersistence()),
    useLayoutWorker: false,
  });
  return { canvas, graph, shell, events };
}

describe("InteractiveArchitectureCanvas", () => {
  it("projects canonical SQLite nodes across semantic zoom levels", async () => {
    const { canvas, graph } = canvasHarness();
    graph.load(
      [
        node({ id: "F1", kind: "feature", title: "Kitchen", phase: "plan", feature: "F1" }),
        node({ id: "R17", kind: "decision", title: "Cutoff", basis: "explicit" }),
        node({ id: "T03", kind: "task", title: "print page", taskBadge: "working", agentId: "A0014" }),
      ],
      [edge("T03", "F1", "implements")],
    );
    await canvas.bootstrap();
    canvas.setSemanticZoomPill(1);
    let snap = canvas.reproject();
    expect(snap.nodes.some((n) => n.id === "F1")).toBe(true);
    expect(snap.nodes.some((n) => n.id === "R17")).toBe(false);
    canvas.setSemanticZoomPill(3);
    snap = canvas.reproject();
    expect(snap.nodes.some((n) => n.id === "R17")).toBe(true);
    canvas.setSemanticZoomPill(4);
    snap = canvas.reproject();
    expect(snap.nodes.some((n) => n.id === "T03")).toBe(true);
  }, 30_000);

  it("preserves viewport and filters via ShellLayoutContext", async () => {
    const { canvas, shell } = canvasHarness();
    await canvas.bootstrap();
    canvas.setSearchQuery("Orders");
    canvas.syncToShell();
    const slice = shell.readCanvas();
    expect(slice.filters.searchQuery).toBe("Orders");
    shell.writeCanvas({ viewport: { x: 120, y: 80, zoom: 0.72 } });
    canvas.syncFromShell();
    expect(canvas.reproject().viewport).toEqual({ x: 120, y: 80, zoom: 0.72 });
  }, 30_000);

  it("coalesces burst graph events into one layout refresh", async () => {
    const { canvas, graph, events } = canvasHarness();
    graph.load([node({ id: "A", kind: "feature", title: "A" })], []);
    await canvas.bootstrap();
    const before = canvas.readSnapshot()?.nodes.length ?? 0;
    for (let i = 0; i < 20; i += 1) {
      graph.load(
        [...graph.listActiveNodes(), node({ id: `N${i}`, kind: "requirement", title: `N${i}` })],
        [],
      );
      events.emit({ kind: "nodes_upserted", nodeIds: [`N${i}`] });
    }
    await canvas.flushPendingGraphUpdates();
    expect(canvas.passes).toBe(2);
    const after = canvas.readSnapshot()?.nodes.length ?? 0;
    expect(after).toBeGreaterThan(before);
  }, 30_000);

  it("uses viewport culling defaults and accessible list fallback", () => {
    expect(CANVAS_REACT_FLOW_DEFAULTS.onlyRenderVisibleElements).toBe(true);
    const nodes = [
      { id: "A", label: "Staff", kind: "entity" as const, basis: null, dimmed: false, highlighted: false, conflictBubble: false, aggregateBadge: null, taskBadge: null, agentId: null, skeletonLocked: false, x: 0, y: 0 },
    ];
    const html = renderToStaticMarkup(renderAccessibleCanvasList(nodes));
    expect(html).toContain("Staff");
    expect(html).toContain('role="list"');
  });

  it("passes WCAG AA contrast for every basis in light and dark", () => {
    const bases = ["explicit", "derived", "delegated", "defaulted", "proposed", "observed"] as const;
    for (const theme of ["light", "dark"] as const) {
      for (const basis of bases) {
        const grammar = visualGrammarForNode({ basis, hasConflict: false, skeletonLocked: false, theme });
        expect(contrastRatioPass(grammar.textColor, grammar.fill)).toBe(true);
        expect(grammar.icon.length).toBeGreaterThan(0);
      }
      const conflict = visualGrammarForNode({ basis: "explicit", hasConflict: true, skeletonLocked: false, theme });
      const locked = visualGrammarForNode({ basis: "explicit", hasConflict: false, skeletonLocked: true, theme });
      expect(conflict.badge).toBe("Conflict");
      expect(locked.badge).toBe("Locked");
      expect(contrastRatioPass(conflict.textColor, conflict.fill)).toBe(true);
      expect(contrastRatioPass(locked.textColor, locked.fill)).toBe(true);
    }
    const chosen = visualGrammarForNode({
      basis: "delegated",
      hasConflict: false,
      skeletonLocked: false,
      theme: "light",
    });
    expect(chosen.badge).toBe("Chosen for you");
    expect(chosen.borderStyle).toBe("dashed");
  });

  it("centers fresh discovery projects at comfortable zoom", async () => {
    const { canvas, graph } = canvasHarness();
    graph.load(
      [node({ id: "A", kind: "decision", title: "Db" }), node({ id: "B", kind: "decision", title: "Auth" }), node({ id: "C", kind: "feature", title: "MVP" })],
      [],
    );
    await canvas.bootstrap();
    expect(canvas.reproject().viewport.zoom).toBe(1);
  }, 30_000);

  it("keeps a saved shell viewport when the canvas is opened again", async () => {
    const shell = new FixtureShellLayoutContext();
    shell.writeCanvas({ viewport: { x: 40, y: 20, zoom: 0.72 }, filters: { searchQuery: "Orders", status: "held", nodeType: "task", brownfieldLayer: "change", phase: "build" } });
    const graph = new MemoryKnowledgeGraphRepo();
    graph.load([node({ id: "T1", kind: "task", title: "print", phase: "build", taskBadge: "held" })], []);
    const canvas = new InteractiveArchitectureCanvas({
      graph,
      events: new MemoryGraphEventStream(),
      shell,
      positions: new SavedNodePositionStore(new FixtureCanvasLayoutPersistence()),
      useLayoutWorker: false,
    });
    await canvas.bootstrap();
    const snap = canvas.reproject();
    expect(snap.viewport).toEqual({ x: 40, y: 20, zoom: 0.72 });
    expect(snap.searchArmed).toBe(false);
    canvas.handleKey({ key: "f", ctrlKey: true, shiftKey: false, spaceDown: false });
    expect(canvas.searchOpen).toBe(true);
    canvas.handleKey({ key: " ", ctrlKey: false, shiftKey: false, spaceDown: true });
    expect(canvas.reproject().panning).toBe(true);
  }, 30_000);

  it("projects canonical state.db rows and renders the canvas surface", async () => {
    const projected = projectStateDbNode({
      id: "T07",
      kind: "task",
      title: "print page",
      text: "leaf",
      status: "active",
      version: 1,
      fields: JSON.stringify({ basis: "explicit", feature: "F1", task_state: "CODING", agentId: "A0014", phase: "build" }),
    });
    expect(projected?.taskBadge).toBe("working");
    expect(projected?.agentId).toBe("A0014");
    const { canvas, graph } = canvasHarness();
    if (projected) graph.load([projected, node({ id: "F1", kind: "feature", title: "Orders", feature: "F1", phase: "plan" })], []);
    await canvas.bootstrap();
    canvas.setSemanticZoomPill(4);
    const snap = canvas.reproject();
    expect(snap.nodes.some((item) => item.label.includes("A0014 · print page"))).toBe(true);
    const html = renderToStaticMarkup(renderCanvasSurface(snap));
    expect(html).toContain("Auto-arrange layout");
    expect(html).toContain('data-minimap-corner="bottom-right"');
    expect(html).toContain("Architecture canvas nodes");
    expect(CANVAS_REACT_FLOW_DEFAULTS.onlyRenderVisibleElements).toBe(true);
  }, 30_000);
});

describe("large graph layout", () => {
  it("lays out 300 nodes and 600+ edges without losing pinned anchors", async () => {
    const engine = new ElkIncrementalLayoutEngine();
    const store = new SavedNodePositionStore(new FixtureCanvasLayoutPersistence());
    const { nodes, edges } = buildSyntheticGraph(300);
    expect(edges.length).toBeGreaterThanOrEqual(600);
    const level = 2 as const;
    store.hydrate(level);
    for (let i = 0; i < 8; i += 1) store.pinDragged(`N${i + 1}`, level, i * 120, 40);

    const points = await engine.layoutIncremental({
      nodeIds: nodes.map((item) => item.id),
      edges,
      pinned: store.listPinned(level),
    });
    store.applyLayout(points, level);

    for (let i = 0; i < 8; i += 1) {
      expect(store.positionFor(`N${i + 1}`, level)).toEqual({ x: i * 120, y: 40 });
    }
    expect(engine.lastWorkerThreadId).not.toBe(threadId);
    expect(engine.lastMainThreadBlockingMs).toBeLessThan(50);
    const snap = projectCanvasGraph({
      nodes,
      edges,
      viewport: { x: 0, y: 0, zoom: 0.35 },
      zoomController: new SemanticZoomController(),
      positions: store,
      filters: new CanvasSearchAndFilterBar(),
      focusNodeId: null,
      focusNeighborhood: false,
    });
    const clusters = snap.nodes.filter((item) => item.kind === "feature" || item.id.startsWith("cluster-"));
    expect(clusters.length).toBeGreaterThan(0);
    expect(clusters.length).toBeLessThanOrEqual(15);
    expect(snap.semanticLevel).toBe(1);
  }, 90_000);
});