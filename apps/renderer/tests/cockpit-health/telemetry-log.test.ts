import { afterEach, describe, expect, it } from "vitest";
import { BoardHealthSignalEngine, InMemoryTelemetryLog, TELEMETRY_HEALTH_TARGET } from "../../src/cockpit/health/index.js";
import { board, failingTests, worker } from "./support.js";

describe("health signal telemetry log", () => {
  const engines: BoardHealthSignalEngine[] = [];

  afterEach(() => {
    for (const engine of engines) engine.dispose();
    engines.length = 0;
  });

  it("records trigger and resolution duration in telemetry.db metric rows", () => {
    const log = new InMemoryTelemetryLog();
    const engine = new BoardHealthSignalEngine({ liveClock: false, telemetry: log });
    engines.push(engine);

    engine.ingest(board(300_000, [worker({ attemptId: "attempt-7" })]));
    engine.ingest(board(300_000, [worker({ attemptId: "attempt-7" })]));
    const triggered = log.events();
    expect(triggered).toHaveLength(1);
    expect(triggered[0]).toMatchObject({
      event: "health_signal_triggered",
      signal: "stuck_no_progress",
      taskId: "T-1",
      atMs: 300_000,
    });
    expect(log.rows[0]).toMatchObject({
      attempt: "attempt-7",
      ts: 300_000,
      kind: TELEMETRY_HEALTH_TARGET.kind,
    });
    expect(TELEMETRY_HEALTH_TARGET.table).toBe("telemetry");

    engine.ingest(
      board(360_000, [
        worker({
          attemptId: "attempt-7",
          progress: { tokenChunks: 1, lastTokenChunkAtMs: 360_000 },
        }),
      ]),
    );
    const events = log.events();
    expect(events).toHaveLength(2);
    expect(events[1]).toMatchObject({
      event: "health_signal_resolved",
      signal: "stuck_no_progress",
      atMs: 360_000,
      durationMs: 60_000,
    });

    engine.ingest(board(1_000, [worker({ taskId: "T-loop", steps: failingTests(3, "same-fingerprint") })]));
    expect(log.events().some((event) => event.signal === "loop_detected" && event.event === "health_signal_triggered")).toBe(
      true,
    );
  });
});
