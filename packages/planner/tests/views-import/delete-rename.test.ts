import { afterEach, describe, expect, it } from "vitest";
import {
  createHarness,
  exportMove,
  exportOrders,
  moveBlock,
  readView,
  removeBlock,
  seedMove,
  seedOrders,
  stripMarkers,
  writeView,
  type Harness,
} from "./support.js";

describe("views-import safe delete, rename, and move", () => {
  let harness: Harness | undefined;
  afterEach(() => {
    harness?.close();
    harness = undefined;
  });

  it("asks before a removed block can be deprecated and never hard-deletes the node or its task", () => {
    harness = createHarness();
    seedOrders(harness.graph);
    exportOrders(harness);
    writeView(harness, "features/orders.md", removeBlock(readView(harness, "features/orders.md"), "R17"));

    const session = harness.importer.reconcile();

    expect(session.deletions).toHaveLength(1);
    expect(session.deletions[0]?.message).toBe(
      "You removed 'Cutoff Rule R17' from orders.md — Mark as removed/deprecated or Restore block?",
    );
    expect(session.deletions[0]?.prompt).toBe("Restore or Deprecate?");
    expect(session.deletions[0]?.actions).toEqual(["deprecate", "restore"]);
    expect(session.deletions[0]?.impact.edges.some((edge) => edge.src === "T-Order" && edge.dst === "R17")).toBe(true);
    expect(harness.graph.getNode("R17")?.status).toBe("active");
    expect(harness.graph.listNodeIds()).toContain("R17");
    expect(harness.graph.listNodeIds()).toContain("T-Order");
    expect(harness.graph.taskRuntime("T-Order")?.state).toBe("READY");
    expect(harness.pause.isHeld("features/orders.md")).toBe(true);

    const cardId = session.deletions[0]?.cardId ?? "";
    harness.importer.commitResolved(session.id, [{ cardId, action: "deprecate" }]);
    expect(harness.graph.getNode("R17")?.status).toBe("retired");
    expect(harness.graph.getNode("R17")?.id).toBe("R17");
    expect(harness.graph.getNode("T-Order")?.status).toBe("active");
    expect(harness.graph.taskRuntime("T-Order")?.state).toBe("READY");
    expect(harness.pause.isHeld("features/orders.md")).toBe(false);
  });

  it("restores a removed block without retiring the node", () => {
    harness = createHarness();
    seedOrders(harness.graph);
    exportOrders(harness);
    writeView(harness, "features/orders.md", removeBlock(readView(harness, "features/orders.md"), "R17"));
    const session = harness.importer.reconcile();
    const cardId = session.deletions[0]?.cardId ?? "";
    harness.importer.commitResolved(session.id, [{ cardId, action: "restore" }]);
    expect(harness.graph.getNode("R17")?.status).toBe("active");
    expect(readView(harness, "features/orders.md")).toContain("id=R17");
    expect(harness.pause.isHeld("features/orders.md")).toBe(false);
  });

  it("renames the display title without changing node id, edges, or the name-registry owner", () => {
    harness = createHarness();
    seedOrders(harness.graph);
    exportOrders(harness);
    const edges = harness.graph.listCurrentEdges();
    writeView(
      harness,
      "features/orders.md",
      readView(harness, "features/orders.md").replace("## Cutoff Rule R17", "## Order Cutoff Rule"),
    );

    const session = harness.importer.reconcile();

    expect(session.conflicts).toHaveLength(0);
    expect(harness.model.calls).toHaveLength(0);
    const node = harness.graph.getNode("R17");
    expect(node?.id).toBe("R17");
    expect(node?.title).toBe("Order Cutoff Rule");
    expect(node?.fields.names).toEqual([{ kind: "title", value: "Order Cutoff Rule" }]);
    expect(harness.graph.listCurrentEdges()).toEqual(edges);
    expect(harness.graph.listNames("R17").map((name) => name.value)).toContain("Order Cutoff Rule");
    expect(harness.graph.listNames("R17").map((name) => name.value)).not.toContain("Cutoff Rule R17");
    expect(harness.graph.listNodeVersions("R17").length).toBeGreaterThan(1);
  });

  it("recognizes a cut-and-paste move and reassigns belongs_to only after confirmation", () => {
    harness = createHarness();
    seedMove(harness.graph);
    exportMove(harness);
    const moved = moveBlock(
      readView(harness, "features/feature-a.md"),
      readView(harness, "features/feature-b.md"),
      "R17",
    );
    writeView(harness, "features/feature-a.md", moved.fromText);
    writeView(harness, "features/feature-b.md", moved.toText);

    const session = harness.importer.reconcile();

    expect(session.moves).toHaveLength(1);
    expect(session.deletions).toHaveLength(0);
    expect(session.moves[0]?.message).toContain("R17");
    expect(session.moves[0]?.message).toContain("feature-a.md");
    expect(session.moves[0]?.message).toContain("feature-b.md");
    expect(session.moves[0]?.actions).toEqual(["confirm_move", "cancel_move"]);
    expect(harness.graph.getNode("R17")?.id).toBe("R17");
    expect(harness.graph.listNodeIds().filter((id) => id === "R17")).toHaveLength(1);
    expect(harness.graph.listCurrentEdges().filter((edge) => edge.type === "belongs_to")).toEqual([
      { src: "R17", type: "belongs_to", dst: "F-A" },
    ]);
    expect(harness.pause.isHeld("features/feature-a.md")).toBe(true);
    expect(harness.pause.isHeld("features/feature-b.md")).toBe(true);

    const cardId = session.moves[0]?.cardId ?? "";
    harness.importer.commitResolved(session.id, [{ cardId, action: "confirm_move" }]);
    expect(harness.graph.listNodeIds().filter((id) => id === "R17")).toHaveLength(1);
    expect(harness.graph.getNode("R17")?.fields.feature).toBe("F-B");
    expect(harness.graph.listCurrentEdges().filter((edge) => edge.type === "belongs_to")).toEqual([
      { src: "R17", type: "belongs_to", dst: "F-B" },
    ]);
    expect(harness.graph.listCurrentEdges().some((edge) => edge.src === "T-Order" && edge.dst === "R17")).toBe(true);
    expect(readView(harness, "features/feature-b.md")).toContain("id=R17");
    expect(readView(harness, "features/feature-a.md")).not.toContain("id=R17");
    expect(harness.pause.isHeld("features/feature-a.md")).toBe(false);
    expect(harness.pause.isHeld("features/feature-b.md")).toBe(false);
  });

  it("asks before a damaged marker becomes a duplicate node", () => {
    harness = createHarness();
    seedOrders(harness.graph);
    exportOrders(harness);
    writeView(harness, "features/orders.md", stripMarkers(readView(harness, "features/orders.md"), "R17"));

    const session = harness.importer.reconcile();

    expect(session.mangled).toHaveLength(1);
    expect(session.mangled[0]?.nodeId).toBe("R17");
    expect(session.mangled[0]?.message).toContain("confirm before creating a duplicate");
    expect(session.deletions).toHaveLength(0);
    expect(harness.model.calls).toHaveLength(0);
    expect(harness.graph.listNodeIds().filter((id) => id.startsWith("R"))).toEqual(["R17"]);
    expect(harness.graph.getNode("R17")?.version).toBe(1);
    expect(harness.pause.isHeld("features/orders.md")).toBe(true);

    const cardId = session.mangled[0]?.cardId ?? "";
    harness.importer.commitResolved(session.id, [{ cardId, action: "reattach" }]);
    expect(harness.graph.listNodeIds().filter((id) => id.startsWith("R"))).toEqual(["R17"]);
    expect(readView(harness, "features/orders.md")).toContain("<!-- ef:node id=R17 ");
    expect(readView(harness, "features/orders.md")).toContain("<!-- /ef:node -->");
    expect(harness.pause.isHeld("features/orders.md")).toBe(false);
  });
});
