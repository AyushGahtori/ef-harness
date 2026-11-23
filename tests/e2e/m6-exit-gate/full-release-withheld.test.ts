import { describe, expect, it } from "vitest";
import { runGate } from "./run-gate.ts";

describe("full release certification", () => {
  it("withholds live sign-off when only local ports are available", () => {
    const run = runGate(["--profile", "full-release-certification"]);
    expect(run.status).not.toBe(0);
    expect(run.scorecard.decision).toBe("NO-GO");
    expect(run.scorecard.decisionScope).toBe("live-sign-off");
    expect(run.scorecard.liveSignOff).toBe("WITHHELD");
    expect(run.scorecard.productionCertificationClaimed).toBe(false);
    expect(run.scorecard.tagV1Authorized).toBe(false);
    expect(run.scorecard.chaos.seeds).toBe(1000);
    expect(run.scorecard.chaos.violations).toBe(0);
    expect(run.scorecard.chaos.integratedDaemon).toBe(false);
    for (const id of [
      "integration-on-harness",
      "packaging-signed-nsis",
      "latest-yml-sha512",
      "cyclonedx-sbom",
      "authenticode",
      "live-providers",
      "chaos-integrated-daemon",
      "production-age",
      "security-five-pillar",
      "product-milestone-exits",
      "product-suite-execution",
    ]) {
      expect(run.scorecard.liveBlockers).toContain(id);
    }
  }, 60_000);

  it("refuses an unsigned dev installer in the full profile", () => {
    const run = runGate(["--profile", "full-release-certification", "--unsigned-dev"]);
    expect(run.status).not.toBe(0);
    expect(run.scorecard.decision).toBe("NO-GO");
    expect(run.scorecard.tagV1Authorized).toBe(false);
    expect(run.scorecard.failingGateIds).toContain("unsigned-dev-refused");
    expect(run.stderr).toContain("unsigned-dev-refused");
    expect(run.scorecard.banner).toContain("Production certification is not claimed");
  }, 60_000);
});
