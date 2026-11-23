import { describe, expect, it } from "vitest";
import {
  ATTACK_IDS,
  PROBE_IDS,
  formatScorecardJson,
  formatScorecardMarkdown,
  promotionVetoed,
  runRedTeamGate,
  runRedTeamSuite,
  withLabSession,
  RED_TEAM_TIME_BUDGET_MS,
} from "../../src/red-team/index.js";

describe("red-team security suite", () => {
  it("blocks all six attack vectors and boundary probes", async () => {
    const scorecard = await runRedTeamSuite();
    expect(scorecard.ok).toBe(true);
    expect(scorecard.exitCode).toBe(0);
    expect(scorecard.trapHitCount).toBe(0);
    expect(scorecard.canaryAccessCount).toBe(0);
    expect(scorecard.rawCanaryLeaks).toBe(0);
    expect(scorecard.attacks).toHaveLength(ATTACK_IDS.length);
    expect(scorecard.probes).toHaveLength(PROBE_IDS.length);
    expect(scorecard.attacks.every((attack) => attack.blocked)).toBe(true);
    expect(scorecard.probes.every((probe) => probe.blocked)).toBe(true);
    expect(scorecard.withinBudget).toBe(true);
    expect(scorecard.durationMs).toBeLessThan(RED_TEAM_TIME_BUDGET_MS);
    expect(formatScorecardJson(scorecard)).toContain('"ok": true');
    expect(formatScorecardMarkdown(scorecard)).toContain("Meta-Lab Red-Team Scorecard");
  });

  it("keeps rogue agents blocked by sandbox and loopback proxy", async () => {
    await withLabSession(async (session) => {
      const read = session.attemptDirectRead(session.profile.canaryPath("canary"));
      const http = session.attemptDirectRequest(`http://127.0.0.1:${session.trap.port}/exfil`);
      expect(read.blocked).toBe(true);
      expect(http.blocked).toBe(true);
      expect(session.trap.hitCount).toBe(0);
      expect(session.profile.accessCount).toBe(0);
    });
  });

  it("vetoes a simulated vulnerable candidate via runRedTeamGate", async () => {
    const pass = await runRedTeamGate("baseline", 0.05);
    expect(pass.verdict).toBe("PASS");
    expect(promotionVetoed(pass)).toBe(false);

    const leak = await runRedTeamGate("leaky-candidate", 0.12, { leakUnauthorizedSinks: true });
    expect(leak.verdict).toBe("REJECTED_SECURITY_VETO");
    expect(promotionVetoed(leak)).toBe(true);

    const scripts = await runRedTeamGate("scripts-on", 0.08, {
      ignoreScripts: false,
      allowBuilds: ["hostile-fixture"],
    });
    expect(scripts.verdict).toBe("REJECTED_SECURITY_VETO");
  });
});