import { describe, expect, it } from "vitest";
import { createBoxChatIntentController } from "../../src/canvas/intents/controller.js";
import { CANCEL_PREVIEW_LABEL } from "../../src/canvas/intents/types.js";
import { seedImpactGraph, TrackingModel, TrackingNetwork } from "./fixtures.js";

describe("zero-token impact preview modal", () => {
  it("deduplicates multi-box impact unions so shared tasks count once", () => {
    const graph = seedImpactGraph();
    const host = createBoxChatIntentController({ graph, model: new TrackingModel(), network: new TrackingNetwork() });
  const impact = host.submit({ intent: "explain_impact", nodeIds: ["D-1", "D-2"] }) as {
      kind: string;
      impact: { affectedActiveTasks: string[] };
    };
    expect(impact.kind).toBe("explain_impact");
    expect(impact.impact.affectedActiveTasks.filter((id) => id === "T-9")).toHaveLength(1);
  });

  it("Cancel guarantees zero DB writes, holds, tokens, and keeps composer focus", () => {
    const graph = seedImpactGraph();
    const host = createBoxChatIntentController({ graph, model: new TrackingModel(), network: new TrackingNetwork() });
    const beforeMutations = graph.mutationCount;
    const beforeHolds = graph.holdCount();
    host.beginComposer(["D-17"], "10:30 AM", 5);
    const preview = host.submit({ intent: "change", nodeIds: ["D-17"], draft: "10:30 AM" }) as {
      modal: { id: string; actions: readonly string[]; surface: { press(key: string): void } };
    };
    expect(preview.modal.actions).toContain(CANCEL_PREVIEW_LABEL);
    preview.modal.surface.press("Escape");
    const cancelled = host.lastResult as {
      kind: string;
      mutations: number;
      holds: number;
      tokensSpent: number;
      focused: boolean;
      cursor: number;
    };
    expect(cancelled.kind).toBe("cancelled");
    expect(cancelled.mutations).toBe(beforeMutations);
    expect(cancelled.holds).toBe(beforeHolds);
    expect(cancelled.tokensSpent).toBe(0);
    expect(cancelled.focused).toBe(true);
    expect(cancelled.cursor).toBe(5);
  });

  it("Apply Change commits through the preview gate", () => {
    const graph = seedImpactGraph();
    const host = createBoxChatIntentController({ graph, model: new TrackingModel(), network: new TrackingNetwork() });
    host.beginComposer(["D-17"], "10:30 AM", 0);
    const preview = host.submit({ intent: "change", nodeIds: ["D-17"], draft: "10:30 AM" }) as {
      modal: { id: string; surface: { press(key: string): void } };
    };
    const before = graph.mutationCount;
    preview.modal.surface.press("Enter");
    const applied = host.lastResult as { kind: string; intent: string };
    expect(applied.kind).toBe("applied");
    expect(applied.intent).toBe("change");
    expect(graph.mutationCount).toBeGreaterThan(before);
  });
});