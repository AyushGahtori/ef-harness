import { describe, expect, it } from "vitest";
import { runAxeCoreAudit } from "../../src/canvas/popovers/a11y.js";
import { placementInside, placePopover } from "../../src/canvas/popovers/geometry.js";
import { canvasEdges, canvasNodes, projectNode } from "../../src/canvas/popovers/fixtures.js";
import { createCanvasPopoverHost, renderedText } from "../../src/canvas/popovers/host.js";
import {
  ARCHIVED_POPOVER,
  CHOSEN_FOR_YOU,
  HIGHLIGHT_MS,
  PAN_ZOOM,
  POPOVER_HEIGHT,
  POPOVER_WIDTH,
} from "../../src/canvas/popovers/types.js";
import type { VNode } from "../../src/canvas/popovers/types.js";
import { SEALED_ORACLE_SOURCE } from "../../src/canvas/popovers/fixtures.js";

function surface() {
  return createCanvasPopoverHost({ nodes: canvasNodes(), edges: canvasEdges() });
}

function pulseFlags(node: VNode): string[] {
  const flags: string[] = [];
  if (node.props.attrs?.["data-pulse"] === "true" || node.props.attrs?.["data-motion"] === "pulse") {
    flags.push(node.props.id ?? node.type);
  }
  for (const child of node.children) {
    if (typeof child !== "string") flags.push(...pulseFlags(child));
  }
  return flags;
}

describe("post-send highlights, clamping, and archival", () => {
  it("distinguishes new, updated, re-checking, and removed nodes for 8 seconds", () => {
    const host = surface();
    host.commitDelta({
      added: ["asset-mark"],
      updated: ["D-17", "R-22", "F-Orders", "entity-order"],
      impacted: ["task-a0014"],
      removed: ["seam-print"],
    });
    expect(host.recap()).toBe("4 boxes updated · 1 added · 1 held — View changes");
    const added = host.highlighter.active().find((item) => item.kind === "new");
    expect(added).toMatchObject({ badge: "+ New", tone: "green", pulse: true, nodeId: "asset-mark" });
    const updated = host.highlighter.active().filter((item) => item.kind === "updated");
    expect(updated).toHaveLength(4);
    expect(updated.every((item) => item.badge === "Updated" && item.tone === "violet" && item.pulse)).toBe(true);
    expect(host.highlighter.active().find((item) => item.kind === "rechecking")).toMatchObject({
      badge: "Re-checking",
      tone: "amber",
      outline: true,
      pulse: false,
      nodeId: "task-a0014",
    });
    const removed = host.highlighter.active().find((item) => item.nodeId === "seam-print");
    expect(removed).toMatchObject({ badge: "Removed / Deferred", strike: true, pulse: false, opacity: 1 });
    host.advance(16);
    const fading = host.highlighter.active().find((item) => item.nodeId === "seam-print");
    expect(fading).toBeDefined();
    expect(fading?.opacity).toBeGreaterThan(0.9);
    expect(fading?.opacity).toBeLessThan(1);
    host.advance(HIGHLIGHT_MS - 16);
    expect(host.highlighter.active()).toEqual([]);
    expect(host.recap()).toBeNull();
    host.activateRecap();
  });

  it("jumps to an off-screen updated node and respects reduced motion", () => {
    const host = surface();
    host.setOffscreen(["R-22"]);
    host.commitDelta({
      added: [],
      updated: ["D-17", "R-22"],
      impacted: [],
      removed: [],
    });
    expect(host.recap()).toBe("2 updated (1 off-screen) — Jump to R-22");
    const inline = host.highlighter.active().find((item) => item.nodeId === "D-17");
    const away = host.highlighter.active().find((item) => item.nodeId === "R-22");
    expect(inline).toMatchObject({ kind: "updated", offscreen: false });
    expect(away).toMatchObject({ kind: "updated", offscreen: true });
    host.activateRecap();
    expect(host.canvas.lastPan()).toEqual({
      nodeId: "R-22",
      x: canvasNodes().find((node) => node.id === "R-22")!.rect.x + 70,
      y: canvasNodes().find((node) => node.id === "R-22")!.rect.y + 28,
      zoom: PAN_ZOOM,
    });

    const calm = surface();
    calm.setReducedMotion(true);
    calm.commitDelta({
      added: ["asset-mark"],
      updated: ["D-17"],
      impacted: ["task-a0014"],
      removed: ["seam-print"],
    });
    expect(calm.highlighter.active().every((item) => item.pulse === false)).toBe(true);
    expect(calm.highlighter.active().every((item) => item.staticContrast)).toBe(true);
    const view = calm.render();
    const text = renderedText(view);
    expect(text).toContain("+ New");
    expect(text).toContain("Updated");
    expect(text).toContain("Re-checking");
    expect(text).toContain("Removed / Deferred");
    expect(pulseFlags(view)).toEqual([]);
    expect(runAxeCoreAudit(view).seriousOrCritical).toEqual([]);
  });

  it("flips a corner popover fully inside the viewport", () => {
    const node = {
      ...projectNode(),
      rect: { x: 960, y: 760, width: 20, height: 20 },
    };
    const viewport = { x: 0, y: 0, width: 1000, height: 800 };
    const host = createCanvasPopoverHost({ nodes: [node], viewport });
    host.click(node.id);
    const placement = host.placement();
    expect(placement?.flippedX).toBe(true);
    expect(placement?.flippedY).toBe(true);
    expect(host.placementInsideViewport()).toBe(true);
    expect(placement && placementInside(placement, viewport)).toBe(true);
    const direct = placePopover(node.rect, { width: POPOVER_WIDTH, height: POPOVER_HEIGHT }, viewport);
    expect(direct.x).toBeGreaterThanOrEqual(0);
    expect(direct.y).toBeGreaterThanOrEqual(0);
    expect(direct.x + direct.width).toBeLessThanOrEqual(viewport.width);
    expect(direct.y + direct.height).toBeLessThanOrEqual(viewport.height);
  });

  it("survives remote archival and jumps through provenance links", () => {
    const host = surface();
    host.click("D-17");
    expect(() => host.archive("D-17")).not.toThrow();
    expect(() => host.render()).not.toThrow();
    expect(host.popoverText()).toContain(ARCHIVED_POPOVER);
    expect(host.popoverText()).toContain("Close");
    expect(host.popoverText()).not.toContain(SEALED_ORACLE_SOURCE);
    host.activatePopoverAction("close");
    expect(host.popoverOpen()).toBe(false);
    host.click("F-Orders");
    expect(host.popoverText()).toContain("WORKING");

    host.click("D-derived");
    host.activateLink("R-22");
    expect(host.canvas.lastPan()?.nodeId).toBe("R-22");
    expect(host.canvas.lastPan()?.zoom).toBe(PAN_ZOOM);
    expect(host.popoverText()).toContain("When the cutoff passes the system shall reject edits.");

    host.click("contract-totals");
    host.activateLink("F-Orders");
    expect(host.canvas.lastPan()?.nodeId).toBe("F-Orders");

    host.click("conflict-cutoff");
    host.activateLink("D-17");
    expect(host.popoverText()).toContain(ARCHIVED_POPOVER);
    expect(() => host.render()).not.toThrow();

    host.click("D-delegated");
    expect(host.popoverText()).toContain(CHOSEN_FOR_YOU);
    expect(host.popoverText()).toContain("Override choice");
    host.activatePopoverAction("override");
    expect(host.siblings.calls.at(-1)).toMatchObject({ sibling: "Task 156", method: "overrideChoice" });
  });
});
