import { placeBesidePinned, unpinnedElkGraph, type ElkLayoutInput } from "./elk-layout-math.js";

interface WorkerScope {
  addEventListener(
    type: "message",
    listener: (event: { data: { id: number; input: ElkLayoutInput } }) => void,
  ): void;
  postMessage(message: unknown): void;
}

interface ElkLike {
  layout(graph: unknown): Promise<{ children?: Array<{ id?: string; x?: number; y?: number }> }>;
}

const scope = globalThis as unknown as WorkerScope;

scope.addEventListener("message", (event) => {
  void layoutInWorker(event.data.id, event.data.input);
});

async function layoutInWorker(id: number, input: ElkLayoutInput): Promise<void> {
  try {
    const imported = (await import("elkjs/lib/elk.bundled.js")) as unknown as { default?: new () => ElkLike };
    const Ctor = imported.default;
    if (!Ctor) throw new Error("elkjs default export missing");
    const elk = new Ctor();
    const graph = unpinnedElkGraph(input);
    const laidOut =
      graph.children.length === 0 ? { children: [] } : await elk.layout(graph);
    const children = (laidOut.children ?? []).flatMap((child) => {
      if (!child.id) return [];
      return [{ id: child.id, x: child.x ?? 0, y: child.y ?? 0 }];
    });
    scope.postMessage({ id, kind: "layout_result", points: placeBesidePinned(input, children) });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    scope.postMessage({ id, kind: "layout_error", message });
  }
}
