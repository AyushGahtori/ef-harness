import { threadId } from "node:worker_threads";
import { beforeAll, describe, expect, it } from "vitest";
import { ElkIncrementalLayoutEngine } from "../../src/canvas/graph/elk-incremental-layout-engine.js";
import { boxesOverlap } from "../../src/canvas/graph/elk-layout-math.js";
import { SavedNodePositionStore } from "../../src/canvas/graph/saved-node-position-store.js";
import { edge } from "./fixtures.js";
import { installNodeLayoutHost } from "./layout-host.js";
import { FixtureCanvasLayoutPersistence } from "./memory-ports.js";

beforeAll(() => {
  installNodeLayoutHost();
});

describe("SavedNodePositionStore + ElkIncrementalLayoutEngine", () => {
  it(
    "keeps user-pinned coordinates while laying out new nodes in open space",
    async () => {
      const persistence = new FixtureCanvasLayoutPersistence();
      const store = new SavedNodePositionStore(persistence);
      const engine = new ElkIncrementalLayoutEngine();
      const level = 2 as const;

      store.hydrate(level);
      for (let index = 0; index < 8; index += 1) {
        const column = index % 4;
        const row = Math.floor(index / 4);
        store.pinDragged(`F${String(index + 1)}`, level, column * 220, row * 120);
      }

      const ids = ["F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8", "N1", "N2", "N3"];
      const points = await engine.layoutIncremental({
        nodeIds: ids,
        edges: [edge("N1", "N2", "depends_on"), edge("N2", "N3", "depends_on")],
        pinned: store.listPinned(level),
      });
      store.applyLayout(points, level);

      for (let index = 0; index < 8; index += 1) {
        const column = index % 4;
        const row = Math.floor(index / 4);
        expect(store.positionFor(`F${String(index + 1)}`, level)).toEqual({
          x: column * 220,
          y: row * 120,
        });
      }
      const pinned = [0, 1, 2, 3, 4, 5, 6, 7].map((index) => ({
        nodeId: `F${String(index + 1)}`,
        x: (index % 4) * 220,
        y: Math.floor(index / 4) * 120,
      }));
      for (const freshId of ["N1", "N2", "N3"]) {
        const placed = store.positionFor(freshId, level);
        expect(placed).not.toBeNull();
        if (!placed) continue;
        for (const pin of pinned) {
          expect(boxesOverlap(pin, placed)).toBe(false);
        }
      }
      expect(engine.lastWorkerThreadId).not.toBe(threadId);
      expect(engine.lastMainThreadBlockingMs).toBeLessThan(50);
    },
    30_000,
  );

  it("auto-arrange clears pinned coordinates for an opt-in reset", () => {
    const store = new SavedNodePositionStore(new FixtureCanvasLayoutPersistence());
    const level = 3 as const;
    store.hydrate(level);
    store.pinDragged("pinned", level, 12, 34);
    store.applyLayout([{ nodeId: "auto", x: 90, y: 100 }], level);
    store.resetAutoArrange(level);
    expect(store.listPinned(level)).toEqual([]);
    expect(store.positionFor("pinned", level)).toBeNull();
    expect(store.positionFor("auto", level)).toBeNull();
  });
});