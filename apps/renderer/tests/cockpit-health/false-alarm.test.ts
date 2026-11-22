import { afterEach, describe, expect, it } from "vitest";
import { BoardHealthSignalEngine, normalizePoolState } from "../../src/cockpit/health/index.js";
import { board, worker } from "./support.js";

const SEVEN_MINUTES = 7 * 60_000;

describe("false stuck-alarm suppression", () => {
  const engines: BoardHealthSignalEngine[] = [];

  afterEach(() => {
    for (const engine of engines) engine.dispose();
    engines.length = 0;
  });

  function evaluate(draft: Parameters<typeof worker>[0]) {
    const engine = new BoardHealthSignalEngine({ liveClock: false });
    engines.push(engine);
    return engine.ingest(board(SEVEN_MINUTES, [worker(draft)])).workers[0];
  }

  it("shows a calm run-slot pill after 7 minutes in Pool 2 and never a stuck alarm", () => {
    expect(normalizePoolState("waiting_for_run_slot")).toBe("waiting_run_slot");
    const view = evaluate({
      poolState: normalizePoolState("waiting_for_run_slot"),
      poolWaitSinceMs: 0,
    });
    expect(view?.stuck).toBe(false);
    expect(view?.suppressions).toContain("pool2_run_slot");
    const pill = view?.signals.find((signal) => signal.kind === "waiting_run_slot");
    expect(pill?.label).toBe("Waiting for run slot · 7m");
    expect(pill?.tone).toBe("violet");
    expect(pill?.alarm).toBe(false);
    expect(view?.signals.some((signal) => signal.kind === "stuck_no_progress")).toBe(false);
  });

  it("suppresses stuck while an inbox reply, a hold, a 429, or an allowance reset is open", () => {
    const inbox = evaluate({ inbox: { active: true } });
    expect(inbox?.stuck).toBe(false);
    expect(inbox?.suppressions).toContain("inbox_reply");

    const held = evaluate({ hold: { active: true, reason: "clarifying cutoff" } });
    expect(held?.stuck).toBe(false);
    expect(held?.suppressions).toContain("task_hold");

    const throttled = evaluate({
      pacingState: "backoff_429",
      backoff: { active: true, retryAtMs: SEVEN_MINUTES + 45_000, source: "http_429" },
    });
    expect(throttled?.stuck).toBe(false);
    expect(throttled?.suppressions).toContain("rate_limit_backoff");
    expect(throttled?.signals.find((signal) => signal.kind === "rate_limited_backoff")?.label).toBe(
      "Rate-limited · retrying in 0:45",
    );

    const parked = evaluate({
      pacingState: "window_exhausted",
      allowance: {
        active: true,
        providerLabel: "ChatGPT Plus",
        resetAtMs: SEVEN_MINUTES + 78 * 60_000,
        window: "five_hour",
      },
    });
    expect(parked?.stuck).toBe(false);
    expect(parked?.suppressions).toContain("allowance_reset");
    expect(parked?.signals.some((signal) => signal.kind === "stuck_no_progress")).toBe(false);
  });
});
