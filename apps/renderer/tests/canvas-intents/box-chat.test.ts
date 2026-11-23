import { describe, expect, it } from "vitest";

import { runAxeCoreKeyboardFocusTrapAudit } from "../../src/canvas/intents/a11y.js";
import {
  createBoxChatIntentController,
  type BoxChatIntentController,
} from "../../src/canvas/intents/controller.js";
import { IntentGraph } from "../../src/canvas/intents/graph.js";
import { ZeroTokenImpactPreviewModal } from "../../src/canvas/intents/modal.js";
import { RevisionDriftConflictPrompt } from "../../src/canvas/intents/drift.js";
import { CANONICAL_IMPACT_WALK_SQL } from "../../src/canvas/intents/sql.js";
import {
  ASK_OWNER_RESPONDER_ID,
  IMPACT_TIME_BUDGET_MS,
  type ModelPort,
  type NetworkPort,
} from "../../src/canvas/intents/types.js";

class SpyModel implements ModelPort {
  calls = 0;

  complete(): string {
    this.calls += 1;
    throw new Error("model should not be called");
  }
}

class SpyNetwork implements NetworkPort {
  calls = 0;

  request(): void {
    this.calls += 1;
    throw new Error("network should not be called");
  }
}

function harness(): {
  graph: IntentGraph;
  controller: BoxChatIntentController;
  model: SpyModel;
  network: SpyNetwork;
} {
  const graph = new IntentGraph();
  const model = new SpyModel();
  const network = new SpyNetwork();
  const controller = createBoxChatIntentController({ graph, model, network });
  return { graph, controller, model, network };
}

function record(value: object): Record<string, unknown> {
  return value as Record<string, unknown>;
}

function kind(value: object): string {
  const name = record(value).kind;
  if (typeof name !== "string") throw new Error("result is missing kind");
  return name;
}

