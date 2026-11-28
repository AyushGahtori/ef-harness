import { describe, expect, it } from "vitest";
import { AGING_NUDGE_MS, CALM_BATCH_MS } from "../../src/question-arbiter/index.js";
import { openArbiter, request } from "./harness.js";

describe("priority, aging, and focus mode", () => {
  it("ranks P0 above P1 above P2 above P3 above P4", () => {
    const runtime = openArbiter();
    const submit = (text: string, task: string, extra: Parameters<typeof request>[0] = { text, waitingTaskId: task }) => {
      const result = runtime.arbiter.submit(request({ ...extra, text, waitingTaskId: task }));
      if (result.lane !== "human_queue") throw new Error(`expected a card for ${text}`);
      return result.card.questionId;
    };
    const p4 = submit("FYI the lint run finished", "T-p4", { text: "FYI the lint run finished", waitingTaskId: "T-p4", kind: "advisory" });
    const p3 = submit("Which footer link should we show?", "T-p3");
    const p2 = submit("The dispute test disagrees with the receipt", "T-p2", {
      text: "The dispute test disagrees with the receipt",
      waitingTaskId: "T-p2",
      kind: "dispute_test",
    });
    const p1 = submit("Does the critical export include tax?", "T-p1", {
      text: "Does the critical export include tax?",
      waitingTaskId: "T-p1",
      onCriticalPath: true,
    });
    const p0 = submit("The OAuth token expired", "T-p0", {
      text: "The OAuth token expired",
      waitingTaskId: "T-p0",
      kind: "secret",
      signals: { authExpiry: true },
    });
    expect(runtime.arbiter.ranked().map((card) => card.questionId)).toEqual([p0, p1, p2, p3, p4]);
    expect(runtime.arbiter.ranked().map((card) => card.priority)).toEqual(["P0", "P1", "P2", "P3", "P4"]);
  });

  it("keeps P3 batched in focus mode while a P0 interrupts immediately", () => {
    const now = 0;
    const runtime = openArbiter(() => now);
    const minorA = runtime.arbiter.submit(request({ text: "Rename the quiet button?", waitingTaskId: "T-a" }));
    const minorB = runtime.arbiter.submit(request({ text: "Rename the quiet label?", waitingTaskId: "T-b" }));
    let criticalId = "";
    for (const waitingTaskId of ["T-1", "T-2", "T-3", "T-4"]) {
      const result = runtime.arbiter.submit(
        request({
          text: "The OAuth token expired for every worker",
          waitingTaskId,
          kind: "secret",
          signals: { authExpiry: true },
        }),
      );
      if (result.lane === "human_queue") criticalId = result.card.questionId;
    }
    const critical = runtime.arbiter.card(criticalId);
    expect(critical.priority).toBe("P0");
    expect(critical.blockingLabel).toBe("Blocking 4 tasks");
    if (minorA.lane === "human_queue") expect(minorA.card.priority).toBe("P3");
    if (minorB.lane === "human_queue") expect(minorB.card.priority).toBe("P3");

    runtime.arbiter.setFocusMode(true);
    const focused = runtime.arbiter.surfaced(now, true);
    expect(focused.map((item) => item.questionId)).toEqual([criticalId]);
    expect(focused[0]?.lane).toBe("interrupt_now");
    expect(focused[0]?.due).toBe(true);

    const quiet = runtime.arbiter.assessments(now, true).filter((item) => item.priority === "P3");
    expect(quiet).toHaveLength(2);
    expect(quiet.every((item) => item.surfaced === false && item.lane === "batch" && item.due === false)).toBe(true);
  });

  it("flushes a calm batch at 10 minutes, earlier for a second waiter or the critical path, and nudges at 30", () => {
    let now = 0;
    const runtime = openArbiter(() => now);
    const opened = runtime.arbiter.submit(request({ text: "Which toast copy should we use?", waitingTaskId: "T-toast" }));
    if (opened.lane !== "human_queue") throw new Error("expected a P3 card");
    const questionId = opened.card.questionId;
    expect(runtime.arbiter.assessments(CALM_BATCH_MS - 1)[0]?.due).toBe(false);
    expect(runtime.arbiter.assessments(CALM_BATCH_MS)[0]?.due).toBe(true);

    const joined = runtime.arbiter.submit(request({ text: "Which toast copy should we use?", waitingTaskId: "T-toast-2" }));
    if (joined.lane !== "human_queue") throw new Error("expected the same card");
    expect(joined.card.priority).toBe("P1");
    expect(joined.card.blockingLabel).toBe("Blocking 2 tasks");
    const flushed = runtime.arbiter.assessments(0).find((item) => item.questionId === questionId);
    expect(flushed?.earlyFlush).toBe(true);
    expect(flushed?.due).toBe(true);
    expect(flushed?.sound).toBe(false);
    expect(flushed?.modal).toBe(false);

    const single = runtime.arbiter.submit(request({ text: "Show unit prices in the tooltip?", waitingTaskId: "T-price" }));
    if (single.lane !== "human_queue") throw new Error("expected a single card");
    expect(single.card.priority).toBe("P3");
    const promoted = runtime.arbiter.noteCriticalPath("T-price", true)[0];
    expect(promoted?.priority).toBe("P1");
    expect(promoted?.onCriticalPath).toBe(true);
    expect(runtime.arbiter.assessments(0).find((item) => item.questionId === single.card.questionId)?.earlyFlush).toBe(true);

    now = AGING_NUDGE_MS;
    const aged = runtime.arbiter.assessments(now).find((item) => item.questionId === questionId);
    expect(aged?.agingNudge).toBe(true);
    expect(aged?.sound).toBe(false);
    expect(aged?.modal).toBe(false);
  });
});
