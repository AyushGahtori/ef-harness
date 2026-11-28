import { describe, expect, it } from "vitest";
import { DiskHeadroomGuard } from "../../src/admission/disk-headroom-guard.js";
import { DISK_EMERGENCY_BYTES, DISK_PAUSE_BYTES, DISK_WARN_BYTES, GiB } from "../../src/admission/thresholds.js";
import { volume } from "./laptop.js";

const plenty = 40 * GiB;

describe("disk headroom guard", () => {
  it("uses the exact 15 GB, 5 GB, and 2 GB thresholds", () => {
    expect(DISK_WARN_BYTES).toBe(15 * GiB);
    expect(DISK_PAUSE_BYTES).toBe(5 * GiB);
    expect(DISK_EMERGENCY_BYTES).toBe(2 * GiB);
  });

  it("warns the project drive after 10s without touching a healthy AppData drive", () => {
    const guard = new DiskHeadroomGuard();
    const project = volume("D:", 10 * GiB);
    const appData = volume("C:", plenty);
    guard.observe({ project, appData, nowMs: 0 });
    expect(guard.observe({ project, appData, nowMs: 3_000 }).project.tier).toBe("OK");
    const view = guard.observe({ project, appData, nowMs: 10_000 });
    expect(view.project.tier).toBe("WARN");
    expect(view.appData.tier).toBe("OK");
    expect(view.maintenance.backgroundCasGc).toBe(true);
    expect(view.maintenance.expiredTempWorktreeCleanup).toBe(true);
    expect(view.maintenance.oldLogCleanup).toBe(true);
    expect(view.maintenance.aggressiveSafeCacheCleanup).toBe(false);
    expect(view.maintenance.pauseNewLaunches).toBe(false);
    expect(view.maintenance.subtleYellowIndicator).toBe(true);
    expect(view.cardMessage).toBeNull();
  });

  it("pauses launches from the AppData drive after 10s and leaves the project drive alone", () => {
    const guard = new DiskHeadroomGuard();
    const project = volume("D:", plenty);
    const appData = volume("C:", 4 * GiB);
    guard.observe({ project, appData, nowMs: 0 });
    expect(guard.observe({ project, appData, nowMs: 9_999 }).maintenance.pauseNewLaunches).toBe(false);
    const view = guard.observe({ project, appData, nowMs: 10_000 });
    expect(view.project.tier).toBe("OK");
    expect(view.appData.tier).toBe("PAUSE");
    expect(view.maintenance.pauseNewLaunches).toBe(true);
    expect(view.maintenance.aggressiveSafeCacheCleanup).toBe(true);
    expect(view.maintenance.backgroundCasGc).toBe(true);
    expect(view.maintenance.pauseAllRunningWriters).toBe(false);
    expect(view.cardMessage).toBe(
      "Low disk space (< 5 GB on C:) — Free space or clean caches",
    );
  });

  it("hard-stops writers in 0s under 2 GB on either drive", () => {
    const guard = new DiskHeadroomGuard();
    const healthy = guard.observe({
      project: volume("D:", plenty),
      appData: volume("C:", plenty),
      nowMs: 0,
    });
    expect(healthy.tightestTier).toBe("OK");
    const view = guard.observe({
      project: volume("D:", 1.5 * GiB),
      appData: volume("C:", plenty),
      nowMs: 2_000,
    });
    expect(view.project.tier).toBe("EMERGENCY");
    expect(view.appData.tier).toBe("OK");
    expect(view.maintenance.pauseAllRunningWriters).toBe(true);
    expect(view.maintenance.pauseNewLaunches).toBe(true);
    expect(view.cardMessage).toContain("D:");
    expect(view.cardMessage).toContain("writers paused");
  });

  it("ignores a 3 second dip under 5 GB", () => {
    const guard = new DiskHeadroomGuard();
    const low = volume("C:", 4 * GiB);
    const high = volume("C:", 20 * GiB);
    const project = volume("D:", plenty);
    guard.observe({ project, appData: low, nowMs: 0 });
    guard.observe({ project, appData: low, nowMs: 3_000 });
    const view = guard.observe({ project, appData: high, nowMs: 3_000 });
    expect(view.appData.tier).toBe("OK");
    expect(view.maintenance.pauseNewLaunches).toBe(false);
  });

  it("clears a pause after 30s of free space, or instantly on recheck", () => {
    const guard = new DiskHeadroomGuard();
    const project = volume("D:", plenty);
    const low = volume("C:", 4 * GiB);
    const freed = volume("C:", 20 * GiB);
    guard.observe({ project, appData: low, nowMs: 0 });
    guard.observe({ project, appData: low, nowMs: 10_000 });
    expect(guard.view().appData.tier).toBe("PAUSE");

    const timed = new DiskHeadroomGuard();
    timed.observe({ project, appData: low, nowMs: 0 });
    timed.observe({ project, appData: low, nowMs: 10_000 });
    timed.observe({ project, appData: freed, nowMs: 10_000 });
    expect(timed.observe({ project, appData: freed, nowMs: 39_999 }).appData.tier).toBe("PAUSE");
    const recovered = timed.observe({ project, appData: freed, nowMs: 40_000 });
    expect(recovered.appData.tier).toBe("OK");
    expect(recovered.resumeOffered).toBe(true);
    expect(recovered.maintenance.pauseNewLaunches).toBe(false);

    const clicked = guard.recheck({ project, appData: freed, nowMs: 10_500 });
    expect(clicked.appData.tier).toBe("OK");
    expect(clicked.resumeOffered).toBe(true);
    expect(clicked.cardMessage).toBeNull();
    expect(clicked.maintenance.subtleYellowIndicator).toBe(false);
  });
});
