import { describe, expect, it } from "vitest";
import {
  BOARD_CARD_HEIGHT_PX,
  BOARD_FILTER_BUDGET_MS,
  FeatureSwimlaneGrouper,
  formatPoolCapacityHeader,
} from "../../src/cockpit/board/index.js";
import { SAMPLE_CAPACITY, createView, makeTask } from "./fixtures.js";

describe("feature grouping, filters, and pool header", () => {
  it("formats the three-pool header exactly", () => {
    expect(formatPoolCapacityHeader(SAMPLE_CAPACITY)).toBe(
      "Thinking: 8/12 · Run slots: 2/2 (1 Verifier, 1 Worker · 2 queued) · Merge queue: idle",
    );
  });

  it("summarizes a feature as done, working, and blocked", () => {
    const tasks = [
      ...Array.from({ length: 4 }, (_, index) => makeTask({ taskId: `done-${index}`, state: "MERGED_TO_FEATURE" })),
      ...Array.from({ length: 2 }, (_, index) => makeTask({ taskId: `work-${index}`, state: "CODING" })),
    ];
    const summary = new FeatureSwimlaneGrouper().summarize(tasks, (task) => task.feature, (task) => task.feature);
    expect(summary.get("F-Menu")?.summary).toBe("4/6 done · 2 working · 0 blocked");
    const { view } = createView(tasks);
    view.toggleFeatureGrouping();
    const chip = view
      .snapshot()
      .lanes.flatMap((lane) => lane.rows)
      .find((row) => row.kind === "swimlane");
    expect(chip && chip.kind === "swimlane" ? chip.summary : "").toBe("4/6 done · 2 working · 0 blocked");
  });

  it("groups 20 workers and keeps empty attention lanes slim", () => {
    const tasks = Array.from({ length: 20 }, (_, index) =>
      makeTask({
        taskId: `W${index}`,
        state: "CODING",
        feature: `F${index % 4}`,
        agentId: `A${String(index).padStart(4, "0")}`,
        title: `worker ${index}`,
        poolPhase: "waiting_for_run_slot",
        queuePosition: index + 1,
        queueBlocker: "verifier running",
        holderAttempt: `attempt-${index}`,
      }),
    );
    const { view } = createView(tasks, {
      capacity: {
        ...SAMPLE_CAPACITY,
        thinkingUsed: 0,
        runSlotQueueDepth: 10,
        verifierRunSlots: 1,
        workerRunSlots: 1,
        runSlotsUsed: 2,
      },
    });
    const snapshot = view.snapshot();
    expect(snapshot.featureGrouping).toBe(true);
    expect(snapshot.lanes.find((lane) => lane.id === "working")?.count).toBe(20);
    expect(snapshot.lanes.find((lane) => lane.id === "waiting_on_you")?.density).toBe("slim");
    expect(snapshot.lanes.find((lane) => lane.id === "held")?.density).toBe("slim");
    expect(snapshot.lanes.find((lane) => lane.id === "working")?.density).toBe("regular");
    const html = view.renderHtml();
    expect(html.includes("Waiting for run slot")).toBe(true);
    expect(html.includes("Stuck")).toBe(false);
    expect(html.includes("progressbar")).toBe(false);
    expect(html.includes("<progress")).toBe(false);
  });

  it("shows both hold reasons, quarantine, and a collapsed done lane", () => {
    const held = makeTask({
      taskId: "held-1",
      state: "CODING",
      submissionPending: true,
      holds: [
        { reason: "user_paused", source: "user", summary: "paused" },
        { reason: "ambiguous_message", source: "msg-14", summary: "clarifying cutoff" },
      ],
    });
    const done = makeTask({ taskId: "done-1", state: "MERGED_TO_FEATURE", title: "landed" });
    const { view } = createView([held, done]);
    const before = view.snapshot();
    const heldLane = before.lanes.find((lane) => lane.id === "held");
    const doneLane = before.lanes.find((lane) => lane.id === "done");
    expect(heldLane?.count).toBe(1);
    expect(doneLane?.collapsed).toBe(true);
    expect(doneLane?.count).toBe(1);
    expect(doneLane?.rows.filter((row) => row.kind === "card")).toHaveLength(0);
    const card = heldLane?.rows.find((row) => row.kind === "card");
    expect(card && card.kind === "card" ? card.card.holdBadge : "").toBe("Held (2 reasons)");
    expect(card && card.kind === "card" ? card.card.holdTitle : "").toContain("paused");
    expect(card && card.kind === "card" ? card.card.holdTitle : "").toContain("clarifying cutoff");
    expect(card && card.kind === "card" ? card.card.quarantined : false).toBe(true);
    expect(card && card.kind === "card" ? card.card.health : []).toHaveLength(5);
    expect(card && card.kind === "card" ? card.card.heightPx : 0).toBe(BOARD_CARD_HEIGHT_PX);
    expect(card && card.kind === "card" ? card.card.health.every((slot) => slot.sizePx === 16) : false).toBe(
      true,
    );
    view.toggleDoneCollapsed();
    expect(view.snapshot().lanes.find((lane) => lane.id === "done")?.collapsed).toBe(false);
  });

  it("filters print across lanes in under 2 ms", () => {
    const tasks = [
      makeTask({ taskId: "print", title: "print page", agentId: "A0014", state: "CODING" }),
      makeTask({ taskId: "other", title: "totals", agentId: "A0099", state: "READY", feature: "F-Other" }),
      makeTask({ taskId: "held", title: "menu print copy", agentId: "A0002", state: "CODING", holds: [{ reason: "budget", source: "cap", summary: "budget" }] }),
    ];
    const { view } = createView(tasks);
    view.snapshot();
    const started = performance.now();
    view.setSearch("print");
    const snapshot = view.snapshot();
    const elapsed = performance.now() - started;
    expect(elapsed).toBeLessThan(BOARD_FILTER_BUDGET_MS);
    const ids = snapshot.lanes.flatMap((lane) => lane.taskIds);
    expect(ids).toContain("print");
    expect(ids).toContain("held");
    expect(ids).not.toContain("other");
    const cards = snapshot.lanes.flatMap((lane) => lane.rows.filter((row) => row.kind === "card"));
    expect(cards.every((row) => row.kind === "card" && row.card.highlighted)).toBe(true);
    expect(cards.some((row) => row.kind === "card" && row.card.agentFull === "A0014 · print page")).toBe(true);
  });

  it("applies active-only and needs-attention modes", () => {
    const tasks = [
      makeTask({ taskId: "q", state: "READY" }),
      makeTask({ taskId: "w", state: "CODING" }),
      makeTask({ taskId: "h", state: "CODING", holds: [{ reason: "user_paused", source: "user", summary: "paused" }] }),
      makeTask({ taskId: "d", state: "ACCEPTED" }),
    ];
    const { view } = createView(tasks);
    view.setMode("active_only");
    const active = view.snapshot().lanes.flatMap((lane) => lane.taskIds);
    expect(active).not.toContain("q");
    expect(active).not.toContain("d");
    expect(active).toContain("w");
    view.setMode("needs_attention");
    expect(view.snapshot().lanes.flatMap((lane) => lane.taskIds)).toEqual(["h"]);
  });
});
