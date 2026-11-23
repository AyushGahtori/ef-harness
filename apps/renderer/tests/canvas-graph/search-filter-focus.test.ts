import { describe, expect, it } from "vitest";
import { CanvasSearchAndFilterBar } from "../../src/canvas/graph/canvas-search-and-filter-bar.js";
import { focusNeighborhood } from "../../src/canvas/graph/focus-neighborhood.js";
import { conflictBubblesForLevel } from "../../src/canvas/graph/conflict-bubbling.js";
import { node, edge } from "./fixtures.js";

describe("CanvasSearchAndFilterBar", () => {
  it("filters by status, type, and brownfield layer", () => {
    const bar = new CanvasSearchAndFilterBar();
    const nodes = [
      node({ id: "d1", kind: "decision", title: "Open", status: "draft" }),
      node({ id: "t1", kind: "task", title: "Held task", taskBadge: "held" }),
      node({ id: "b1", kind: "brownfield_module", title: "src/auth", brownfieldLayer: "today" }),
      node({ id: "b2", kind: "feature", title: "New checkout", brownfieldLayer: "change" }),
    ];
    bar.rebuildIndex(nodes);
    bar.setFilters({ status: "held", nodeType: "all", brownfieldLayer: "both" });
    expect(bar.nodePasses(nodes[1]!, bar.getFilters())).toBe(true);
    bar.setFilters({ status: "all", nodeType: "all", brownfieldLayer: "change" });
    expect(bar.nodePasses(nodes[3]!, bar.getFilters())).toBe(true);
    expect(bar.nodePasses(nodes[2]!, bar.getFilters())).toBe(false);
  });

  it("returns search matches under 10ms for 300 nodes", () => {
    const bar = new CanvasSearchAndFilterBar();
    const nodes = Array.from({ length: 300 }, (_, i) =>
      node({ id: `S${i}`, kind: "requirement", title: i === 218 ? "Cutoff 10:45 rule" : `Req ${i}` }),
    );
    bar.rebuildIndex(nodes);
    const start = performance.now();
    const hits = bar.searchMatches("10:45");
    const elapsed = performance.now() - start;
    expect(hits).toContain("S218");
    expect(elapsed).toBeLessThan(50);
  });
});

describe("focusNeighborhood", () => {
  it("keeps only impact_walk neighbors for selected edge types", () => {
    const edges = [
      edge("A", "B", "depends_on"),
      edge("B", "C", "implements"),
      edge("B", "D", "comments_on"),
      edge("C", "E", "contradicts"),
    ];
    const keep = focusNeighborhood("B", edges, ["depends_on", "implements", "contradicts"]);
    expect([...keep].sort()).toEqual(["A", "B", "C"].sort());
  });
});

describe("conflictBubblesForLevel", () => {
  it("bubbles distant conflicts to parent feature clusters at L1/L2", () => {
    const nodes = [
      node({ id: "F-ORD", kind: "feature", title: "Orders", feature: "F-ORD" }),
      node({ id: "D-1", kind: "decision", title: "Left", feature: "F-ORD", hasConflict: true }),
      node({ id: "D-2", kind: "decision", title: "Right", feature: "F-ORD", hasConflict: true }),
    ];
    const edges = [edge("D-1", "D-2", "contradicts")];
    const bubbles = conflictBubblesForLevel(nodes, edges, 1);
    expect(bubbles.get("F-ORD")).toBe(true);
  });
});