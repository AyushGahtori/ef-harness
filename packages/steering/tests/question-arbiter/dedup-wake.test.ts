import { describe, expect, it } from "vitest";
import { INBOX_HOLD_REASON } from "../../src/question-arbiter/index.js";
import { openArbiter, request } from "./harness.js";

describe("QuestionDedupSubscriberStore", () => {
  it("collapses five identical questions into one card and wakes every subscriber", () => {
    const runtime = openArbiter();
    const text = "What date format should we display?";
    const tasks = ["T-1", "T-2", "T-3", "T-4", "T-5"];
    let questionId = "";
    for (const waitingTaskId of tasks) {
      const result = runtime.arbiter.submit(request({ text, waitingTaskId }));
      expect(result.lane).toBe("human_queue");
      if (result.lane === "human_queue") questionId = result.card.questionId;
    }
    const card = runtime.arbiter.card(questionId);
    expect(runtime.arbiter.activeQueue()).toHaveLength(1);
    expect(card.blockingLabel).toBe("Blocking 5 tasks");
    expect(card.whyThisMatters).toBe("Why this matters (blocks 5 tasks)");
    expect(card.blockedWorkerCount).toBe(5);
    expect(card.options.map((option) => option.number)).toEqual([1, 2]);
    expect(card.options[0]?.label).toBe("ISO 8601 (YYYY-MM-DD)");
    expect(card.recommendedOptionId).toBe("opt-1");
    expect(card.optionsVersion).toBe(1);
    expect(card.subscribers.filter((subscriber) => subscriber.active)).toHaveLength(5);
    expect(runtime.projection(questionId)?.subscribers).toHaveLength(5);

    const answered = runtime.arbiter.answer(questionId, { optionsVersion: 1, optionId: "opt-1" });
    expect(answered.outcome).toBe("applied");
    if (answered.outcome !== "applied") throw new Error("expected an applied answer");
    expect(new Set(answered.wokenTaskIds)).toEqual(new Set(tasks));
    expect(answered.mutated).toBe(true);
    expect(runtime.wakes(questionId)).toHaveLength(5);
    expect(runtime.arbiter.activeQueue()).toHaveLength(0);
    for (const taskId of tasks) {
      expect(runtime.holds(taskId).some((hold) => hold.reasonType === INBOX_HOLD_REASON && hold.active)).toBe(false);
    }
    const settled = runtime.outbox().find((event) => event.type === "QuestionSettled");
    expect(settled).toBeDefined();
    const payload = JSON.parse(settled?.payload ?? "{}") as { wokenTaskIds?: string[] };
    expect(new Set(payload.wokenTaskIds)).toEqual(new Set(tasks));
    const totals = runtime.arbiter.interruptionTotals("build-1");
    expect(totals.humanInterruptions).toBe(1);
    expect(totals.duplicatesCollapsed).toBe(4);
  });

  it("collapses different wording that shares a scope and criterion", () => {
    const runtime = openArbiter();
    const first = runtime.arbiter.submit(
      request({
        text: "Should cancelled orders appear in daily kitchen totals?",
        waitingTaskId: "T-a",
        scopeId: "kitchen",
        criterionId: "cancelled-totals",
      }),
    );
    const second = runtime.arbiter.submit(
      request({
        text: "Do cancelled tickets count toward the kitchen day?",
        waitingTaskId: "T-b",
        scopeId: "kitchen",
        criterionId: "cancelled-totals",
      }),
    );
    expect(first.lane).toBe("human_queue");
    expect(second.lane).toBe("human_queue");
    if (second.lane === "human_queue") {
      expect(second.collapsed).toBe(true);
      expect(second.card.blockingLabel).toBe("Blocking 2 tasks");
    }
    expect(runtime.arbiter.activeQueue()).toHaveLength(1);
  });

  it("keeps a different criterion on its own card", () => {
    const runtime = openArbiter();
    runtime.arbiter.submit(
      request({ text: "First rule?", waitingTaskId: "T-1", scopeId: "kitchen", criterionId: "cutoff" }),
    );
    runtime.arbiter.submit(
      request({ text: "Second rule?", waitingTaskId: "T-2", scopeId: "kitchen", criterionId: "format" }),
    );
    expect(runtime.arbiter.activeQueue()).toHaveLength(2);
  });

  it("drops one subscriber without retiring the card, then retires at zero", () => {
    const runtime = openArbiter();
    const opened = runtime.arbiter.submit(
      request({ text: "Which list should print?", waitingTaskId: "T-9", questionId: "Q-15" }),
    );
    runtime.arbiter.submit(request({ text: "Which list should print?", waitingTaskId: "T-10" }));
    if (opened.lane !== "human_queue") throw new Error("expected Q-15");
    const afterOne = runtime.arbiter.cancelTask("T-9")[0];
    expect(afterOne?.questionId).toBe("Q-15");
    expect(afterOne?.status).toBe("open");
    expect(afterOne?.blockingLabel).toBe("Blocking 1 task");
    expect(runtime.arbiter.activeQueue().map((card) => card.questionId)).toEqual(["Q-15"]);

    const afterLast = runtime.arbiter.cancelTask("T-10")[0];
    expect(afterLast?.status).toBe("retired");
    expect(afterLast?.retiredReason).toBe("no_active_waiters");
    expect(runtime.arbiter.activeQueue()).toHaveLength(0);
  });

  it("rolls back the whole wake when a hold clear fails", () => {
    const runtime = openArbiter();
    const tasks = ["T-1", "T-2", "T-3"];
    let questionId = "";
    for (const waitingTaskId of tasks) {
      const result = runtime.arbiter.submit(request({ text: "Ship the export on Friday?", waitingTaskId }));
      if (result.lane === "human_queue") questionId = result.card.questionId;
    }
    runtime.placeHold({
      taskId: "T-1",
      reasonType: "user_paused",
      reasonRefId: "pause-1",
      mode: "HARD_HOLD",
    });
    runtime.armHoldClearFailure();
    expect(() => runtime.arbiter.answer(questionId, { optionsVersion: 1, optionId: "opt-1" })).toThrow(/rolled back/);
    expect(runtime.arbiter.card(questionId).status).toBe("open");
    expect(runtime.wakes(questionId)).toHaveLength(0);
    expect(runtime.holds("T-1").some((hold) => hold.reasonType === INBOX_HOLD_REASON)).toBe(true);
    expect(runtime.holds("T-1").some((hold) => hold.reasonType === "user_paused")).toBe(true);

    const answered = runtime.arbiter.answer(questionId, { optionsVersion: 1, optionId: "opt-1" });
    expect(answered.outcome).toBe("applied");
    expect(runtime.holds("T-1").map((hold) => hold.reasonType)).toEqual(["user_paused"]);
  });

  it("numbers options monotonically and keeps a recommended default", () => {
    const runtime = openArbiter();
    const opened = runtime.arbiter.submit(
      request({
        text: "Which cutoff should the kitchen use?",
        waitingTaskId: "T-1",
        options: ["11:00", "10:45"],
        recommendedOptionId: "opt-2",
      }),
    );
    if (opened.lane !== "human_queue") throw new Error("expected a card");
    expect(opened.card.options.map((option) => [option.number, option.label])).toEqual([
      [1, "11:00"],
      [2, "10:45"],
    ]);
    expect(opened.card.recommendedOptionId).toBe("opt-2");
    const revised = runtime.arbiter.reviseOptions(opened.card.questionId, ["11:00", "10:45", "10:30"], "opt-3");
    expect(revised.optionsVersion).toBe(2);
    const again = runtime.arbiter.reviseOptions(opened.card.questionId, ["11:00", "10:30"]);
    expect(again.optionsVersion).toBe(3);
    expect(again.recommendedOptionId).toBe("opt-1");
  });
});
