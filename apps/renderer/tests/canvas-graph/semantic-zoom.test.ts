import { describe, expect, it } from "vitest";
import { SemanticZoomController } from "../../src/canvas/graph/semantic-zoom.js";
import { SEMANTIC_ZOOM_THRESHOLDS } from "../../src/canvas/graph/types.js";
import { node } from "./fixtures.js";

describe("SemanticZoomController", () => {
  it("maps viewport zoom to L1..L4 thresholds", () => {
    const zoom = new SemanticZoomController();
    expect(zoom.levelFromViewportZoom(SEMANTIC_ZOOM_THRESHOLDS.level1Max - 0.01)).toBe(1);
    expect(zoom.levelFromViewportZoom(0.5)).toBe(2);
    expect(zoom.levelFromViewportZoom(1.0)).toBe(3);
    expect(zoom.levelFromViewportZoom(1.5)).toBe(4);
  });

  it("forces level 4 when a feature is focused", () => {
    const zoom = new SemanticZoomController();
    zoom.setFocusFeature("F12");
    expect(zoom.getLevel()).toBe(4);
    expect(zoom.levelFromViewportZoom(0.2)).toBe(4);
  });

  it("bubbles aggregate badges at level 1 feature clusters", () => {
    const zoom = new SemanticZoomController();
    const nodes = [
      node({ id: "F1", kind: "feature", title: "Orders", feature: "F1" }),
      node({ id: "T1", kind: "task", title: "t1", feature: "F1", taskBadge: "done" }),
      node({ id: "T2", kind: "task", title: "t2", feature: "F1", taskBadge: "held" }),
      node({ id: "T3", kind: "task", title: "t3", feature: "F1", taskBadge: "done" }),
    ];
    expect(zoom.clusterLabel("F1", nodes)).toBe("Orders · 2/3 done · 1 held");
  });

  it("hides distant task nodes at level 2", () => {
    const zoom = new SemanticZoomController();
    zoom.applyViewportZoom(0.6);
    const task = node({ id: "T9", kind: "task", title: "worker task" });
    const feature = node({ id: "F9", kind: "feature", title: "Feature" });
    expect(zoom.nodeVisibleAtLevel(feature, 2)).toBe(true);
    expect(zoom.nodeVisibleAtLevel(task, 2)).toBe(false);
  });
});