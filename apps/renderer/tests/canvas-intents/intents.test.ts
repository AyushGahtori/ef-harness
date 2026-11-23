import { describe, expect, it } from "vitest";
import { createBoxChatIntentController } from "../../src/canvas/intents/controller.js";
import { ASK_OWNER_RESPONDER_ID, UNDO_TOAST_LABEL } from "../../src/canvas/intents/types.js";
import { seedImpactGraph, TrackingModel, TrackingNetwork } from "./fixtures.js";

function controller() {
  const graph = seedImpactGraph();
  const model = new TrackingModel();
  const network = new TrackingNetwork();
  const host = createBoxChatIntentController({ graph, model, network });
  return { graph, model, network, host };
}

describe("canvas box-chat intents", () => {
  it("Ask routes read-only to Task 102 with zero graph mutations", () => {
    const { graph, model, network, host } = controller();
    host.beginComposer(["D-17"], "Why does cutoff apply?", 0);
    const before = graph.mutationCount;
    const result = host.submit({ intent: "ask", nodeIds: ["D-17"], draft: "Why does cutoff apply?" }) as {
      kind: string;
      routedTo: string[];
      responderId: string;
      mutationDelta: number;
      holds: number;
      llmCalls: number;
      modelCalls: number;
      networkCalls: number;
    };
    expect(result.kind).toBe("answer");
    expect(result.routedTo).toContain("task-102");
    expect(result.responderId).toBe(ASK_OWNER_RESPONDER_ID);
    expect(result.mutationDelta).toBe(0);
    expect(result.holds).toBe(graph.holdCount());
    expect(graph.mutationCount).toBe(before);
    expect(result.llmCalls).toBe(0);
    expect(model.calls).toBe(0);
    expect(network.calls).toBe(0);
  });

  it("Correct (misheard) fixes time, reopens false derivations, and logs vocabulary", () => {
    const { graph, host } = controller();
    graph.seedNode({
      id: "D-Premise",
      kind: "decision",
      title: "Premise",
      text: "Cutoff at 11:15",
      value: "11:15",
      lifecycle: "discovery",
      freshlyDictated: true,
      amberLowConfidence: true,
      dictationBadge: true,
      basis: "proposed",
    });
    graph.seedEdge({ src: "R-Derived", type: "derived_from", dst: "D-Premise" });
    host.beginComposer(["D-Premise"], "11:50", 0);
    const preset = host.presetFor(["D-Premise"]);
    expect(preset.mode).toBe("correct");
    const result = host.submit({ intent: "correct", nodeIds: ["D-Premise"], draft: "11:50" }) as {
      routedTo: string[];
      corrections: { pair: string }[];
      cleanedDerivedIds: string[];
      kind: string;
    };
    expect(result.kind).toBe("applied");
    expect(result.routedTo).toEqual(expect.arrayContaining(["task-071", "task-158"]));
    expect(result.corrections[0]?.pair).toBe("11:15 → 11:50");
    expect(result.cleanedDerivedIds).toContain("R-Derived");
    expect(graph.corrections()).toEqual([{ heard: "11:15", intended: "11:50", pair: "11:15 → 11:50" }]);
    expect(graph.requireBox("D-Premise").value).toBe("11:50");
  });

  it("Change on settled explicit decision preselects Change and can open impact preview", () => {
    const { host } = controller();
    host.beginComposer(["D-17"], "10:30 AM", 0);
    expect(host.presetFor(["D-17"]).mode).toBe("change");
    const result = host.submit({ intent: "change", nodeIds: ["D-17"], draft: "10:30 AM" }) as {
      kind: string;
      modal?: { totals: { activeTasksToHold: string[] } };
      routedTo: string[];
    };
    expect(result.kind).toBe("impact_preview");
    expect(result.routedTo).toEqual(expect.arrayContaining(["task-087", "task-108"]));
    expect(result.modal?.totals.activeTasksToHold.length).toBeGreaterThanOrEqual(1);
  });

  it("cosmetic Correct on unbuilt spec applies immediately with highlight and undo toast", () => {
    const { host } = controller();
    host.beginComposer(["R-Typo"], "Cutoff rule", 0);
    const result = host.submit({ intent: "correct", nodeIds: ["R-Typo"], draft: "Cutoff rule" }) as {
      kind: string;
      changeClass: string;
      routedTo: string[];
      postSendHighlightIds: string[];
      undoToast: { label: string } | null;
      holdsPlaced: string[];
    };
    expect(result.kind).toBe("applied");
    expect(result.changeClass).toBe("cosmetic");
    expect(result.routedTo).toContain("task-154");
    expect(result.postSendHighlightIds).toEqual(["R-Typo"]);
    expect(result.undoToast?.label).toBe(UNDO_TOAST_LABEL);
    expect(result.holdsPlaced).toEqual([]);
    const undone = host.undoLast() as { kind: string; label: string };
    expect(undone.kind).toBe("undone");
    expect(undone.label).toBe(UNDO_TOAST_LABEL);
  });

  it("Add attaches a child with parent edges prefilled", () => {
    const { graph, host } = controller();
    host.beginComposer(["F-Parent"], "Cutoff validation field", 0);
    const result = host.submit({
      intent: "add",
      nodeIds: ["F-Parent"],
      draft: "Cutoff validation field",
      childKind: "field",
    }) as { childId: string; parentEdges: { type: string; dst: string }[]; routedTo: string[] };
    expect(result.routedTo).toContain("task-087");
    expect(result.parentEdges.some((edge) => edge.type === "belongs_to" && edge.dst === "F-Parent")).toBe(true);
    expect(result.parentEdges.some((edge) => edge.type === "derived_from" && edge.dst === "F-Parent")).toBe(true);
    expect(graph.getBox(result.childId)?.kind).toBe("field");
  });

  it("Remove / Defer on unbuilt nodes defers through Task 074", () => {
    const { graph, host } = controller();
    host.beginComposer(["R-Spec"], "", 0);
    const result = host.submit({ intent: "remove_defer", nodeIds: ["R-Spec"], disposition: "defer" }) as {
      kind: string;
      routedTo: string[];
      status: string;
    };
    expect(result.kind).toBe("removed");
    expect(result.routedTo).toContain("task-074");
    expect(result.status).toBe("deferred");
    expect(graph.requireBox("R-Spec").status).toBe("deferred");
  });

  it("Remove on a DONE landed feature launches Task 129 inventory without deleting", () => {
    const { graph, host } = controller();
    const before = graph.mutationCount;
    const result = host.submit({ intent: "remove_defer", nodeIds: ["F-Print"] }) as {
      kind: string;
      routedTo: string[];
      inventory: { steps: { name: string }[]; deleted: boolean; llmTokens: number };
    };
    expect(result.kind).toBe("feature_undo");
    expect(result.routedTo).toContain("task-129");
    expect(result.inventory.deleted).toBe(false);
    expect(result.inventory.llmTokens).toBe(0);
    expect(result.inventory.steps).toHaveLength(3);
    expect(graph.mutationCount).toBe(before);
    expect(graph.getBox("F-Print")).not.toBeNull();
  });

  it("Explain Impact is zero-token and fast even when offline", () => {
    const { model, network, host } = controller();
    const result = host.submit({
      intent: "explain_impact",
      nodeIds: ["entity:Order"],
      offline: true,
      apiBudgetRemaining: 0,
    }) as {
      kind: string;
      routedTo: string[];
      elapsedMs: number;
      llmCalls: number;
      highlightedNodeIds: string[];
      offline: boolean;
    };
    expect(result.kind).toBe("explain_impact");
    expect(result.routedTo).toContain("task-087");
    expect(result.llmCalls).toBe(0);
    expect(result.elapsedMs).toBeLessThan(15);
    expect(result.highlightedNodeIds.length).toBeGreaterThanOrEqual(3);
    expect(result.offline).toBe(true);
    expect(model.calls).toBe(0);
    expect(network.calls).toBe(0);
  });

  it("smart defaults surface conflict, misheard, approve, and change presets", () => {
    const { graph, host } = controller();
    graph.seedNode({
      id: "D-Conflict",
      kind: "decision",
      title: "Conflict",
      text: "Conflicted",
      value: "v1",
      status: "conflict",
      lifecycle: "plan",
    });
    expect(host.smartDefault(["D-Conflict"]).highlighted).toBe("resolve_conflict");
    expect(host.smartDefault(["D-Dictated"]).highlighted).toBe("correct");
    expect(host.smartDefault(["R-Derived"]).highlighted).toBe("approve_edit");
    expect(host.smartDefault(["F-Print"]).highlighted).toBe("change");
  });
});