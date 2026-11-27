import type { MustBandMeasurement, OversizedMustAutoSplitGuard } from "./ports.js";
import { mustCeiling } from "./ports.js";
import { OversizedMustTaskError } from "./ports.js";
import { diagnostic } from "./types.js";
import type { CompilationDiagnostic, PlanTask } from "./types.js";

export function taskSizeDiagnostics(
  task: PlanTask,
  measurement: MustBandMeasurement,
  guard: OversizedMustAutoSplitGuard,
): CompilationDiagnostic[] {
  const diagnostics: CompilationDiagnostic[] = [];
  if (task.taskKind === "leaf" && task.primaryFiles.length > 5) {
    diagnostics.push(
      diagnostic({
        pass: 4,
        code: "leaf_file_bound",
        message: `Leaf task ${task.id} declares ${task.primaryFiles.length} primary files; the bound is 5.`,
        taskIds: [task.id],
        paths: task.primaryFiles,
        details: { fileCount: task.primaryFiles.length },
      }),
    );
  }
  if (task.taskKind === "scaffold" && task.primaryFiles.length > 6) {
    diagnostics.push(
      diagnostic({
        pass: 4,
        code: "scaffold_file_bound",
        message: `Scaffold task ${task.id} declares ${task.primaryFiles.length} primary files. Only an audited waiver covers exactly 6 generated files.`,
        taskIds: [task.id],
        paths: task.primaryFiles,
        details: { fileCount: task.primaryFiles.length },
      }),
    );
  }
  if (task.taskKind === "leaf" && task.responsibilities.length !== 1) {
    diagnostics.push(
      diagnostic({
        pass: 4,
        code: "leaf_responsibility_bound",
        message: `Leaf task ${task.id} declares ${task.responsibilities.length} responsibilities; a leaf has exactly one cohesive responsibility.`,
        taskIds: [task.id],
        details: { responsibilities: task.responsibilities.length },
      }),
    );
  }
  const ceiling = mustCeiling(measurement.level);
  const guarded = guard.assertFits(measurement);
  const overflow =
    guarded ??
    (measurement.tokens > ceiling
      ? new OversizedMustTaskError(
          measurement.taskId,
          measurement.level,
          measurement.tokens,
          ceiling,
          measurement.attribution,
          measurement.level === "junior" && measurement.tokens <= 6_000
            ? "split_or_promote_senior"
            : "split",
        )
      : null);
  if (overflow) {
    diagnostics.push(
      diagnostic({
        pass: 4,
        code: "oversized_must",
        message: overflow.message,
        taskIds: [task.id],
        details: {
          errorName: overflow.name,
          mustTokens: overflow.mustTokens,
          ceiling: overflow.ceiling,
          recommendation: overflow.recommendation,
          attribution: overflow.attribution,
        },
      }),
    );
  }
  return diagnostics;
}
