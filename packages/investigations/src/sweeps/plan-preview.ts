import type { SweepPlannerPlan, SweepPlanPreview } from "./types.js";

export function buildSweepPlanPreview(
  title: string,
  plan: SweepPlannerPlan,
  options?: { readonly persistedTable?: string },
): SweepPlanPreview {
  const codemodFiles = Math.max(0, plan.tailPaths.length === 0 ? estimateMechanicalFiles(plan) : estimateMechanicalFiles(plan));
  const totalFiles = codemodFiles + plan.tailPaths.length;
  const persistedNotes = [...plan.persistedNamesKept];
  if (options?.persistedTable) {
    persistedNotes.push(`Persisted DB table '${options.persistedTable}' kept unchanged`);
  }
  const summaryLine = [
    `${title}: ${totalFiles} files`,
    `(${codemodFiles} via ts-morph codemod, ${plan.tailPaths.length} manual edge files)`,
    persistedNotes.length > 0 ? `· ${persistedNotes.join(" · ")}` : "",
  ]
    .filter(Boolean)
    .join(" ");
  return {
    title,
    totalFiles,
    codemodFiles,
    manualEdgeFiles: plan.tailPaths.length,
    persistedNotes,
    summaryLine,
  };
}

export function requiresApproval(preview: SweepPlanPreview, hasPersistedRisk: boolean): boolean {
  return preview.totalFiles > 10 || hasPersistedRisk;
}

function estimateMechanicalFiles(plan: SweepPlannerPlan): number {
  if (plan.mechanicalSteps.length === 0) return 0;
  const scopes = plan.mechanicalSteps.flatMap((step) => step.scopeGlobs.filter((g) => !g.startsWith("rename:")));
  return scopes.length > 0 ? Math.max(scopes.length * 10, 1) : 40;
}