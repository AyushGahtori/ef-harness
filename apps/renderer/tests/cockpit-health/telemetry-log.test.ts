import { afterEach, describe, expect, it } from "vitest";
import { BoardHealthSignalEngine, PreloadTelemetryLog, TELEMETRY_HEALTH_TARGET } from "../../src/cockpit/health/index.js";
import type { HealthMetricEvent } from "../../src/cockpit/health/index.js";
import type { PreloadMessagePort, TelemetryMetricMessage } from "../../src/shell/ports.js";
import { board, failingTests, worker } from "./support.js";

describe("health signal telemetry log", () => {
  const engines: BoardHealthSignalEngine[] = [];

  afterEach(() => {
    for (const engine of engines) engine.dispose();
    engines.length = 0;
  });

  it("records trigger and resolution duration in telemetry.db metric rows", () => {
    const sent: TelemetryMetricMessage[] = [];
    const port: PreloadMessagePort = {
      postMessage(message) {
        if ("method" in message && message.method === "telemetry.metric") sent.push(message);
      },
      onMessage() {
        return () => {};
      },
    };
    const log = new PreloadTelemetryLog(port);
    const engine = new BoardHealthSignalEngine({ liveClock: false, telemetry: log });
    engines.push(engine);

    engine.ingest(board(300_000, [worker({ attemptId: "attempt-7" })]));
    engine.ingest(board(300_000, [worker({ attemptId: "attempt-7" })]));
    const triggered = sent.map((message) => message.params.data as HealthMetricEvent);
    expect(triggered).toHaveLength(1);
    expect(triggered[0]).toMatchObject({
      event: "health_signal_triggered",
      signal: "stuck_no_progress",
      taskId: "T-1",
      atMs: 300_000,
    });
    expect(sent[0]?.params).toMatchObject({
      attempt: "attempt-7",
      ts: 300_000,
      kind: TELEMETRY_HEALTH_TARGET.kind,
    });
    expect(TELEMETRY_HEALTH_TARGET.table).toBe("telemetry");
    expect(TELEMETRY_HEALTH_TARGET.database).toBe("telemetry.db");

    engine.ingest(
      board(360_000, [
        worker({
          attemptId: "attempt-7",
          progress: { tokenChunks: 1, lastTokenChunkAtMs: 360_000 },
        }),
      ]),
    );
    const events = sent.map((message) => message.params.data as HealthMetricEvent);
    expect(events).toHaveLength(2);
    expect(events[1]).toMatchObject({
      event: "health_signal_resolved",
      signal: "stuck_no_progress",
      atMs: 360_000,
      durationMs: 60_000,
    });

    engine.ingest(board(1_000, [worker({ taskId: "T-loop", steps: failingTests(3, "same-fingerprint") })]));
    expect(
      sent.some((message) => {
        const event = message.params.data as HealthMetricEvent;
        return event.signal === "loop_detected" && event.event === "health_signal_triggered";
      }),
    ).toBe(true);
  });
});
