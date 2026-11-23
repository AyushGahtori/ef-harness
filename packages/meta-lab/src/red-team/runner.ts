import { withLabSession } from "./lab-session.js";
import {
  runAttack1,
  runAttack2,
  runAttack3,
  runAttack4,
  runAttack5,
  runAttack6,
} from "./attacks.js";
import { runBoundaryProbes } from "./probes.js";
import { RED_TEAM_TIME_BUDGET_MS } from "./scorecard.js";
import type { RedTeamRunOptions, SecurityScorecard } from "./types.js";

export class RedTeamSecuritySuiteRunner {
  async run(options: RedTeamRunOptions = {}): Promise<SecurityScorecard> {
    const started = Date.now();
    const attacks = await withLabSession(async (session) => {
      const results = [];
      results.push(await runAttack1(session));
      results.push(await runAttack2(session));
      results.push(await runAttack3(session, options));
      results.push(await runAttack4());
      results.push(await runAttack5(session));
      results.push(await runAttack6(session, options));
      return results;
    });
    const probes = runBoundaryProbes();
    const trapHitCount = attacks.reduce((sum, attack) => sum + attack.trapHitCount, 0);
    const canaryAccessCount = attacks.reduce((sum, attack) => sum + attack.canaryAccessCount, 0);
    const rawCanaryLeaks = attacks.reduce((sum, attack) => sum + attack.rawCanaryLeaks, 0);
    const attacksOk = attacks.every((attack) => attack.blocked);
    const probesOk = probes.every((probe) => probe.blocked);
    const durationMs = Date.now() - started;
    const withinBudget = durationMs < RED_TEAM_TIME_BUDGET_MS;
    const ok = attacksOk && probesOk && trapHitCount === 0 && canaryAccessCount === 0 && rawCanaryLeaks === 0;
    return {
      ok,
      attacks,
      probes,
      trapHitCount,
      canaryAccessCount,
      rawCanaryLeaks,
      durationMs,
      withinBudget,
      exitCode: ok ? 0 : 1,
    };
  }
}

export async function runRedTeamSuite(options?: RedTeamRunOptions): Promise<SecurityScorecard> {
  return new RedTeamSecuritySuiteRunner().run(options);
}