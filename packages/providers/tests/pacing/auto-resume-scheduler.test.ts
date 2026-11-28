import { describe, expect, it } from "vitest";
import {
  AUTO_RESUME_JITTER_MS,
  AutoResumeScheduler,
  DISK_HEADROOM_MIN_BYTES,
} from "../../src/pacing/index.js";
import type { ResumePreflightPort } from "../../src/pacing/index.js";

function preflight(patch: Partial<ResumePreflightPort> & { freeBytes?: number } = {}): ResumePreflightPort {
  const freeBytes = patch.freeBytes ?? DISK_HEADROOM_MIN_BYTES;
  return {
    connectionHealthy: () => true,
    pendingConflicts: () => 0,
    pendingHolds: () => 0,
    diskFreeBytes: () => freeBytes,
    ...patch,
    diskFreeBytes: () => freeBytes,
  };
}

describe("pacing opt-in auto-resume scheduler", () => {
  const resetAt = Date.UTC(2026, 10, 22, 19, 30, 0);

  it("stays off unless the developer opts in", () => {
    const scheduler = new AutoResumeScheduler();
    expect(scheduler.optedIn).toBe(false);
    expect(scheduler.arm(resetAt)).toBeNull();
    const decision = scheduler.evaluate(resetAt + AUTO_RESUME_JITTER_MS, preflight(), "chatgpt-plus");
    expect(decision.action).toBe("idle");
    expect(decision.reason).toBe("opt_in_off");
    expect(decision.cwnd).toBeNull();
  });

  it("wakes at reset_at + 15s and restarts only after preflight is clear", () => {
    const scheduler = new AutoResumeScheduler();
    scheduler.setOptIn(true);
    expect(scheduler.arm(resetAt)).toBe(resetAt + 15_000);
    const early = scheduler.evaluate(resetAt + 14_000, preflight(), "chatgpt-plus");
    expect(early.action).toBe("waiting");
    const ready = scheduler.evaluate(resetAt + AUTO_RESUME_JITTER_MS, preflight(), "chatgpt-plus");
    expect(ready.action).toBe("resume");
    expect(ready.cwnd).toBe(2);
    expect(ready.diskCard).toBeNull();
  });

  it("keeps the build parked on a disk headroom block instead of launching", () => {
    const scheduler = new AutoResumeScheduler();
    scheduler.setOptIn(true);
    scheduler.arm(resetAt);
    const decision = scheduler.evaluate(
      Date.UTC(2026, 10, 22, 19, 30, 15),
      preflight({ freeBytes: DISK_HEADROOM_MIN_BYTES - 1 }),
      "chatgpt-plus",
    );
    expect(decision.action).toBe("stay_parked");
    expect(decision.reason).toBe("disk_headroom");
    expect(decision.cwnd).toBeNull();
    expect(decision.diskCard?.requiredBytes).toBe(DISK_HEADROOM_MIN_BYTES);
    expect(decision.diskCard?.message).toContain("5 GB");
  });

  it("stays parked when the connection is unhealthy or a hold is pending", () => {
    const unhealthy = new AutoResumeScheduler();
    unhealthy.setOptIn(true);
    unhealthy.arm(resetAt);
    expect(
      unhealthy.evaluate(
        resetAt + 15_000,
        preflight({ connectionHealthy: () => false }),
        "chatgpt-plus",
      ).reason,
    ).toBe("connection_unhealthy");
    const held = new AutoResumeScheduler();
    held.setOptIn(true);
    held.arm(resetAt);
    expect(
      held.evaluate(resetAt + 15_000, preflight({ pendingHolds: () => 1 }), "chatgpt-plus").reason,
    ).toBe("pending_conflict_or_hold");
  });
});
