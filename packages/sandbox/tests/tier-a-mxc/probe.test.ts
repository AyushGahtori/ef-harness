import { performance } from "node:perf_hooks";
import { describe, expect, it } from "vitest";
import { isMxcBuildEligible, probeMxcAvailability } from "../../src/tier-a-mxc/index.js";

describe("probeMxcAvailability", () => {
  it("parses the Tier A build gate", async () => {
    const tooOld = await probeMxcAvailability({
      osBuild: "26100.9277",
      platform: "win32",
      windowsProduct: "windows_11",
      parseOnly: true,
    });
    const ready24 = await probeMxcAvailability({
      osBuild: "26100.9278",
      platform: "win32",
      windowsProduct: "windows_11",
      parseOnly: true,
    });
    const ready25 = await probeMxcAvailability({
      osBuild: "26200.9278",
      platform: "win32",
      windowsProduct: "windows_11",
      parseOnly: true,
    });
    const windows10 = await probeMxcAvailability({
      osBuild: "19045.3803",
      platform: "win32",
      windowsProduct: "windows_10",
      parseOnly: true,
    });
    expect(tooOld.available).toBe(false);
    expect(tooOld.reason).toBe("os_build_too_old");
    expect(tooOld.policyBasedGrants).toBe(false);
    expect(ready24.available).toBe(true);
    expect(ready24.policyBasedGrants).toBe(true);
    expect(ready24.reason).toBeNull();
    expect(ready25.available).toBe(true);
    expect(windows10.available).toBe(false);
    expect(windows10.reason).toBe("os_build_too_old");
    expect(isMxcBuildEligible(26100, 9277)).toBe(false);
    expect(isMxcBuildEligible(26100, 9278)).toBe(true);
    expect(isMxcBuildEligible(26200, 9278)).toBe(true);
    expect(isMxcBuildEligible(26200, 9277)).toBe(false);
    expect(isMxcBuildEligible(19045, 3803)).toBe(false);
  });

  it("returns os_build_too_old in under 5ms without a runtime probe", async () => {
    const started = performance.now();
    const result = await probeMxcAvailability({
      osBuild: "10.0.19045.3803",
      platform: "win32",
      windowsProduct: "windows_10",
    });
    const elapsed = performance.now() - started;
    expect(result).toMatchObject({ available: false, reason: "os_build_too_old", osBuild: "19045.3803" });
    expect(elapsed).toBeLessThan(5);
  });

  it("stays unavailable off Windows and when the pinned helper is missing", async () => {
    const linux = await probeMxcAvailability({ osBuild: "6.8.0", platform: "linux", parseOnly: true });
    expect(linux.available).toBe(false);
    expect(linux.reason).toBe("not_windows");
    const blocked = await probeMxcAvailability({
      osBuild: "26200.9974",
      platform: "win32",
      windowsProduct: "windows_11",
      runtime: { exportPresent: true },
      helperPresent: false,
    });
    expect(blocked.available).toBe(true);
    expect(blocked.buildEligible).toBe(true);
    expect(blocked.policyBasedGrants).toBe(true);
    expect(blocked.launchable).toBe(false);
    expect(blocked.launchBlocker).toBe("mxc_requires_pinned_helper");
  });

  it("reports the live host without claiming a helper that is not linked", async () => {
    const live = await probeMxcAvailability();
    expect(live.osBuild).toMatch(/^\d+\.\d+$/);
    if (!live.buildEligible) {
      expect(live.available).toBe(false);
      expect(live.reason).toBe("os_build_too_old");
      return;
    }
    expect(live.available).toBe(true);
    expect(live.policyBasedGrants).toBe(true);
    if (!live.launchable) {
      expect(["mxc_requires_pinned_helper", "mxc_runtime_export_missing"]).toContain(live.launchBlocker);
    }
  }, 30_000);
});