describe("canvas box-chat intents", () => {
  it("answers Ask from the selected box with no mutations, holds, or model calls", () => {
    const { graph, controller, model, network } = harness();
    graph.seedNode({
      id: "R17",
      kind: "decision",
      title: "Cutoff Rule R17",
      text: "Orders stop at cutoff because the kitchen closes",
      value: "11:00 AM",
      provenanceQuote: "you said cutoff at 11",
      codeStatus: "not built",
    });
    graph.seedTask({ id: "T-05", state: "WORKING", title: "Order form" });
    graph.seedEdge({ src: "T-05", type: "depends_on", dst: "R17" });
    const before = graph.mutationCount;
    const answered = controller.submit({ intent: "ask", nodeIds: ["R17"], draft: "Why 11?" });
    expect(kind(answered)).toBe("answer");
    const body = record(answered);
    expect(body.routedTo).toEqual(["task-102"]);
    expect(body.responderId).toBe(ASK_OWNER_RESPONDER_ID);
    expect(body.text).toContain("Provenance: you said cutoff at 11");
    expect(body.text).toContain("Why: Orders stop at cutoff");
    expect(body.text).toContain("Code status: not built");
    expect(body.text).toContain("Dependent tasks: Order form");
    expect(body.mutationDelta).toBe(0);
    expect(graph.mutationCount).toBe(before);
    expect(graph.holdCount()).toBe(0);
    expect(body.llmCalls).toBe(0);
    expect(model.calls).toBe(0);
    expect(network.calls).toBe(0);
    graph.close();
  });

  it("runs Explain Impact through SQL impact_walk offline in under 15ms and lights seven boxes", () => {
    const { graph, controller, model, network } = harness();
    graph.seedNode({ id: "entity:Order", kind: "entity", title: "Order" });
    for (let index = 1; index <= 7; index += 1) {
      const id = `down-${index}`;
      graph.seedNode({ id, kind: index % 2 === 0 ? "screen" : "contract", title: id });
      graph.seedEdge({ src: id, type: "depends_on", dst: "entity:Order" });
    }
    const before = graph.mutationCount;
    const explained = controller.submit({
      intent: "explain_impact",
      nodeIds: ["entity:Order"],
      offline: true,
      apiBudgetRemaining: 0,
    });
    expect(kind(explained)).toBe("explain_impact");
    const body = record(explained);
    const highlighted = body.highlightedNodeIds as string[];
    expect(highlighted).toHaveLength(7);
    expect(new Set(highlighted).size).toBe(7);
    expect(body.elapsedMs).toBeLessThan(IMPACT_TIME_BUDGET_MS);
    expect(body.llmCalls).toBe(0);
    expect(body.mutationDelta).toBe(0);
    expect(body.holds).toBe(0);
    expect(body.canonicalQueries).toBe(1);
    expect(body.cycleSafeQueries).toBe(1);
    expect(graph.mutationCount).toBe(before);
    expect(model.calls).toBe(0);
    expect(network.calls).toBe(0);
    expect(CANONICAL_IMPACT_WALK_SQL).toContain("WITH RECURSIVE impact(id, depth)");
    expect(CANONICAL_IMPACT_WALK_SQL).toContain("t.invalidates = 1");
    const canonical = graph.executeCanonical("entity:Order");
    expect(canonical.filter((node) => node.depth > 0)).toHaveLength(7);
    graph.close();
  });

  it("counts a shared downstream task once across two selected boxes", () => {
    const { graph, controller } = harness();
    graph.seedNode({ id: "D-1", kind: "decision", title: "D-1", value: "a" });
    graph.seedNode({ id: "D-2", kind: "decision", title: "D-2", value: "b" });
    graph.seedTask({ id: "T-9", state: "WORKING", title: "Shared task" });
    graph.seedTask({ id: "T-1", state: "READY", title: "Other task" });
    graph.seedEdge({ src: "T-9", type: "depends_on", dst: "D-1" });
    graph.seedEdge({ src: "T-9", type: "depends_on", dst: "D-2" });
    const explained = controller.submit({ intent: "explain_impact", nodeIds: ["D-1", "D-2"] });
    const impact = record(explained).impact as {
      affectedActiveTasks: string[];
      untouchedTasksCount: number;
      nodes: { id: string }[];
    };
    expect(impact.affectedActiveTasks).toEqual(["T-9"]);
    expect(impact.nodes.filter((node) => node.id === "T-9")).toHaveLength(1);
    expect(impact.untouchedTasksCount).toBe(1);
    const preview = controller.submit({ intent: "change", nodeIds: ["D-1", "D-2"], draft: "10:30" });
    expect(kind(preview)).toBe("impact_preview");
    const modal = record(preview).modal as ZeroTokenImpactPreviewModal;
    expect(modal.totals.activeTasksToHold).toEqual(["T-9"]);
    expect(modal.totals.activeTasksToHold.filter((id) => id === "T-9")).toHaveLength(1);
    graph.close();
  });

  it("presets Correct versus Change and keeps every other intent available", () => {
    const { graph, controller } = harness();
    graph.seedNode({
      id: "amber",
      kind: "decision",
      title: "Fresh dictation",
      amberLowConfidence: true,
      dictationBadge: true,
      freshlyDictated: true,
      newlyExtracted: true,
      basis: "derived",
    });
    graph.seedNode({
      id: "settled",
      kind: "decision",
      title: "Settled rule",
      basis: "explicit",
      age: "older",
      lifecycle: "building",
    });
    graph.seedNode({
      id: "F-done",
      kind: "feature",
      title: "Done feature",
      status: "DONE",
      lifecycle: "done",
      landed: true,
      built: true,
      basis: "explicit",
    });
    graph.seedNode({
      id: "proposed",
      kind: "decision",
      title: "Proposed",
      status: "proposed",
      basis: "proposed",
      newlyExtracted: true,
    });
    graph.seedNode({ id: "conflict", kind: "decision", title: "Conflict", status: "conflict" });

    const amber = controller.smartDefault(["amber"]);
    expect(amber.highlighted).toBe("correct");
    expect(amber.lockedOut).toEqual([]);
    expect(amber.available).toEqual(expect.arrayContaining(["ask", "correct", "change", "add", "remove_defer", "explain_impact"]));
    const amberToggle = controller.presetFor(["amber"]);
    expect(amberToggle.mode).toBe("correct");
    expect(amberToggle.locked).toBe(false);
    expect(runAxeCoreKeyboardFocusTrapAudit(amberToggle.surface).violations).toEqual([]);
    amberToggle.press("ArrowRight");
    expect(amberToggle.mode).toBe("change");
    expect(amberToggle.surface.elements().filter((element) => element.role === "radio").every((element) => !element.disabled)).toBe(true);

    expect(controller.presetFor(["settled"]).mode).toBe("change");
    expect(controller.smartDefault(["F-done"]).highlighted).toBe("change");
    expect(controller.presetFor(["F-done"]).mode).toBe("change");
    expect(controller.smartDefault(["proposed"]).highlighted).toBe("approve_edit");
    expect(controller.presetFor(["proposed"]).mode).toBe("correct");
    expect(controller.smartDefault(["conflict"]).highlighted).toBe("resolve_conflict");
    expect(controller.smartDefault(["conflict"]).lockedOut).toEqual([]);
    graph.close();
  });

  it("applies a cosmetic Change immediately, highlights it, and undoes it from version history", () => {
    const { graph, controller } = harness();
    graph.seedNode({
      id: "label",
      kind: "decision",
      title: "Receipt label",
      text: "Reciept total",
      lifecycle: "discovery",
    });
    const applied = controller.submit({ intent: "change", nodeIds: ["label"], draft: "Receipt total" });
    expect(kind(applied)).toBe("applied");
    const body = record(applied);
    expect(body.changeClass).toBe("cosmetic");
    expect(body.holdsPlaced).toEqual([]);
    expect(body.restarts).toEqual([]);
    expect(body.postSendHighlightIds).toEqual(["label"]);
    expect(body.routedTo).toEqual(expect.arrayContaining(["task-087", "task-154"]));
    expect(body.undoToast).toMatchObject({ label: "Undo last box edit", available: true, nodeId: "label" });
    expect(graph.requireBox("label").text).toBe("Receipt total");
    expect(graph.holdCount()).toBe(0);
    expect(controller.highlighter.highlighted).toEqual([["label"]]);
    const undone = controller.undoLast();
    expect(record(undone).routedTo).toEqual(["task-017"]);
    expect(graph.requireBox("label").text).toBe("Reciept total");
    expect(graph.requireBox("label").version).toBe(3);
    graph.close();
  });

  it("corrects a misheard time, reopens the false derivation, and records the pair", () => {
    const { graph, controller } = harness();
    graph.seedNode({
      id: "R-time",
      kind: "decision",
      title: "Cutoff",
      text: "Cutoff at 11:15",
      value: "11:15",
      basis: "derived",
      newlyExtracted: true,
      freshlyDictated: true,
      amberLowConfidence: true,
      lifecycle: "discovery",
    });
    graph.seedNode({
      id: "D-false",
      kind: "decision",
      title: "Derived close",
      text: "Kitchen closes at 11:15",
      value: "11:15",
      basis: "derived",
    });
    graph.seedEdge({ src: "D-false", type: "derived_from", dst: "R-time" });
    const applied = controller.submit({ intent: "correct", nodeIds: ["R-time"], draft: "11:50" });
    expect(kind(applied)).toBe("applied");
    const body = record(applied);
    expect(body.historyLabel).toBe("corrected transcription");
    expect(body.routedTo).toEqual(expect.arrayContaining(["task-071", "task-087", "task-158"]));
    expect(body.cleanedDerivedIds).toEqual(["D-false"]);
    expect(body.holdsPlaced).toEqual([]);
    expect(body.restarts).toEqual([]);
    expect(graph.requireBox("R-time").value).toBe("11:50");
    expect(graph.requireBox("R-time").text).toBe("Cutoff at 11:50");
    expect(graph.requireBox("D-false").status).toBe("reopened");
    expect(graph.corrections().map((pair) => pair.pair)).toContain("11:15 → 11:50");
    graph.close();
  });

  it("attaches a new child to the selected parent", () => {
    const { graph, controller } = harness();
    graph.seedNode({ id: "F12", kind: "feature", title: "Kitchen print", lifecycle: "spec" });
    const applied = controller.submit({
      intent: "add",
      nodeIds: ["F12"],
      draft: "Lock edits at cutoff",
      childKind: "requirement",
    });
    expect(kind(applied)).toBe("applied");
    const childId = record(applied).childId as string;
    const child = graph.requireBox(childId);
    expect(child.fields.parentId).toBe("F12");
    expect(child.fields.attachedBy).toBe("box-chat");
    const edges = graph.currentEdges(childId);
    expect(edges).toEqual(expect.arrayContaining([
      { src: childId, type: "belongs_to", dst: "F12" },
      { src: childId, type: "derived_from", dst: "F12" },
    ]));
    expect(record(applied).routedTo).toEqual(["task-087"]);
    graph.close();
  });

  it("defers an unbuilt node after a dependency check", () => {
    const { graph, controller } = harness();
    graph.seedNode({ id: "R-open", kind: "requirement", title: "Cutoff", lifecycle: "discovery" });
    graph.seedNode({ id: "note", kind: "decision", title: "Note", text: "depends on cutoff" });
    graph.seedEdge({ src: "note", type: "depends_on", dst: "R-open" });
    const removed = controller.submit({ intent: "remove_defer", nodeIds: ["R-open"], disposition: "defer" });
    expect(kind(removed)).toBe("removed");
    const body = record(removed);
    expect(body.routedTo).toEqual(expect.arrayContaining(["task-074", "task-087"]));
    expect(body.status).toBe("deferred");
    expect(body.dependencyIds).toEqual(["note"]);
    expect(graph.requireBox("R-open").status).toBe("deferred");
    expect(graph.holdCount()).toBe(0);
    graph.close();
  });

  it("routes Remove on a landed feature into the 3-step undo inventory", () => {
    const { graph, controller } = harness();
    graph.seedNode({
      id: "F-Print",
      kind: "feature",
      title: "Print",
      status: "DONE",
      lifecycle: "done",
      landed: true,
      built: true,
      fields: {
        sharedHelpers: ["formatReceipt", "shared/print-queue"],
        dormantTables: ["print_jobs"],
        exclusiveFiles: ["src/print/ticket.ts"],
      },
    });
    const before = graph.mutationCount;
    const launched = controller.submit({ intent: "remove_defer", nodeIds: ["F-Print"] });
    expect(kind(launched)).toBe("feature_undo");
    const body = record(launched);
    expect(body.deleted).toBe(false);
    expect(body.routedTo).toEqual(["task-129"]);
    expect(body.llmTokens).toBe(0);
    expect(body.mutationDelta).toBe(0);
    expect(graph.mutationCount).toBe(before);
    expect(graph.requireBox("F-Print").status).toBe("DONE");
    const inventory = body.inventory as {
      steps: { step: number; executed: boolean }[];
      sharedHelpers: string[];
      dormantTables: string[];
      dataChoiceDefault: string;
      plainEnglish: string;
    };
    expect(inventory.steps.map((step) => step.step)).toEqual([1, 2, 3]);
    expect(inventory.steps[2]?.executed).toBe(false);
    expect(inventory.sharedHelpers).toEqual(["formatReceipt", "shared/print-queue"]);
    expect(inventory.dormantTables).toEqual(["print_jobs"]);
    expect(inventory.dataChoiceDefault).toBe("keep_dormant");
    expect(inventory.plainEnglish).toContain("formatReceipt");
    expect(inventory.plainEnglish).toContain("Keep schema/data dormant (Safe default — expand-then-contract)");
    graph.close();
  });

  it("shows a zero-token impact preview and cancels with no writes, holds, or tokens", () => {
    const { graph, controller, model, network } = harness();
    seedBlast(graph);
    controller.beginComposer(["R17"], "", 4);
    const before = graph.mutationCount;
    const opened = controller.submit({ intent: "change", nodeIds: ["R17"], draft: "10:30 AM", cursor: 4 });
    expect(kind(opened)).toBe("impact_preview");
    const modal = record(opened).modal as ZeroTokenImpactPreviewModal;
    expect(modal).toBeInstanceOf(ZeroTokenImpactPreviewModal);
    expect(modal.actions).toEqual(["Apply Change", "Edit Instruction", "Cancel (0 changes made)"]);
    expect(modal.totals.llmCalls).toBe(0);
    expect(modal.totals.networkCalls).toBe(0);
    expect(modal.totals.elapsedMs).toBeLessThan(IMPACT_TIME_BUDGET_MS);
    expect(modal.totals.activeTasksToHold).toEqual(["T-05"]);
    expect(modal.totals.mergedTasksToReverify).toEqual(["T-07", "T-08"]);
    expect(modal.totals.untouchedTasksCount).toBe(9);
    expect(modal.totals.estimatedDeltaCostRange.label).toBe("~$0.35");
    expect(modal.totals.plainEnglish).toContain("pauses 1 active task ('Order form')");
    expect(modal.totals.plainEnglish).toContain("leaves 9 other tasks untouched");
    expect(modal.totals.announcement).toContain("1 active task");
    expect(modal.totals.announcement).toContain("2 merged tasks");
    expect(modal.totals.announcement).toContain("9 tasks untouched");
    const live = modal.surface.elements().find((element) => element.live === "assertive");
    expect(live?.text).toBe(modal.totals.announcement);
    expect(runAxeCoreKeyboardFocusTrapAudit(modal.surface).violations).toEqual([]);
    expect(graph.mutationCount).toBe(before);
    modal.press("Escape");
    expect(kind(controller.lastResult as object)).toBe("cancelled");
    const cancelled = record(controller.lastResult as object);
    expect(cancelled.tokensSpent).toBe(0);
    expect(cancelled.holds).toBe(0);
    expect(cancelled.llmCalls).toBe(0);
    expect(cancelled.cursor).toBe(4);
    expect(cancelled.focused).toBe(true);
    expect(cancelled.draft).toBe("10:30 AM");
    expect(graph.mutationCount).toBe(before);
    expect(graph.holdCount()).toBe(0);
    expect(graph.requireBox("R17").value).toBe("11:00 AM");
    expect(graph.requireBox("R17").version).toBe(1);
    expect(controller.composer).toMatchObject({ focused: true, cursor: 4, draft: "10:30 AM" });
    expect(model.calls).toBe(0);
    expect(network.calls).toBe(0);
    graph.close();
  });

  it("applies a previewed breaking change and edit-instruction leaves the database untouched", () => {
    const { graph, controller } = harness();
    seedBlast(graph);
    const opened = controller.submit({ intent: "change", nodeIds: ["R17"], draft: "10:30 AM" });
    const modal = record(opened).modal as ZeroTokenImpactPreviewModal;
    const before = graph.mutationCount;
    const edited = controller.editInstruction(modal.id);
    expect(kind(edited)).toBe("edit_instruction");
    expect(graph.mutationCount).toBe(before);
    expect(graph.holdCount()).toBe(0);
    expect(graph.requireBox("R17").value).toBe("11:00 AM");

    const again = controller.submit({ intent: "change", nodeIds: ["R17"], draft: "10:30 AM" });
    const second = record(again).modal as ZeroTokenImpactPreviewModal;
    const applied = controller.applyPreview(second.id);
    expect(kind(applied)).toBe("applied");
    expect(record(applied).holdsPlaced).toEqual(["T-05"]);
    expect(record(applied).restarts).toEqual([]);
    expect(graph.requireBox("R17").value).toBe("10:30 AM");
    expect(graph.holdCount()).toBe(1);
    expect(graph.holdsFor("T-05")).toBe(1);
    graph.close();
  });

  it("blocks a silent overwrite when the box revision moves and offers the three-way prompt", () => {
    const { graph, controller } = harness();
    graph.seedNode({
      id: "R17",
      kind: "decision",
      title: "Cutoff Rule R17",
      text: "Cutoff at 11:00 AM",
      value: "11:00 AM",
      version: 3,
    });
    controller.beginComposer(["R17"], "10:30 AM", 7);
    graph.importExternalRevision("R17", { value: "10:45 AM", source: "VS Code" });
    const before = graph.mutationCount;
    const drifted = controller.submit({ intent: "change", nodeIds: ["R17"], draft: "10:30 AM" });
    expect(kind(drifted)).toBe("revision_drift");
    const prompt = record(drifted).prompt as RevisionDriftConflictPrompt;
    expect(prompt).toBeInstanceOf(RevisionDriftConflictPrompt);
    expect(prompt.message).toBe(
      "Cutoff Rule R17 changed while you were writing (was '11:00 AM', now '10:45 AM' from VS Code) — Apply your edit ('10:30 AM') anyway, Keep '10:45 AM', or Edit again?",
    );
    expect(prompt.diff).toEqual({
      baseRevision: 3,
      currentDbRevision: 4,
      baseValue: "11:00 AM",
      currentValue: "10:45 AM",
      draftValue: "10:30 AM",
    });
    expect(record(drifted).applied).toBe(false);
    expect(graph.mutationCount).toBe(before);
    expect(graph.requireBox("R17").version).toBe(4);
    expect(graph.requireBox("R17").value).toBe("10:45 AM");

    const kept = controller.chooseDrift(prompt.id, "keep_current");
    expect(kind(kept)).toBe("kept_current");
    expect(graph.requireBox("R17").value).toBe("10:45 AM");
    expect(graph.requireBox("R17").version).toBe(4);
    graph.close();
  });

  it("applies over a drifted revision only after an explicit choice, or returns to the draft", () => {
    const first = harness();
    first.graph.seedNode({
      id: "R17",
      kind: "decision",
      title: "Cutoff Rule R17",
      text: "Cutoff at 11:00 AM",
      value: "11:00 AM",
      version: 3,
      lifecycle: "discovery",
    });
    first.controller.beginComposer(["R17"], "10:30 AM", 0);
    first.graph.importExternalRevision("R17", { value: "10:45 AM", source: "VS Code" });
    const drifted = first.controller.submit({ intent: "correct", nodeIds: ["R17"], draft: "10:30 AM" });
    const prompt = record(drifted).prompt as RevisionDriftConflictPrompt;
    const applied = first.controller.chooseDrift(prompt.id, "apply_anyway");
    expect(kind(applied)).toBe("applied");
    expect(first.graph.requireBox("R17").value).toBe("10:30 AM");
    expect(first.graph.requireBox("R17").version).toBe(5);
    first.graph.close();

    const second = harness();
    second.graph.seedNode({
      id: "R17",
      kind: "decision",
      title: "Cutoff Rule R17",
      text: "Cutoff at 11:00 AM",
      value: "11:00 AM",
      version: 3,
    });
    second.controller.beginComposer(["R17"], "10:30 AM", 2);
    second.graph.importExternalRevision("R17", { value: "10:45 AM", source: "VS Code" });
    const again = second.controller.submit({ intent: "change", nodeIds: ["R17"], draft: "10:30 AM" });
    const other = record(again).prompt as RevisionDriftConflictPrompt;
    const editing = second.controller.chooseDrift(other.id, "edit_again");
    expect(kind(editing)).toBe("edit_again");
    expect(record(editing).draft).toBe("10:30 AM");
    expect(record(editing).focused).toBe(true);
    expect(second.graph.requireBox("R17").value).toBe("10:45 AM");
    expect(second.graph.requireBox("R17").version).toBe(4);
    expect(second.graph.mutationCount).toBe(1);
    second.graph.close();
  });
});

function seedBlast(graph: IntentGraph): void {
  graph.seedNode({
    id: "R17",
    kind: "decision",
    title: "Cutoff Rule R17",
    text: "Cutoff at 11:00 AM",
    value: "11:00 AM",
    lifecycle: "building",
    basis: "explicit",
    age: "older",
  });
  graph.seedNode({ id: "C-1", kind: "contract", title: "kitchen-totals" });
  graph.seedEdge({ src: "C-1", type: "depends_on", dst: "R17" });
  graph.seedTask({ id: "T-05", state: "WORKING", title: "Order form" });
  graph.seedTask({ id: "T-07", state: "DONE", title: "Boundary tests" });
  graph.seedTask({ id: "T-08", state: "ACCEPTED", title: "Receipt copy" });
  graph.seedEdge({ src: "T-05", type: "depends_on", dst: "R17" });
  graph.seedEdge({ src: "T-07", type: "verifies", dst: "R17" });
  graph.seedEdge({ src: "T-08", type: "verifies", dst: "R17" });
  for (let index = 1; index <= 9; index += 1) {
    graph.seedTask({ id: `T-free-${index}`, state: "READY", title: `Free ${index}` });
  }
}
