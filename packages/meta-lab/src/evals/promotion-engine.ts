import {
  EFFICIENCY_SAVINGS_THRESHOLD,
  MC_NEMAR_ALPHA,
  McNemarAndBootstrapCalculator,
  PAPERWORK_BUDGET_MAX,
  passesEfficiencyTieRule,
} from "./mcnemar-bootstrap.js";
import type { PromotionDecision, PromotionDecisionInput, PromotionExitCode, PromotionVerdict } from "./types.js";

function collectVetoes(vetoes: PromotionDecisionInput["vetoes"]): string[] {
  const triggered: string[] = [];
  if ((vetoes.redTeamFailures ?? 0) > 0) triggered.push("RedTeamRegressionBlock");
  if ((vetoes.contaminationFlags ?? 0) > 0) triggered.push("BenchmarkContaminationError");
  if ((vetoes.schemaViolations ?? 0) > 0) triggered.push("SchemaViolationBlock");
  if ((vetoes.paperworkPct ?? 0) > PAPERWORK_BUDGET_MAX) triggered.push("PaperworkBudgetBreach");
  return triggered;
}

function toExitCode(verdict: PromotionVerdict): PromotionExitCode {
  if (verdict === "PROMOTE") return 0;
  if (verdict === "NEED_MORE_SAMPLES") return 2;
  return 1;
}

export class PairedStatisticalPromotionEngine {
  private readonly calculator = new McNemarAndBootstrapCalculator();

  decide(input: PromotionDecisionInput): PromotionDecision {
    const vetoesTriggered = collectVetoes(input.vetoes);
    const mcnemar = this.calculator.computeMcNemar(input.cases);
    const bootstrap = this.calculator.computeBootstrap(input.cases, input.evalRunId);

    if (vetoesTriggered.length > 0) {
      return {
        verdict: "REJECT",
        exitCode: 1,
        reason: vetoesTriggered.join("; "),
        mcnemar,
        bootstrap,
        vetoesTriggered,
      };
    }

    const qualityWin = mcnemar.b > mcnemar.c && mcnemar.exactPValue < MC_NEMAR_ALPHA;
    if (qualityWin) {
      return {
        verdict: "PROMOTE",
        exitCode: 0,
        reason: `Quality Win: McNemar exact p = ${mcnemar.exactPValue}`,
        mcnemar,
        bootstrap,
        vetoesTriggered,
      };
    }

    const efficiencyWin =
      mcnemar.b === 0 &&
      mcnemar.c === 0 &&
      passesEfficiencyTieRule(mcnemar, bootstrap);
    if (efficiencyWin) {
      const ci = bootstrap.tokenCostSavingsCi.lower >= EFFICIENCY_SAVINGS_THRESHOLD
        ? bootstrap.tokenCostSavingsCi
        : bootstrap.wallClockSavingsCi;
      const pct = Math.round(((ci.lower + ci.upper) / 2) * 100);
      return {
        verdict: "PROMOTE",
        exitCode: 0,
        reason: `Efficiency Win: ~${pct}% savings, 0 quality loss (95% CI lower >= 15%)`,
        mcnemar,
        bootstrap,
        vetoesTriggered,
      };
    }

    const noisyEfficiencyAttempt =
      mcnemar.c === 0 &&
      mcnemar.b === 0 &&
      !passesEfficiencyTieRule(mcnemar, bootstrap) &&
      (bootstrap.tokenCostSavingsCi.lower < EFFICIENCY_SAVINGS_THRESHOLD ||
        bootstrap.tokenCostSavingsCi.upper > 0.31);
    if (noisyEfficiencyAttempt && mcnemar.discordantTotal === 0) {
      return {
        verdict: "REJECT",
        exitCode: 1,
        reason: "95% CI crosses below 15% efficiency threshold",
        mcnemar,
        bootstrap,
        vetoesTriggered,
      };
    }

    if (mcnemar.b === mcnemar.c && mcnemar.discordantTotal > 0) {
      return {
        verdict: "REJECT",
        exitCode: 1,
        reason: "REJECT (no significant improvement)",
        mcnemar,
        bootstrap,
        vetoesTriggered,
      };
    }

    if (
      mcnemar.exactPValue >= MC_NEMAR_ALPHA &&
      mcnemar.b > mcnemar.c &&
      mcnemar.discordantTotal > 0
    ) {
      return {
        verdict: "NEED_MORE_SAMPLES",
        exitCode: 2,
        reason: `Insufficient power: McNemar exact p = ${mcnemar.exactPValue} >= 0.05`,
        mcnemar,
        bootstrap,
        vetoesTriggered,
      };
    }

    return {
      verdict: "REJECT",
      exitCode: toExitCode("REJECT"),
      reason: "No promotion criteria met",
      mcnemar,
      bootstrap,
      vetoesTriggered,
    };
  }
}