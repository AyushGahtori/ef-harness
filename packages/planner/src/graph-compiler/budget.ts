import type { BudgetLedgerPort } from "./ports.js";
import { diagnostic } from "./types.js";
import type { CompilationDiagnostic, CompilationInput } from "./types.js";

export function budgetDiagnostics(
  input: CompilationInput,
  ledger: BudgetLedgerPort,
): CompilationDiagnostic[] {
  const fromLedger = ledger.remaining(input);
  const remainingWave = Math.min(input.budget.remainingWaveMicroUsd, fromLedger.remainingWaveMicroUsd);
  const remainingProject = Math.min(
    input.budget.remainingProjectMicroUsd,
    fromLedger.remainingProjectMicroUsd,
  );
  const projected = input.tasks.reduce((sum, task) => sum + task.estimatedMinCostMicroUsd, 0);
  if (projected <= remainingWave && projected <= remainingProject) return [];
  return [
    diagnostic({
      pass: 8,
      code: "budget_shortfall",
      message: `Projected minimum wave cost ${projected} micro-USD exceeds remaining wave budget ${remainingWave} micro-USD or project budget ${remainingProject} micro-USD.`,
      details: {
        projectedMicroUsd: projected,
        remainingWaveMicroUsd: remainingWave,
        remainingProjectMicroUsd: remainingProject,
      },
    }),
  ];
}
