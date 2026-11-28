import { describe, expect, it } from "vitest";
import {
  CANONICAL_TASK_STATES,
  boardTaskFromStateDb,
  mapTaskToBoardLane,
  type BoardLaneId,
  type StateDbBoardRow,
} from "../../src/cockpit/board/index.js";
import { createView, makeTask } from "./fixtures.js";

const BASE_LANE: Readonly<Record<(typeof CANONICAL_TASK_STATES)[number], BoardLaneId>> = {
  DRAFTED: "queued",
  READY: "queued",
  LEASED: "working",
  CODING: "working",
  STATIC_AUDIT: "verifying",
  CLEAN_VERIFY: "verifying",
  ACCEPTED: "done",
  MERGED_TO_FEATURE: "done",
  WAITING_INPUT: "waiting_on_you",
  PARKED: "queued",
  ESCALATED: "working",
  EXHAUSTED: "waiting_on_you",
  HUMAN_OWNED: "waiting_on_you",
  SUPERSEDED: "done",
  CANCELLED: "done",
};

describe("mapTaskToBoardLane", () => {
  it("maps every canonical state.db task state to exactly one of the 7 lanes", () => {
    expect(CANONICAL_TASK_STATES).toHaveLength(15);
    const tasks = CANONICAL_TASK_STATES.map((state, index) =>
      makeTask({ taskId: state, state, title: `state ${index}` }),
    );
    const { view } = createView(tasks);
    const snapshot = view.snapshot();
    const seen = new Map<string, BoardLaneId>();
    for (const lane of snapshot.lanes) {
      expect(lane.taskIds).toHaveLength(lane.count);
      for (const taskId of lane.taskIds) {
        expect(seen.has(taskId)).toBe(false);
        seen.set(taskId, lane.id);
      }
    }
    expect(seen.size).toBe(tasks.length);
    for (const task of tasks) {
      expect(seen.get(task.taskId)).toBe(BASE_LANE[task.state as keyof typeof BASE_LANE]);
      expect(mapTaskToBoardLane(task)).toBe(seen.get(task.taskId));
    }
    const rendered = snapshot.lanes.flatMap((lane) => lane.rows.filter((row) => row.kind === "card"));
    const renderedIds = rendered.map((row) => (row.kind === "card" ? row.card.taskId : ""));
    expect(new Set(renderedIds).size).toBe(renderedIds.length);
  });

  it("lets holds, inbox, merge, and terminal closure win in that order", () => {
    const held = makeTask({ taskId: "held", state: "CODING", holds: [{ reason: "user_paused", source: "user", summary: "paused" }] });
    const inbox = makeTask({ taskId: "inbox", state: "READY", openInboxItemId: "card-9" });
    const merging = makeTask({
      taskId: "merge",
      state: "ACCEPTED",
      mergeBehindCount: 1,
      mergeBehindLabel: "F-Menu",
    });
    const wiring = makeTask({ taskId: "wire", state: "CODING", activity: "feature_wiring" });
    const reviewer = makeTask({ taskId: "review", state: "CODING", reviewer: "reviewer@1" });
    const parked = makeTask({ taskId: "parked", state: "PARKED", holderAttempt: "attempt-1" });
    const closed = makeTask({
      taskId: "closed",
      state: "MERGED_TO_FEATURE",
      holds: [{ reason: "user_paused", source: "user", summary: "paused" }],
    });
    expect(mapTaskToBoardLane(held)).toBe("held");
    expect(mapTaskToBoardLane(inbox)).toBe("waiting_on_you");
    expect(mapTaskToBoardLane(merging)).toBe("integrating");
    expect(mapTaskToBoardLane(wiring)).toBe("integrating");
    expect(mapTaskToBoardLane(reviewer)).toBe("verifying");
    expect(mapTaskToBoardLane(parked)).toBe("working");
    expect(mapTaskToBoardLane(closed)).toBe("done");
    const { view } = createView([held, inbox, merging, wiring, reviewer, parked, closed]);
    const lanes = new Map(view.snapshot().lanes.map((lane) => [lane.id, lane.taskIds]));
    for (const task of [held, inbox, merging, wiring, reviewer, parked, closed]) {
      const owners = [...lanes.entries()].filter(([, ids]) => ids.includes(task.taskId));
      expect(owners).toHaveLength(1);
    }
  });

  it("reads canonical task_runtime columns without inventing progress", () => {
    const row: StateDbBoardRow = {
      task: "T07",
      feature: "F-Print",
      state: "CODING",
      level: "senior",
      holder_attempt: "attempt-7",
      submission_pending: 0,
      title: "print page",
      agent_id: "A0014",
      connection_id: "chatgpt-plan",
      connection_label: "ChatGPT plan",
      provider_id: "openai",
      holds: [],
      open_inbox_item: null,
      inbox_need: null,
      inbox_blocked_tasks: [],
      blocked_by: [],
      merge_behind_count: null,
      merge_behind_label: null,
      activity: "none",
      reviewer: null,
      pool_phase: "thinking",
      run_slot: null,
      run_slot_capacity: 2,
      queue_position: null,
      queue_blocker: null,
      running_command: null,
      elapsed_seconds: null,
      verify_flow: null,
      retry: null,
      retry_max: null,
      hint: null,
      status_event: null,
      requirement_count: 4,
      updated_at_ms: 1_700_000_000_000,
      accepted_label: null,
      spend_label: null,
    };
    const task = boardTaskFromStateDb(row);
    expect(task.taskId).toBe("T07");
    expect(task.holderAttempt).toBe("attempt-7");
    expect(task.submissionPending).toBe(false);
    expect(mapTaskToBoardLane(task)).toBe("working");
    expect(JSON.stringify(task).includes("percent")).toBe(false);
  });
});
