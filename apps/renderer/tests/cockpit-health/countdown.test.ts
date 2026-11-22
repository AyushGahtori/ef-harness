import { afterEach, describe, expect, it, vi } from "vitest";
import { BoardHealthSignalEngine } from "../../src/cockpit/health/index.js";
import type { HealthBoardSnapshot } from "../../src/cockpit/health/index.js";
import { board, worker } from "./support.js";

describe("throttled backoff countdown", () => {
  const engines: BoardHealthSignalEngine[] = [];

  afterEach(() => {
    for (const engine of engines) engine.dispose();
    engines.length = 0;
    vi.useRealTimers();
  });

  it("ticks 0:45 down to 0:00 once per second without another daemon pull", () => {
    vi.useFakeTimers();
    const snapshot: HealthBoardSnapshot = board(0, [
      worker({
        pacingState: "backoff_429",
        backoff: { active: true, retryAtMs: 45_000, source: "http_429" },
        progress: { tokenChunks: 1, lastTokenChunkAtMs: 0 },
      }),
    ]);
    let pulls = 0;
    const engine = new BoardHealthSignalEngine({
      daemon: {
        pullHealthSnapshot() {
          pulls += 1;
          return snapshot;
        },
      },
    });
    engines.push(engine);
    engine.refreshFromDaemon();

    const label = () =>
      engine.view().workers[0]?.signals.find((signal) => signal.kind === "rate_limited_backoff")?.label;

    expect(label()).toBe("Rate-limited · retrying in 0:45");
    expect(engine.view().workers[0]?.signals[0]?.tone).toBe("amber");
    expect(engine.view().workers[0]?.signals[0]?.actions[0]?.label).toBe("Lower concurrency");

    vi.advanceTimersByTime(1_000);
    expect(label()).toBe("Rate-limited · retrying in 0:44");

    vi.advanceTimersByTime(44_000);
    expect(label()).toBe("Rate-limited · retrying in 0:00");
    expect(engine.view().workers[0]?.stuck).toBe(false);

    vi.advanceTimersByTime(1_000);
    expect(label()).toBeUndefined();
    expect(pulls).toBe(1);
    expect(engine.view().ipcPulls).toBe(1);
    expect(engine.view().localTicks).toBe(46);
    expect(engine.view().modelCalls).toBe(0);
  });
});
