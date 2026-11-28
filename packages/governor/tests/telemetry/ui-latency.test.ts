import { describe, expect, it } from "vitest";
import { UiLatencyHeartbeatMonitor } from "../../src/telemetry/ui-latency.js";
import { UI_HEARTBEAT_HZ, UI_LATENCY_PRESSURE_MS } from "../../src/telemetry/types.js";

describe("UiLatencyHeartbeatMonitor", () => {
  it("reports sustained foreground lag above 50 ms while the user is interacting", () => {
    const monitor = new UiLatencyHeartbeatMonitor();
    monitor.ingest({ atMs: 0, uiLatencyMs: 80, documentHidden: false, interacting: true });
    expect(monitor.assessment().pressure).toBe(false);
    monitor.ingest({ atMs: 1000, uiLatencyMs: 90, documentHidden: false, interacting: true });
    const visible = monitor.assessment();
    expect(visible.pressure).toBe(true);
    expect(visible.uiLatencyMs).toBe(90);
    expect(visible.windowVisible).toBe(true);
    expect(visible.heartbeatHz).toBe(UI_HEARTBEAT_HZ);
    expect(visible.uiLatencyMs).toBeGreaterThan(UI_LATENCY_PRESSURE_MS);
  });

  it("suppresses throttled background rAF intervals while the window is hidden", () => {
    const monitor = new UiLatencyHeartbeatMonitor(1);
    monitor.ingest({ atMs: 0, uiLatencyMs: 1000, documentHidden: true, interacting: true });
    monitor.ingest({ atMs: 1000, uiLatencyMs: 1000, documentHidden: true, interacting: false });
    const hidden = monitor.assessment();
    expect(hidden.pressure).toBe(false);
    expect(hidden.suppressedHidden).toBe(true);
    expect(hidden.windowVisible).toBe(false);
    expect(hidden.uiLatencyMs).toBeNull();
    expect(hidden.consecutiveLagSamples).toBe(0);
  });

  it("does not treat idle foreground frames as interaction lag", () => {
    const monitor = new UiLatencyHeartbeatMonitor(1);
    monitor.ingest({ atMs: 0, uiLatencyMs: 80, documentHidden: false, interacting: false });
    expect(monitor.assessment().pressure).toBe(false);
  });
});
