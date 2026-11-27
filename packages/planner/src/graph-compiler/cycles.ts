import { findCyclePaths } from "./reachability.js";
import type { DirectedEdge } from "./reachability.js";
import { diagnostic } from "./types.js";
import type { CompilationDiagnostic, CompilationInput } from "./types.js";

function formatCycle(path: readonly string[]): string {
  return path.join(" → ");
}

export function cycleDiagnostics(input: CompilationInput): CompilationDiagnostic[] {
  const diagnostics: CompilationDiagnostic[] = [];
  const taskIds = input.tasks.map((task) => task.id);
  const taskEdges: DirectedEdge[] = [];
  const knownTasks = new Set(taskIds);
  for (const task of input.tasks) {
    for (const dependency of task.dependsOn) {
      if (!knownTasks.has(dependency)) {
        diagnostics.push(
          diagnostic({
            pass: 1,
            code: "dangling_dependency",
            message: `Task ${task.id} depends on missing task ${dependency}.`,
            taskIds: [task.id, dependency],
          }),
        );
        continue;
      }
      taskEdges.push({ from: dependency, to: task.id });
    }
  }
  for (const cycle of findCyclePaths(taskIds, taskEdges)) {
    diagnostics.push(
      diagnostic({
        pass: 1,
        code: "task_cycle",
        message: `Task cycle: ${formatCycle(cycle)}.`,
        taskIds: cycle,
        details: { cycle: cycle.join(" → "), waiverCode: "cycle_check" },
      }),
    );
  }
  const featureIds = input.features.map((feature) => feature.id);
  const knownFeatures = new Set(featureIds);
  const featureEdges: DirectedEdge[] = [];
  for (const feature of input.features) {
    for (const dependency of feature.dependsOn) {
      if (!knownFeatures.has(dependency)) {
        diagnostics.push(
          diagnostic({
            pass: 1,
            code: "dangling_feature_dependency",
            message: `Feature ${feature.id} depends on missing feature ${dependency}.`,
            featureIds: [feature.id, dependency],
          }),
        );
        continue;
      }
      featureEdges.push({ from: dependency, to: feature.id });
    }
  }
  for (const cycle of findCyclePaths(featureIds, featureEdges)) {
    diagnostics.push(
      diagnostic({
        pass: 1,
        code: "feature_cycle",
        message: `Feature cycle: ${formatCycle(cycle)}.`,
        featureIds: cycle,
        details: { cycle: cycle.join(" → "), waiverCode: "cycle_check" },
      }),
    );
  }
  const duplicateTasks = duplicateIds(taskIds);
  for (const id of duplicateTasks) {
    diagnostics.push(
      diagnostic({
        pass: 1,
        code: "duplicate_task_id",
        message: `Task id ${id} is declared more than once.`,
        taskIds: [id],
      }),
    );
  }
  return diagnostics;
}

function duplicateIds(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) duplicates.add(id);
    seen.add(id);
  }
  return [...duplicates].sort((a, b) => a.localeCompare(b));
}
