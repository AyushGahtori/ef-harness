import { describe, expect, it } from "vitest";
import { createTierAMxcProvider, probeMxcAvailability, runTierALiveRedTeam } from "../../src/tier-a-mxc/index.js";
import { createMemoryAuditLog, createMemoryGovernor, createMemoryJobManager } from "../../src/tier-a-mxc/index.js";
import { readyAvailability, testKernel } from "./fixture.js";

describe("Tier A live red team", () => {
  it("reports skipped_env_no_mxc when the build gate fails", async () => {
    const report = await runTierALiveRedTeam({
      availability: readyAvailability({
        available: false,
        osBuild: "19045.3803",
        reason: "os_build_too_old",
        policyBasedGrants: false,
        buildEligible: false,
        launchable: false,
        launchBlocker: "os_build_too_old",
      }),
    });
    expect(report.status).toBe("skipped_env_no_mxc");
    expect(report.reason).toBe("skipped_env_no_mxc");
    expect(report.claimedOsEnforcement).toBe(false);
    expect(report.probes.map((probe) => probe.testId)).toEqual([
      "read_ssh_canary",
      "write_outside_worktree",
      "write_git_head",
      "raw_external_tcp",
    ]);
    expect(report.probes.every((probe) => probe.executed === false && probe.actuallyBlocked === false)).toBe(true);
  });

  it("does not treat a test double as OS enforcement", async () => {
    const provider = createTierAMxcProvider({
      jobManager: createMemoryJobManager(),
      logger: createMemoryAuditLog(),
      governor: createMemoryGovernor(),
      allowTestKernel: true,
      kernel: testKernel(async () => ({ launched: true, pid: 1, exitCode: 0, stdout: "", stderr: "", denied: [] })),
    });
    const report = await runTierALiveRedTeam({
      availability: readyAvailability({ helperPresent: true, launchable: true, launchBlocker: null }),
      provider,
    });
    expect(report.status).toBe("not_run");
    expect(report.reason).toBe("test_double");
    expect(report.claimedOsEnforcement).toBe(false);
  });

  it("reports the host honestly when MXC cannot be launched", async () => {
    const availability = await probeMxcAvailability();
    const report = await runTierALiveRedTeam({ availability });
    if (!availability.available) {
      expect(report.status).toBe("skipped_env_no_mxc");
      expect(report.claimedOsEnforcement).toBe(false);
      return;
    }
    if (!availability.launchable) {
      expect(report.status).toBe("not_run");
      expect(report.claimedOsEnforcement).toBe(false);
      expect(report.reason).toBe(availability.launchBlocker);
      expect(report.probes.every((probe) => probe.actuallyBlocked === false)).toBe(true);
      return;
    }
    expect(report.claimedOsEnforcement).toBe(true);
    expect(report.status).toBe("executed");
    expect(report.probes.every((probe) => probe.actuallyBlocked)).toBe(true);
  }, 60_000);
});
