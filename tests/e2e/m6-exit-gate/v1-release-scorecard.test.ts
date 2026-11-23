import { describe, expect, it } from "vitest";
import { runGate } from "./run-gate.ts";

describe("ci-replay release scorecard", () => {
  const first = runGate(["--profile", "ci-replay"]);
  const second = runGate(["--profile", "ci-replay"]);

  it("emits a bit-consistent GO that is not a live sign-off", () => {
    expect(first.status).toBe(0);
    expect(first.jsonText).toBe(second.jsonText);
    expect(first.markdownText).toBe(second.markdownText);
    expect(first.scorecard.decision).toBe("GO");
    expect(first.scorecard.decisionScope).toBe("ci-replay");
    expect(first.scorecard.liveSignOff).toBe("WITHHELD");
    expect(first.scorecard.productionCertificationClaimed).toBe(false);
    expect(first.scorecard.tagV1Authorized).toBe(false);
    expect(first.scorecard.failingGateIds).toEqual([]);
    expect(first.scorecard.banner).toContain("not a production certification");
    expect(first.scorecard.integrity.algorithm).toBe("sha256");
    expect(first.scorecard.integrity.productionSignature).toBeNull();
    expect(first.scorecard.integrity.contentSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("passes the seven suite bars as local-port evidence", () => {
    expect(first.scorecard.suites.map((suite) => suite.id)).toEqual([
      "suite:kitchen-web",
      "suite:resume-changer-brownfield",
      "suite:expense-cli",
      "suite:booking-api",
      "suite:ten-bug-set",
      "suite:sweep-set",
      "suite:red-team-security",
    ]);
    for (const suite of first.scorecard.suites) {
      expect(suite.verdict).toBe("PASS");
      expect(suite.productExecuted).toBe(false);
      expect(suite.evidenceClass).toBe("local-port-fixture");
    }
    const manifest = first.scorecard.gates
      .find((gate) => gate.id === "suite:resume-changer-brownfield");
    expect(manifest?.verdict).toBe("PASS");
  });

  it("records executed ship, portability, broker, chaos, and hygiene evidence", () => {
    expect(first.scorecard.ship.phases).toEqual([
      "REHEARSE",
      "BACKUP",
      "EXPAND",
      "APP_DEPLOY",
      "BACKFILL",
      "CONTRACT",
    ]);
    expect(first.scorecard.ship.stagingRollbackOnFailedSmoke).toBe("automatic");
    expect(first.scorecard.ship.productionRollbackOnFailedSmoke).toBe("offered");
    expect(first.scorecard.ship.dockerArgvHasEnvSecret).toBe(false);
    expect(first.scorecard.ship.hosts).toEqual(["vercel-local-port", "docker-ssh-local-port"]);
    expect(first.scorecard.portability.productionAgeFormat).toBe(false);
    expect(first.scorecard.portability.cipher).toBe("local-port-x25519-aes-gcm-v1");
    expect(first.scorecard.portability.canonicalGraphMatch).toBe(true);
    expect(first.scorecard.portability.plaintextInGit).toBe(false);
    expect(first.scorecard.portability.laptopBInitialMode).toBe("read-only");
    expect(first.scorecard.portability.takeoverEpoch).toBe(5);
    expect(first.scorecard.portability.staleLaptopAMode).toBe("fenced");
    expect(first.scorecard.portability.staleForceWithLeaseRejected).toBe(true);
    expect(first.scorecard.portability.blindForcePushUsed).toBe(false);
    expect(first.scorecard.portability.lostKeyKnowledgePreserved).toBe(true);
    expect(first.scorecard.portability.lostKeyDecryptFailed).toBe(true);
    expect(first.scorecard.portability.oracleRegenerated).toBe(true);
    expect(first.scorecard.portability.publicPushDefault).toBe("off");
    expect(first.scorecard.portability.zipSlipRejected).toBe(true);
    expect(first.scorecard.broker.shares).toEqual({ interactive: 8, foreground: 4, background: 2 });
    expect(first.scorecard.broker.starved).toBe(false);
    expect(first.scorecard.broker.reservedInteractiveSlot).toBe(true);
    expect(first.scorecard.chaos.seeds).toBe(50);
    expect(first.scorecard.chaos.violations).toBe(0);
    expect(first.scorecard.chaos.integratedDaemon).toBe(false);
    expect(first.scorecard.hygiene).toEqual({ leakedPids: 0, unexpectedLeftovers: 0, tempRemoved: true });
    expect(first.scorecard.integration.unaccounted).toEqual([]);
    expect(first.scorecard.liveBlockers.length).toBeGreaterThan(0);
    expect(first.scorecard.artifacts.installerPresent).toBe(false);
    expect(first.scorecard.artifacts.authenticode).toBe(false);
    expect(first.scorecard.artifacts.cyclonedxSbomSha256).toBeNull();
  });
});
