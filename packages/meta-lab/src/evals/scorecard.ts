import type { PromotionDecision, PromotionDecisionInput } from "./types.js";

export interface PromotionScorecard {
  readonly markdown: string;
  readonly json: Record<string, unknown>;
}

export function buildPromotionScorecard(
  input: PromotionDecisionInput,
  decision: PromotionDecision,
): PromotionScorecard {
  const json = {
    baselineVersion: input.baselineVersion,
    candidateVersion: input.candidateVersion,
    evalRunId: input.evalRunId,
    verdict: decision.verdict,
    reason: decision.reason,
    discordant: { b: decision.mcnemar.b, c: decision.mcnemar.c },
    mcnemarExactP: decision.mcnemar.exactPValue,
    bootstrap: {
      resamples: decision.bootstrap.resamples,
      seed: decision.bootstrap.seed,
      tokenCostSavingsCi: decision.bootstrap.tokenCostSavingsCi,
      wallClockSavingsCi: decision.bootstrap.wallClockSavingsCi,
    },
    securityVerdict: decision.vetoesTriggered.length === 0 ? "PASS" : "FAIL",
    vetoes: decision.vetoesTriggered,
  };

  const md = [
    `# Meta-Lab Promotion Scorecard`,
    ``,
    `| Field | Value |`,
    `|---|---|`,
    `| Baseline | ${input.baselineVersion} |`,
    `| Candidate | ${input.candidateVersion} |`,
    `| Discordant pairs | b=${decision.mcnemar.b}, c=${decision.mcnemar.c} |`,
    `| McNemar exact p | ${decision.mcnemar.exactPValue} |`,
    `| Token savings 95% CI | [${decision.bootstrap.tokenCostSavingsCi.lower}, ${decision.bootstrap.tokenCostSavingsCi.upper}] |`,
    `| Wall-clock savings 95% CI | [${decision.bootstrap.wallClockSavingsCi.lower}, ${decision.bootstrap.wallClockSavingsCi.upper}] |`,
    `| Security | ${json.securityVerdict} |`,
    `| **Recommendation** | **${decision.verdict}** |`,
    ``,
    decision.reason,
  ].join("\n");

  return { markdown: md, json };
}