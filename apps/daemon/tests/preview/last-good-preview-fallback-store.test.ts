import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LastGoodPreviewFallbackStore } from "../../src/preview/last-good-preview-fallback-store.js";
import { lastGoodBanner, noLastGoodBanner } from "../../src/preview/preview-partition.js";
import { CRASH_DETECT_MS, HEALTHY_BOOT_WINDOW_MS } from "../../src/preview/timings.js";

function redact(text: string): string {
  const secret = ["sk", "_test_", "canaryvalue"].join("");
  return text.split(secret).join("[REDACTED_SECRET:STRIPE_TEST_KEY]");
}

describe("LastGoodPreviewFallbackStore", () => {
  it("records only a healthy 200 boot inside 5s and restores that sha with redacted stderr", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ef-last-good-"));
    const store = new LastGoodPreviewFallbackStore(dir);
    expect(
      store.recordHealthy({
        projectId: "cafe",
        sha: "abc123",
        httpStatus: 500,
        startupCrashes: 0,
        bootMs: 10,
      }),
    ).toBe(false);
    expect(
      store.recordHealthy({
        projectId: "cafe",
        sha: "abc123",
        httpStatus: 200,
        startupCrashes: 1,
        bootMs: 10,
      }),
    ).toBe(false);
    expect(
      store.recordHealthy({
        projectId: "cafe",
        sha: "abc123",
        httpStatus: 200,
        startupCrashes: 0,
        bootMs: HEALTHY_BOOT_WINDOW_MS + 1,
      }),
    ).toBe(false);
    expect(store.current("cafe")).toBeNull();
    expect(
      store.recordHealthy({
        projectId: "cafe",
        sha: "abc123",
        httpStatus: 200,
        startupCrashes: 0,
        bootMs: 40,
      }),
    ).toBe(true);
    const secret = ["sk", "_test_", "canaryvalue"].join("");
    const plan = store.planFailure({
      projectId: "cafe",
      attemptedSha: "bad999",
      detectedWithinMs: 80,
      stderr: `preview boot crashed ${secret}`,
      reason: "startup_crash",
      redact,
    });
    expect(plan.restoreSha).toBe("abc123");
    expect(plan.banner).toBe(lastGoodBanner("abc123"));
    expect(plan.banner).toBe(
      "Preview build failed on latest commit — Viewing last working build (abc123) · Inspect Error",
    );
    expect(plan.stderrRedacted).toBe("preview boot crashed [REDACTED_SECRET:STRIPE_TEST_KEY]");
    expect(plan.stderrRedacted).not.toContain(secret);
    expect(plan.withinCrashWindow).toBe(true);
    expect(plan.detectedWithinMs).toBeLessThan(CRASH_DETECT_MS);
    expect(plan.actions).toEqual(["inspect_error", "send_error_to_fix"]);
    const reloaded = new LastGoodPreviewFallbackStore(dir);
    expect(reloaded.current("cafe")?.lastGoodPreviewCommitSha).toBe("abc123");
    const slow = reloaded.planFailure({
      projectId: "cafe",
      attemptedSha: "bad999",
      detectedWithinMs: 20_000,
      stderr: "timed out",
      reason: "health_timeout",
      redact,
    });
    expect(slow.withinCrashWindow).toBe(false);
    expect(slow.reason).toBe("health_timeout");
    const missing = new LastGoodPreviewFallbackStore(path.join(dir, "empty"));
    expect(
      missing.planFailure({
        projectId: "cafe",
        attemptedSha: "bad999",
        detectedWithinMs: 10,
        stderr: "boom",
        reason: "exit_nonzero",
        redact,
      }).banner,
    ).toBe(noLastGoodBanner());
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
