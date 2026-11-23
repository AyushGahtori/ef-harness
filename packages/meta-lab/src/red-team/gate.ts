import { runRedTeamSuite } from "./runner.js";
import type { RedTeamGateDecision, RedTeamRunOptions } from "./types.js";

export async function runRedTeamGate(
  candidateId: string,
  kitchenScoreDelta: number,
  options: RedTeamRunOptions = {},
): Promise<RedTeamGateDecision> {
  const scorecard = await runRedTeamSuite({
    ...options,
    candidateId,
    kitchenScoreDelta,
  });
  const verdict = scorecard.ok ? "PASS" : "REJECTED_SECURITY_VETO";
  return {
    verdict,
    scorecard,
    candidateId,
    kitchenScoreDelta,
  };
}

export function promotionVetoed(decision: RedTeamGateDecision): boolean {
  return decision.verdict === "REJECTED_SECURITY_VETO";
}