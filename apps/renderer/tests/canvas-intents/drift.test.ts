import { describe, expect, it } from "vitest";
import { driftMessage } from "../../src/canvas/intents/drift.js";
import { createBoxChatIntentController } from "../../src/canvas/intents/controller.js";
import { seedImpactGraph, TrackingModel, TrackingNetwork } from "./fixtures.js";

describe("revision-drift conflict prompt", () => {
  it("blocks silent overwrite when baseRevision !== currentDbRevision", () => {
    const graph = seedImpactGraph();
    const host = createBoxChatIntentController({ graph, model: new TrackingModel(), network: new TrackingNetwork() });
    host.beginComposer(["D-17"], "10:30 AM", 0);
    graph.importExternalRevision("D-17", { value: "10:45 AM", source: "VS Code" });
    const drift = host.submit({ intent: "change", nodeIds: ["D-17"], draft: "10:30 AM" }) as {
      kind: string;
      prompt: { id: string; message: string; diff: { baseRevision: number; currentDbRevision: number } };
      applied: boolean;
    };
    expect(drift.kind).toBe("revision_drift");
    expect(drift.applied).toBe(false);
    expect(drift.prompt.diff.baseRevision).toBe(3);
    expect(drift.prompt.diff.currentDbRevision).toBe(4);
    expect(drift.prompt.message).toBe(
      driftMessage({
        nodeId: "D-17",
        title: "Cutoff Rule R17",
        baseRevision: 3,
        currentDbRevision: 4,
        baseValue: "11:00 AM",
        currentValue: "10:45 AM",
        draftValue: "10:30 AM",
        source: "VS Code",
      }),
    );
    const kept = host.chooseDrift(drift.prompt.id, "keep_current") as { kind: string; applied: boolean };
    expect(kept.kind).toBe("kept_current");
    expect(kept.applied).toBe(false);
    expect(graph.requireBox("D-17").value).toBe("10:45 AM");
  });

  it("allows apply_anyway after an external revision lands", () => {
    const graph = seedImpactGraph();
    const host = createBoxChatIntentController({ graph, model: new TrackingModel(), network: new TrackingNetwork() });
    host.beginComposer(["D-17"], "10:30 AM", 0);
    graph.importExternalRevision("D-17", { value: "10:45 AM", source: "VS Code" });
    const drift = host.submit({ intent: "change", nodeIds: ["D-17"], draft: "10:30 AM" }) as {
      prompt: { id: string };
    };
    const applied = host.chooseDrift(drift.prompt.id, "apply_anyway") as { kind: string };
    expect(applied.kind).toBe("applied");
    expect(graph.requireBox("D-17").value).toBe("10:30 AM");
  });
});