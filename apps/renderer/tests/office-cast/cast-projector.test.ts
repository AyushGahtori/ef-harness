import { describe, expect, it } from "vitest";
import {
  OfficeCastProjector,
  ROOM_IDS,
  overheadIconFor,
  placeAgentLabels,
} from "../../src/office/cast/index.js";
import { makeSnapshot, makeWorker } from "./fixtures.js";

const ROLE_SEQUENCE = [
  "discovery",
  "spec",
  "researcher",
  "architect",
  "planner",
  "coder",
  "verifier",
  "integrator",
  "ship",
  "ci",
  "coder",
] as const;

describe("OfficeCastProjector", () => {
  const projector = new OfficeCastProjector();

  it("renders zero sprites when the build is idle", () => {
    const scene = projector.project(makeSnapshot([]));
    expect(scene.seats).toHaveLength(0);
    expect(scene.phantomSpriteCount).toBe(0);
    expect(scene.idle).toBe(true);
  });

  it("projects 20 workers across the floor plan with no phantom sprites", () => {
    const workers = Array.from({ length: 20 }, (_, index) =>
      makeWorker({
        agentId: `A${1000 + index}`,
        taskId: `T-${index}`,
        role: ROLE_SEQUENCE[index % ROLE_SEQUENCE.length],
        status: index % 5 === 0 ? "waiting-run-slot" : "thinking",
      }),
    );
    const scene = projector.project(makeSnapshot(workers, { pool2SlotCapacity: 3 }));
    expect(scene.seats).toHaveLength(20);
    expect(scene.phantomSpriteCount).toBe(0);
    const rooms = new Set(scene.seats.map((seat) => seat.roomId));
    expect(rooms.size).toBeGreaterThanOrEqual(8);
    for (const seat of scene.seats) {
      expect(ROOM_IDS.includes(seat.roomId)).toBe(true);
      expect(seat.source).toBe("state.db");
    }
    expect(scene.rigs).toHaveLength(3);
  });

  it("switches loop overhead instantly from health kinds", () => {
    const worker = makeWorker({
      status: "running",
      health: { kind: "loop_detected", label: "3x loop" },
    });
    expect(overheadIconFor(worker)).toBe("spinning-loop");
  });

  it("labels engineering bullpen pods with feature progress", () => {
    const workers = [
      makeWorker({ agentId: "A1", taskId: "T1", featureId: "F-Orders", featureTitle: "Orders" }),
      makeWorker({ agentId: "A2", taskId: "T2", featureId: "F-Orders", featureTitle: "Orders", status: "done" }),
      makeWorker({ agentId: "A3", taskId: "T3", featureId: "F-Orders", featureTitle: "Orders" }),
    ];
    const scene = projector.project(
      makeSnapshot(workers, {
        features: [{ featureId: "F-Orders", title: "Orders", done: 1, total: 3 }],
      }),
    );
    expect(scene.pods[0]?.text).toBe("Orders · 1/3");
  });

  it("keeps hovered tags legible when labels collide", () => {
    const workers = Array.from({ length: 18 }, (_, index) =>
      makeWorker({
        agentId: `A${2000 + index}`,
        taskId: `T-collide-${index}`,
        role: "coder",
      }),
    );
    const scene = projector.project(makeSnapshot(workers), { zoom: 1 });
    const labels = placeAgentLabels(scene.seats, { zoom: 1, hoveredAgentId: workers[0]?.agentId });
    const hovered = labels.find((label) => label.agentId === workers[0]?.agentId);
    expect(hovered?.visible).toBe(true);
    expect(hovered?.protected).toBe(true);
  });
});