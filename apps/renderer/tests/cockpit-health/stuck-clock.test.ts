import { afterEach, describe, expect, it, vi } from "vitest";
import { BoardHealthSignalEngine, STUCK_THRESHOLD_MS } from "../../src/cockpit/health/index.js";
import { board, worker } from "./support.js";

describe("5-minute stuck clock", () => {
  const engines: BoardHealthSignalEngine[] = [];

  afterEach(() => {
    for (const engine of engines) engine.dispose();
    engines.length = 0;
    vi.useRealTimers();
  });

  it("crosses the boundary at exactly 300s and stays quiet at 299s", () => {
    vi.useFakeTimers();
    const engine = new BoardHealthSignalEngine();
    engines.push(engine);
    engine.ingest(board(0, [worker()]));

    vi.advanceTimersByTime(STUCK_THRESHOLD_MS - 1_000);
    expect(engine.view().workers[0]?.stuck).toBe(false);
    expect(engine.view().workers[0]?.signals.some((signal) => signal.kind === "stuck_no_progress")).toBe(
      false,
    );

    vi.advanceTimersByTime(1_000);
    const stuck = engine.view().workers[0]?.signals.find((signal) => signal.kind === "stuck_no_progress");
    expect(stuck?.label).toBe("No progress · 5m");
    expect(stuck?.tone).toBe("red");
    expect(stuck?.clusterLabel).toBe("Inspect / Nudge / Restart");
    expect(stuck?.actions.map((action) => action.label)).toEqual([
      "Inspect",
      "Nudge",
      "Restart",
      "Restart fresh attempt",
      "Inspect raw stream",
    ]);
    expect(stuck?.flashing).toBe(false);
    expect(stuck?.modal).toBe(false);
    expect(stuck?.stealsFocus).toBe(false);
    expect(engine.view().modelCalls).toBe(0);
  });

  it("shows 6m after six minutes and 5m at 5m 10s of a silent stream", () => {
    const engine = new BoardHealthSignalEngine({ liveClock: false });
    engines.push(engine);
    const six = engine.ingest(board(360_000, [worker()]));
    expect(six.workers[0]?.signals.find((signal) => signal.kind === "stuck_no_progress")?.label).toBe(
      "No progress · 6m",
    );

    const halfOpen = engine.ingest(board(310_000, [worker()]));
    expect(halfOpen.workers[0]?.signals.find((signal) => signal.kind === "stuck_no_progress")?.label).toBe(
      "No progress · 5m",
    );
    expect(halfOpen.modelCalls).toBe(0);
  });

  it("resets the clock when a token chunk, file edit, or completed tool call arrives", () => {
    const engine = new BoardHealthSignalEngine({ liveClock: false });
    engines.push(engine);
    const view = engine.ingest(
      board(400_000, [
        worker({
          progress: {
            tokenChunks: 1,
            lastTokenChunkAtMs: 200_000,
          },
        }),
        worker({
          taskId: "T-edit",
          progress: { fileEdits: 1, lastFileEditAtMs: 250_000 },
        }),
        worker({
          taskId: "T-tool",
          progress: { completedToolCalls: 1, lastCompletedToolCallAtMs: 390_000 },
        }),
      ]),
    );
    expect(view.workers.every((item) => item.stuck === false)).toBe(true);
  });
});
