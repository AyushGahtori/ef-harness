import { describe, expect, it } from "vitest";
import {
  BOARD_RENDER_BUDGET_MS,
  FRAME_BATCH_WINDOW_MS,
  VirtualizedLaneColumn,
} from "../../src/cockpit/board/index.js";
import { buildDenseBoard, createView, makeTask } from "./fixtures.js";

describe("virtualized board benchmark", () => {
  it("windows 500 rows to the viewport", () => {
    const column = new VirtualizedLaneColumn();
    const items = Array.from({ length: 500 }, (_, index) => index);
    const windowed = column.window(items, () => 160, 0, 960, 0);
    expect(windowed.items).toHaveLength(6);
    expect(windowed.totalHeightPx).toBe(500 * 160);
    const tail = column.window(items, () => 160, 500 * 160 - 960, 960, 0);
    expect(tail.items.length).toBeLessThanOrEqual(6);
    expect(tail.items.at(-1)?.item).toBe(499);
  });

  it("mounts and patches 500 tasks, 20 workers, and 5000 requirements in under 10 ms", () => {
    const tasks = buildDenseBoard();
    expect(tasks).toHaveLength(500);
    expect(tasks.reduce((sum, task) => sum + task.requirementCount, 0)).toBe(5000);
    // Compile the view once so the timed mount measures the 500-task render.
    createView(tasks.slice(0, 1), { viewportHeightPx: 960, overscanPx: 0 }).view.renderHtml();
    const wall = performance.now();
    const { view } = createView(tasks, { viewportHeightPx: 960, overscanPx: 0 });
    const html = view.renderHtml();
    const mountMs = performance.now() - wall;
    const snapshot = view.snapshot();
    expect(mountMs).toBeLessThan(BOARD_RENDER_BUDGET_MS);
    expect(snapshot.taskCount).toBe(500);
    expect(snapshot.requirementTotal).toBe(5000);
    expect(snapshot.visibleCardCount).toBeLessThanOrEqual(25);
    expect(snapshot.visibleCardCount).toBeGreaterThan(0);
    expect(snapshot.lanes.find((lane) => lane.id === "done")?.count).toBe(400);
    expect(snapshot.lanes.find((lane) => lane.id === "done")?.rows.some((row) => row.kind === "card")).toBe(
      false,
    );
    expect(snapshot.lanes.find((lane) => lane.id === "queued")?.count).toBe(70);
    expect(snapshot.lanes.find((lane) => lane.id === "working")?.count).toBe(20);
    expect(snapshot.lanes.find((lane) => lane.id === "verifying")?.count).toBe(10);
    expect(html.includes("data-requirement-node")).toBe(false);
    expect(html.includes("<progress")).toBe(false);
    expect(html.includes("progressbar")).toBe(false);
    const seen = new Set<string>();
    for (const lane of snapshot.lanes) {
      for (const taskId of lane.taskIds) {
        expect(seen.has(taskId)).toBe(false);
        seen.add(taskId);
      }
    }
    expect(seen.size).toBe(500);
    const filterStarted = performance.now();
    view.setSearch("print");
    const filtered = view.snapshot();
    expect(performance.now() - filterStarted).toBeLessThan(2);
    expect(filtered.lanes.some((lane) => lane.taskIds.some((taskId) => tasks.find((task) => task.taskId === taskId)?.agentId === "A0014"))).toBe(true);
    view.setSearch("");

    const working = tasks.filter((task) => task.state === "CODING");
    expect(working).toHaveLength(20);
    const patches = working.map((task, index) => ({
      taskId: task.taskId,
      atMs: index * 20,
      next: {
        ...task,
        poolPhase: "waiting_for_run_slot" as const,
        queuePosition: index + 1,
        queueBlocker: "verifier running",
        statusEvent: {
          kind: "waiting_for_run_slot" as const,
          queuePosition: index + 1,
          blocker: "verifier running",
        },
      },
    }));
    const patchStarted = performance.now();
    view.enqueuePatches(patches);
    view.flushFrame();
    const patchedHtml = view.renderHtml();
    const patchMs = performance.now() - patchStarted;
    expect(patchMs).toBeLessThan(BOARD_RENDER_BUDGET_MS);
    expect(patchedHtml.includes("Waiting for run slot")).toBe(true);
    expect(view.snapshot().visibleCardCount).toBeLessThanOrEqual(25);
  });

  it("collapses a rapid lane change inside one 800 ms frame without duplicate cards", () => {
    const original = makeTask({ taskId: "moving", state: "CODING", holderAttempt: "attempt-1" });
    const { view } = createView([original]);
    expect(view.laneOf("moving")).toBe("working");
    view.enqueuePatches([
      { taskId: "moving", atMs: 0, next: makeTask({ taskId: "moving", state: "CLEAN_VERIFY" }) },
      {
        taskId: "moving",
        atMs: 250,
        next: makeTask({
          taskId: "moving",
          state: "ACCEPTED",
          activity: "project_merge",
          mergeBehindCount: 1,
          mergeBehindLabel: "F-Menu",
        }),
      },
      { taskId: "moving", atMs: FRAME_BATCH_WINDOW_MS, next: makeTask({ taskId: "moving", state: "MERGED_TO_FEATURE" }) },
    ]);
    expect(view.laneOf("moving")).toBe("working");
    expect(view.occurrenceCount("moving")).toBe(1);
    view.flushFrame();
    expect(view.laneOf("moving")).toBe("done");
    expect(view.occurrenceCount("moving")).toBe(1);
    const owners = view.snapshot().lanes.filter((lane) => lane.taskIds.includes("moving"));
    expect(owners.map((lane) => lane.id)).toEqual(["done"]);
  });
});
