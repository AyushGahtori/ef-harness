import { afterEach, describe, expect, it } from "vitest";
import {
  BoardHealthSignalEngine,
  HEALTH_BADGE_SLOT_HEIGHT_PX,
  allowanceLabel,
} from "../../src/cockpit/health/index.js";
import { board, failingTests, worker } from "./support.js";

const TYPE_ERROR = "TypeError: Cannot read properties of undefined";

describe("five health signals, remediation, and the summary pill", () => {
  const engines: BoardHealthSignalEngine[] = [];

  afterEach(() => {
    for (const engine of engines) engine.dispose();
    engines.length = 0;
  });

  function run(nowMs: number, workers: ReturnType<typeof worker>[]) {
    const engine = new BoardHealthSignalEngine({ liveClock: false });
    engines.push(engine);
    return engine.ingest(board(nowMs, workers));
  }

  it("fires the 3× loop on the third identical vitest failure without waiting five minutes", () => {
    const view = run(10_000, [
      worker({
        steps: failingTests(3, TYPE_ERROR),
        failingSnippet: TYPE_ERROR,
      }),
    ]);
    const loop = view.workers[0]?.signals.find((signal) => signal.kind === "loop_detected");
    expect(view.workers[0]?.stuck).toBe(false);
    expect(loop?.label).toBe("Repeating error 3×");
    expect(loop?.tone).toBe("red");
    expect(loop?.detail).toBe(TYPE_ERROR);
    expect(loop?.actions.map((action) => action.label)).toEqual([
      "Escalate tier",
      "Give hint",
      "I'll fix it myself",
    ]);
    expect(loop?.actions.every((action) => action.destructive === false && action.opensModal === false)).toBe(
      true,
    );
    expect(run(10_000, [worker({ steps: failingTests(2, TYPE_ERROR) })]).workers[0]?.signals).toEqual([]);
  });

  it("counts edit-undo oscillation and a sibling loop-detector reading of 3", () => {
    const oscillating = run(1_000, [
      worker({
        steps: [
          { index: 1, kind: "edit", fingerprint: "a", failed: false, toolName: null, errorSnippet: null },
          { index: 2, kind: "undo", fingerprint: "a", failed: false, toolName: null, errorSnippet: null },
          { index: 3, kind: "edit", fingerprint: "a", failed: false, toolName: null, errorSnippet: null },
        ],
      }),
    ]);
    expect(oscillating.workers[0]?.signals.some((signal) => signal.kind === "loop_detected")).toBe(true);

    const short = run(1_000, [
      worker({
        steps: [
          { index: 1, kind: "edit", fingerprint: "a", failed: false, toolName: null, errorSnippet: null },
          { index: 2, kind: "undo", fingerprint: "a", failed: false, toolName: null, errorSnippet: null },
        ],
      }),
    ]);
    expect(short.workers[0]?.signals.some((signal) => signal.kind === "loop_detected")).toBe(false);

    const fromSibling = run(1_000, [
      worker({
        loop: {
          identicalFailingToolInvocations: 3,
          errorSnippet: TYPE_ERROR,
        },
      }),
    ]);
    expect(fromSibling.workers[0]?.signals.find((signal) => signal.kind === "loop_detected")?.label).toBe(
      "Repeating error 3×",
    );
  });

  it("renders allowance reset, hint escalation, dispute, and exhausted retries", () => {
    const view = run(0, [
      worker({
        taskId: "T-reset",
        allowance: {
          active: true,
          providerLabel: "ChatGPT Plus",
          resetAtMs: 78 * 60_000,
          window: "five_hour",
        },
      }),
      worker({
        taskId: "T-hint",
        hint: { hintLevel: 2, escalatedTo: "Senior" },
      }),
      worker({
        taskId: "T-dispute",
        hint: { disputeTest: true, hintLevel: 1 },
      }),
      worker({
        taskId: "T-spent",
        hint: { retriesExhausted: true, failedAttempts: 3, hintLevel: 3, escalatedTo: "Senior" },
      }),
      worker({
        taskId: "T-hint1",
        hint: { hintLevel: 1 },
      }),
    ]);

    expect(view.workers[0]?.signals.find((signal) => signal.kind === "allowance_window_wait")).toMatchObject({
      label: "Paused for ChatGPT reset · 1h 18m",
      tone: "violet",
      clusterLabel: "Switch connection / Keep parked",
    });
    expect(view.workers[0]?.signals[0]?.actions.map((action) => action.label)).toEqual([
      "Switch connection",
      "Keep parked",
      "Open Checkpoint Stop Card",
    ]);

    expect(view.workers[1]?.signals.map((signal) => signal.label)).toEqual([
      "Retry 2/3 · Senior escalated",
    ]);
    expect(view.workers[1]?.signals[0]?.tone).toBe("red");
    expect(view.workers[1]?.signals[0]?.actions[0]?.label).toBe("Open Dispute/Decision Card");
    expect(allowanceLabel("Cursor", 60_000)).toBe("Paused for Cursor reset · 1m");

    expect(view.workers[2]?.signals.map((signal) => signal.label)).toEqual([
      "Test disputed — needs review",
    ]);
    expect(view.workers[3]?.signals.map((signal) => signal.label)).toEqual([
      "Needs help — 3/3 retries failed",
      "Retry 3/3 · Senior escalated",
    ]);
    expect(view.workers[4]?.signals).toEqual([]);
  });

  it("keeps an inline reserved slot with no flashing banner and filters the summary", () => {
    const healthy = Array.from({ length: 12 }, (_, index) =>
      worker({
        taskId: `T-${index}`,
        progress: { tokenChunks: 1, lastTokenChunkAtMs: 0 },
      }),
    );
    const calm = run(0, healthy);
    expect(calm.summary.label).toBe("All 12 workers healthy");
    expect(calm.summary.shown).toBe("All 12 healthy");
    expect(calm.summary.healthy).toBe(true);
    expect(calm.summary.obtrusive).toBe(false);
    expect(calm.summary.flashing).toBe(false);
    expect(calm.summary.modal).toBe(false);
    expect(calm.summary.explainButton.label).toBe("Explain what's happening");
    expect(calm.summary.filterCards(healthy.map((item) => ({ taskId: item.taskId })))).toHaveLength(12);
    expect(calm.slots.every((slot) => slot.layoutShift === 0 && slot.reservedHeightPx === HEALTH_BADGE_SLOT_HEIGHT_PX)).toBe(
      true,
    );
    expect(calm.workers[0]?.strip.render().includes("blink")).toBe(false);
    expect(calm.workers[0]?.strip.render().includes("<dialog")).toBe(false);

    const mixed = run(0, [
      worker({ taskId: "T-loop", steps: failingTests(3, TYPE_ERROR) }),
      worker({
        taskId: "T-reset",
        allowance: {
          active: true,
          providerLabel: "Copilot",
          resetAtMs: 60_000,
          window: "weekly",
        },
      }),
      worker({ taskId: "T-ok", progress: { tokenChunks: 1, lastTokenChunkAtMs: 0 } }),
      ...Array.from({ length: 5 }, (_, index) =>
        worker({ taskId: `T-rest-${index}`, progress: { tokenChunks: 1, lastTokenChunkAtMs: 0 } }),
      ),
    ]);
    expect(mixed.summary.label).toBe("1 looping · 1 waiting on reset");
    expect(mixed.summary.shown).toBe("1 looping · 1 waiting on reset");
    expect(mixed.summary.filterCards(mixed.workers.map((item) => ({ taskId: item.taskId }))).map((item) => item.taskId)).toEqual([
      "T-loop",
      "T-reset",
    ]);
    expect(mixed.workers[1]?.signals[0]?.label).toBe("Paused for Copilot reset · 1m");
    const flagged = mixed.workers[0]?.strip.render() ?? "";
    expect(flagged).toContain("Explain what's happening");
    expect(flagged).toContain('data-layout-shift="0"');
    expect(flagged).toContain('data-modal="false"');
    expect(flagged).toContain('data-tone="red"');
  });
});
