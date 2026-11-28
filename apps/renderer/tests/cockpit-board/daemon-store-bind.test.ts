import { describe, expect, it } from "vitest";
import { BoardCockpitView } from "../../src/cockpit/board/index.js";
import { boardTaskFromStateDb } from "../../src/cockpit/board/state-db-adapter.js";
import { BoardDaemonStore, DaemonStore, createDaemonSnapshot } from "../../src/shell/daemon-store.js";
import { ManualClock } from "../../src/shell/clock.js";
import { createView, makeTask, SAMPLE_CAPACITY } from "./fixtures.js";

describe("daemon store board binding", () => {
  it("projects a state row into the cockpit and mounts health slots", () => {
    const clock = new ManualClock();
    const store = new DaemonStore({ clock, initial: createDaemonSnapshot() });
    const row = {
      task: "T07",
      feature: "F1",
      state: "CODING",
      level: "Mid",
      holder_attempt: null,
      submission_pending: 0 as const,
      title: "Print the page",
      agent_id: "local",
      connection_id: "local",
      connection_label: "Local",
      provider_id: "local",
      holds: [],
      open_inbox_item: null,
      inbox_need: null,
      inbox_blocked_tasks: [],
      blocked_by: [],
      merge_behind_count: null,
      merge_behind_label: null,
      activity: "none" as const,
      reviewer: null,
      pool_phase: "thinking" as const,
      run_slot: null,
      run_slot_capacity: null,
      queue_position: null,
      queue_blocker: null,
      running_command: null,
      elapsed_seconds: null,
      verify_flow: null,
      retry: null,
      retry_max: null,
      hint: null,
      status_event: null,
      requirement_count: 1,
      updated_at_ms: 0,
      accepted_label: null,
      spend_label: null,
    };
    store.ingest({
      seq: 1,
      streamEpoch: "epoch-1",
      topic: "board",
      type: "board.snapshot",
      payload: { revision: 4, tasks: [row], capacity: SAMPLE_CAPACITY },
    });
    clock.flush();
    const port = new BoardDaemonStore(store);
    const bound = BoardCockpitView.bindStore(port, {
      inspector: { open() {} },
      actions: { perform() {} },
      health: {
        signalsFor() {
          return [{ kind: "stuck_clock", label: "No progress 5:00" }];
        },
      },
      theme: "light",
      viewportHeightPx: 960,
      overscanPx: 0,
    });
    expect(bound.snapshot().taskCount).toBe(1);
    expect(bound.snapshot().lanes.find((lane) => lane.id === "working")?.count).toBe(1);
    const slots = bound.healthSlots();
    expect(slots).toHaveLength(1);
    expect(slots[0]?.owner).toBe("task-125");
    expect(slots[0]?.strip.render()).toContain("No progress 5:00");
    expect(slots[0]?.strip.render()).toContain('data-health-slot="true"');
    expect(boardTaskFromStateDb(row).taskId).toBe("T07");
    const { view } = createView([makeTask({ taskId: "local-only" })]);
    expect(view.healthSlots().every((slot) => slot.layoutShift === 0)).toBe(true);
  });
});
