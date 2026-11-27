import { diagnostic } from "./types.js";
import type { CompilationDiagnostic, CompilationInput, CompilationWaiver } from "./types.js";
import { NON_WAIVABLE_WAIVER_CODE_SET } from "./vocabulary.js";

export interface WaiverEvaluation {
  readonly diagnostics: readonly CompilationDiagnostic[];
  readonly appliedWaivers: readonly string[];
  readonly suppressedTaskIds: ReadonlySet<string>;
}

function waiverIsAudited(waiver: CompilationWaiver): boolean {
  return (
    waiver.audited &&
    waiver.risk === "low" &&
    waiver.approvedBy.trim() !== "" &&
    waiver.reason.trim() !== "" &&
    waiver.taskId !== null &&
    waiver.taskId.trim() !== ""
  );
}

export class CompilationWaiverGuard {
  evaluate(input: CompilationInput, softWarnings: readonly CompilationDiagnostic[]): WaiverEvaluation {
    const diagnostics: CompilationDiagnostic[] = [];
    for (const waiver of input.waivers) {
      if (NON_WAIVABLE_WAIVER_CODE_SET.has(waiver.code)) {
        diagnostics.push(
          diagnostic({
            pass: 9,
            code: "NON_WAIVABLE_SAFETY_INVARIANT",
            message: `Waiver "${waiver.code}" is rejected as NON_WAIVABLE_SAFETY_INVARIANT. Cycles, parallel write collisions, unresolved contradictions, missing auth/payment/PII sealed checks, and MUST truncation cannot be waived.`,
            taskIds: waiver.taskId ? [waiver.taskId] : [],
            details: { waiverCode: waiver.code },
          }),
        );
        continue;
      }
      if (waiver.code !== "generated_scaffold_file_count") {
        diagnostics.push(
          diagnostic({
            pass: 9,
            code: "waiver_not_permitted",
            message: `Waiver "${waiver.code}" is not an audited low-risk soft warning.`,
            taskIds: waiver.taskId ? [waiver.taskId] : [],
            details: { waiverCode: waiver.code },
          }),
        );
      }
    }
    const suppressed = new Set<string>();
    const applied: string[] = [];
    for (const warning of softWarnings) {
      const taskId = warning.taskIds[0] ?? "";
      const match = input.waivers.find(
        (waiver) =>
          waiver.code === "generated_scaffold_file_count" &&
          waiver.taskId === taskId &&
          waiverIsAudited(waiver),
      );
      if (!match) {
        diagnostics.push(warning);
        continue;
      }
      suppressed.add(taskId);
      applied.push(`${match.code}:${taskId}`);
    }
    return { diagnostics, appliedWaivers: applied, suppressedTaskIds: suppressed };
  }
}

export function scaffoldFileWarnings(input: CompilationInput): CompilationDiagnostic[] {
  const warnings: CompilationDiagnostic[] = [];
  for (const task of input.tasks) {
    if (task.taskKind !== "scaffold" || !task.generatedScaffold) continue;
    if (task.primaryFiles.length !== 6) continue;
    warnings.push(
      diagnostic({
        pass: 9,
        code: "generated_scaffold_file_count",
        message: `Generated scaffold task ${task.id} declares 6 primary files. An audited low-risk waiver can allow this soft warning.`,
        taskIds: [task.id],
        paths: task.primaryFiles,
        details: { fileCount: task.primaryFiles.length },
      }),
    );
  }
  return warnings;
}
