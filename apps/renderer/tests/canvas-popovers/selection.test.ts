import { describe, expect, it } from "vitest";
import { createCanvasPopoverHost } from "../../src/canvas/popovers/host.js";
import {
  canvasEdges,
  canvasNodes,
  explicitDecision,
  featureNode,
  ruleNode,
  screenNode,
} from "../../src/canvas/popovers/fixtures.js";
import type { CanvasNode, Rect } from "../../src/canvas/popovers/types.js";

function surface() {
  return createCanvasPopoverHost({ nodes: canvasNodes(), edges: canvasEdges() });
}

function cell(index: number): Rect {
  return { x: (index % 4) * 90, y: Math.floor(index / 4) * 70, width: 80, height: 40 };
}

describe("multi-box selection", () => {
  it("shift-click and ctrl-click add boxes into one pill and one toolbar", () => {
    const host = surface();
    host.click("F-Orders");
    expect(host.dialogCount()).toBe(1);
    host.click("D-17", { shift: true });
    host.click("F-Catering", { ctrl: true });
    expect(host.dialogCount()).toBe(0);
    expect(host.popoverOpen()).toBe(false);
    expect(host.pill()).toBe("3 boxes selected: Orders, Cutoff Rule R17, Catering Email · Clear");
    expect(host.toolbarLabels()).toEqual([
      "Ask about selection",
      "Change",
      "Correct (misheard)",
      "Add child",
      "Remove / Defer",
      "Explain impact",
      "Focus connected",
      "Clear",
    ]);
    expect(host.composer.activeTarget).toBe("box");
    expect(host.composer.visiblePill()).toBe("Talking about: Orders (+2 more) · ✕");
    expect(host.composer.lastReceipt?.nodeIds).toEqual(["F-Orders", "D-17", "F-Catering"]);
    expect(host.composer.lastReceipt?.nodeRevisions).toEqual([4, 3, 5]);
    expect(host.selectionContext.read()).toEqual(["F-Orders", "D-17", "F-Catering"]);
    host.click("D-17", { ctrl: true });
    expect(host.selection.selectedIds).toEqual(["F-Orders", "D-17", "F-Catering"]);
  });

  it("marquee of 12 boxes summarizes types and hides overlapping popovers", () => {
    const nodes: CanvasNode[] = [];
    for (let index = 0; index < 3; index += 1) {
      nodes.push({ ...featureNode(), id: `F-${index}`, label: `Feature ${index}`, rect: cell(index), revision: index + 1 });
    }
    for (let index = 0; index < 6; index += 1) {
      nodes.push({
        ...explicitDecision(),
        id: `D-${index}`,
        label: `Decision ${index}`,
        rect: cell(index + 3),
        revision: index + 1,
      });
    }
    for (let index = 0; index < 3; index += 1) {
      nodes.push({
        ...ruleNode(),
        id: `X-${index}`,
        label: `Rule ${index}`,
        rect: cell(index + 9),
        revision: index + 1,
      });
    }
    const outsider = { ...screenNode(), id: "outside", rect: { x: 900, y: 900, width: 40, height: 40 } };
    nodes.push(outsider);
    const host = createCanvasPopoverHost({ nodes });
    host.click("outside");
    expect(host.popoverOpen()).toBe(true);
    host.marquee({ x: 0, y: 0, width: 400, height: 300 });
    expect(host.popoverOpen()).toBe(false);
    expect(host.dialogCount()).toBe(0);
    expect(host.selection.selectedIds).toHaveLength(12);
    expect(host.selection.selectedIds).not.toContain("outside");
    expect(host.pill()).toBe("12 boxes selected (3 Features, 6 Decisions, 3 Rules)");
    expect(host.toolbarLabels()).toEqual([
      "Ask about selection",
      "Change",
      "Explain combined impact",
      "Clear",
    ]);
    host.activateToolbar("explain");
    const launch = host.intents.launches.at(-1);
    expect(launch?.intent).toBe("explain_impact");
    expect(launch?.tokens).toBe(0);
    expect(launch?.combined).toBe(true);
    expect(launch?.nodeIds).toHaveLength(12);
    expect(launch?.nodeRevisions).toHaveLength(12);
  });

  it("keeps an open question unanswered when a box is clicked", () => {
    const host = surface();
    host.openQuestion({ id: "Q-04", title: "Auth Method", draft: "Magic link", optionsVersion: 2 });
    host.click("D-17");
    expect(host.popoverOpen()).toBe(true);
    expect(host.popoverText()).toContain("11:00");
    expect(host.composer.activeTarget).toBe("question");
    expect(host.composer.submissions).toEqual([]);
    expect(host.composer.questionDraft()).toBe("Magic link");
    expect(host.composer.optionsVersion()).toBe(2);
    expect(host.composer.lastReceipt?.hijackedQuestion).toBe(false);
    expect(host.composer.lastReceipt?.submittedAnswer).toBe(false);
    expect(host.composer.lastReceipt?.nodeIds).toEqual(["D-17"]);
    expect(host.composer.lastReceipt?.nodeRevisions).toEqual([3]);
    expect(host.composer.visiblePill()).toBe("Talking about: Cutoff Rule R17 · Switch composer to this box");
    host.switchComposerToBox();
    expect(host.composer.activeTarget).toBe("box");
    expect(host.composer.submissions).toEqual([]);
    expect(host.composer.questionDraft()).toBe("Magic link");
    host.openQuestion({ id: "Q-04", title: "Auth Method", draft: "Magic link", optionsVersion: 2 });
    host.clearSelection();
    expect(host.composer.visiblePill()).toBe("Replying to: Auth Method [Q-04] · ✕");
    expect(host.composer.submissions).toEqual([]);
  });

  it("returns focus to the anchor on Esc and clears on the second Esc", () => {
    const host = surface();
    host.click("F-Orders");
    expect(host.focus()).toEqual({ owner: "popover", nodeId: "F-Orders" });
    host.escape();
    expect(host.popoverOpen()).toBe(false);
    expect(host.selection.selectedIds).toEqual(["F-Orders"]);
    expect(host.focus()).toEqual({ owner: "node", nodeId: "F-Orders" });
    host.escape();
    expect(host.selection.selectedIds).toEqual([]);
    expect(host.focus()).toEqual({ owner: "node", nodeId: "F-Orders" });
  });

  it("feeds quick actions to the intent controller and sibling inspectors", () => {
    const host = surface();
    host.click("F-Orders");
    host.activateToolbar("focus-connected");
    expect(host.canvas.neighborhood()).toEqual(expect.arrayContaining(["F-Orders", "D-17", "entity-order"]));
    expect(host.intents.launches.at(-1)).toMatchObject({ intent: "focus_connected", tokens: 0 });
    host.activateToolbar("explain");
    expect(host.intents.launches.at(-1)).toMatchObject({ intent: "explain_impact", tokens: 0, combined: false });
    host.activatePopoverAction("undo-feature");
    expect(host.siblings.calls.at(-1)).toMatchObject({ sibling: "Task 129", method: "analyze", nodeId: "F-Orders" });
    host.click("task-a0014");
    host.activatePopoverAction("open-worker");
    expect(host.siblings.calls.at(-1)).toMatchObject({ sibling: "Task 126", method: "show", nodeId: "task-a0014" });
    host.pin();
    expect(host.inspector.current()).toEqual({
      kind: "canvas-node",
      id: "task-a0014",
      title: "T03 · Kitchen print",
      ownerTask: "Task 154",
    });
    expect(host.inspector.expanded()).toContain("A0014 · Kitchen print");
    expect(host.inspector.expanded()).toContain("Open Worker Inspector");
    host.escape();
    expect(host.inspector.current()?.id).toBe("task-a0014");
    expect(host.selection.selectedIds).toEqual(["task-a0014"]);
  });
});
