import { describe, expect, it } from "vitest";
import {
  OfficeCastProjector,
  OfficeInteractionController,
  createInteractionLog,
  createOfficeInteractionPorts,
} from "../../src/office/cast/index.js";
import { makeSnapshot, makeWorker } from "./fixtures.js";

describe("OfficeInteractionController", () => {
  it("opens WorkerInspectorPanel when a worker is clicked", () => {
    const snapshot = makeSnapshot([makeWorker({ agentId: "A0014", taskId: "T-14" })]);
    const scene = new OfficeCastProjector().project(snapshot);
    const log = createInteractionLog();
    const controller = new OfficeInteractionController(scene, snapshot, createOfficeInteractionPorts(log));
    const effect = controller.click({ kind: "worker", agentId: "A0014", taskId: "T-14" });
    expect(effect.type).toBe("open-worker-inspector");
    expect(log.inspectorOpens[0]?.taskId).toBe("T-14");
    expect(log.inspectorOpens[0]?.agentId).toBe("A0014");
  });

  it("still opens inspector after a worker completes", () => {
    const worker = makeWorker({ agentId: "A0099", taskId: "T-done", status: "done" });
    const snapshot = makeSnapshot([worker]);
    const scene = new OfficeCastProjector().project(snapshot);
    const log = createInteractionLog();
    const controller = new OfficeInteractionController(scene, snapshot, createOfficeInteractionPorts(log));
    controller.click({ kind: "worker", agentId: "A0099", taskId: "T-done" });
    expect(log.inspectorOpens[0]?.completed).toBe(true);
  });

  it("focuses calm inbox from the CEO tray", () => {
    const snapshot = makeSnapshot([], {
      inboxCards: [
        { cardId: "c1", kind: "Decision", title: "Ship?", actionable: true, resolved: false, priority: 1 },
      ],
    });
    const scene = new OfficeCastProjector().project(snapshot);
    const log = createInteractionLog();
    const controller = new OfficeInteractionController(scene, snapshot, createOfficeInteractionPorts(log));
    const effect = controller.click({ kind: "inbox-tray" });
    expect(effect.type).toBe("focus-calm-inbox");
    expect(log.inboxFocus[0]?.cardId).toBe("c1");
  });
});