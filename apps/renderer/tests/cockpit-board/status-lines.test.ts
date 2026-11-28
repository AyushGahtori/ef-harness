import { describe, expect, it } from "vitest";
import {
  AGENT_TAG_MAX_CHARS,
  DeterministicStatusLineFormatter,
  STATUS_LINE_BUDGET_MS,
  STATUS_LINE_LLM_CALLS,
  formatAgentTag,
  truncateRepoPath,
} from "../../src/cockpit/board/index.js";
import { makeTask } from "./fixtures.js";

describe("DeterministicStatusLineFormatter", () => {
  const formatter = new DeterministicStatusLineFormatter();

  it("formats the canonical captions with zero model calls", () => {
    expect(formatter.llmCalls).toBe(0);
    expect(STATUS_LINE_LLM_CALLS).toBe(0);
    expect(
      formatter.format({ kind: "editing", path: "src/api/orders.ts", step: 4, stepEstimate: 8 }).text,
    ).toBe("Editing src/api/orders.ts (step 4 of ~8)");
    expect(
      formatter.format({
        kind: "running",
        command: "vitest",
        runSlot: 1,
        runSlotCapacity: 2,
        elapsedSeconds: 14,
      }).text,
    ).toBe("Running vitest (run slot 1/2 · 14s)");
    expect(
      formatter.format({ kind: "waiting_for_run_slot", queuePosition: 2, blocker: "verifier running" }).text,
    ).toBe("Waiting for run slot (#2 in queue · verifier running)");
    expect(
      formatter.format({
        kind: "verifying",
        flow: "Playwright mobile flow",
        retry: 2,
        retryMax: 3,
        hint: 1,
      }).text,
    ).toBe("Verifying Playwright mobile flow (Retry 2/3 · Hint 1)");
    expect(formatter.format({ kind: "merge_queue", behindCount: 1, behindLabel: "F-Menu" }).text).toBe(
      "Queued in merge queue (#1 behind F-Menu)",
    );
    expect(
      formatter.format({
        kind: "held",
        reason: "waiting on cutoff clarification",
        quarantined: true,
      }).text,
    ).toBe("Held: waiting on cutoff clarification (verified diff quarantined)");
    expect(formatter.llmCalls).toBe(0);
  });

  it("keeps each caption under 0.1 ms", () => {
    const events = [
      { kind: "editing" as const, path: "src/api/orders.ts", step: 4, stepEstimate: 8 },
      { kind: "running" as const, command: "vitest", runSlot: 1, runSlotCapacity: 2, elapsedSeconds: 14 },
      { kind: "waiting_for_run_slot" as const, queuePosition: 2, blocker: "verifier running" },
      { kind: "verifying" as const, flow: "Playwright mobile flow", retry: 2, retryMax: 3, hint: 1 },
      { kind: "merge_queue" as const, behindCount: 1, behindLabel: "F-Menu" },
      { kind: "held" as const, reason: "waiting on cutoff clarification", quarantined: true },
    ];
    const iterations = 2000;
    const started = performance.now();
    for (let index = 0; index < iterations; index += 1) {
      for (const event of events) formatter.format(event);
    }
    const perCall = (performance.now() - started) / (iterations * events.length);
    expect(perCall).toBeLessThan(STATUS_LINE_BUDGET_MS);
    expect(formatter.llmCalls).toBe(0);
  });

  it("truncates long repo paths in the line and keeps the full path on the tooltip", () => {
    const full = "packages/backend/src/features/kitchen/orders/handlers/submitOrderHandler.ts";
    expect(truncateRepoPath(full).display).toBe(".../orders/handlers/submitOrderHandler.ts");
    const formatted = formatter.format({ kind: "editing", path: full, step: 4, stepEstimate: 8 });
    expect(formatted.text).toBe("Editing .../orders/handlers/submitOrderHandler.ts (step 4 of ~8)");
    expect(formatted.title).toContain(full);
    expect(formatted.llmCalls).toBe(0);
  });

  it("derives honest lines from structured fields, including the cockpit reference examples", () => {
    expect(
      formatter.format({ kind: "queued_dependency", taskId: "T03", title: "kitchen totals" }).text,
    ).toBe("Waits for T03 (kitchen totals)");
    expect(
      formatter.format({ kind: "inbox_block", need: "STRIPE_SECRET_KEY", blockedTaskIds: ["T12", "T13"] }).text,
    ).toBe("Needs STRIPE_SECRET_KEY · blocks T12, T13");
    expect(formatter.format({ kind: "checks", passed: 14, total: 15 }).text).toBe("14 of 15 checks");
    expect(formatter.format({ kind: "integrating", detail: "Journey test on integration branch" }).text).toBe(
      "Journey test on integration branch",
    );
    expect(
      formatter.format({ kind: "accepted", acceptedAtLabel: "13:58", levelLabel: "Mid", spendLabel: "$0.11" }).text,
    ).toBe("Accepted 13:58 · Mid · $0.11");
    expect(formatter.format({ kind: "attempt_checks", passed: 6, failed: 1, attempt: 2 }).text).toBe(
      "Running tests · 6 passed, 1 failed · attempt 2",
    );
    expect(formatter.format({ kind: "throttled", retryInLabel: "~40 s" }).text).toBe("Rate-limited · retry in ~40 s");
    const derived = formatter.formatTask(
      makeTask({
        state: "CODING",
        poolPhase: "waiting_for_run_slot",
        queuePosition: 2,
        queueBlocker: "verifier running",
      }),
    );
    expect(derived.text).toBe("Waiting for run slot (#2 in queue · verifier running)");
    expect(derived.text.includes("Stuck")).toBe(false);
    expect(derived.llmCalls).toBe(0);
  });

  it("clamps agent tags to 22 characters and keeps the full title", () => {
    const short = formatAgentTag("A0014", "print page");
    expect(short.label).toBe("A0014 · print page");
    expect(short.full).toBe("A0014 · print page");
    expect(short.label.length).toBeLessThanOrEqual(AGENT_TAG_MAX_CHARS);
    const long = formatAgentTag("A0014", "print the kitchen ticket");
    expect(long.label.length).toBeLessThanOrEqual(AGENT_TAG_MAX_CHARS);
    expect(long.full).toBe("A0014 · print the kitchen ticket");
    expect(long.label.endsWith("…")).toBe(true);
  });
});
