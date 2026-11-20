import type { MustBandMeasurement } from "./ports.js";
import { diagnostic } from "./types.js";
import type { CompilationDiagnostic, PlanTask } from "./types.js";
import { CLOSED_TOUCHES_TAG_SET, matchedRuleIds } from "./vocabulary.js";

export function tagAndRuleDiagnostics(
  task: PlanTask,
  measurement: MustBandMeasurement,
): CompilationDiagnostic[] {
  const diagnostics: CompilationDiagnostic[] = [];
  for (const tag of task.touches) {
    if (CLOSED_TOUCHES_TAG_SET.has(tag)) continue;
    diagnostics.push(
      diagnostic({
        pass: 6,
        code: "unknown_touch_tag",
        message: `Task ${task.id} touches "${tag}", which is outside the closed 28-tag vocabulary.`,
        taskIds: [task.id],
        details: { tag },
      }),
    );
  }
  const injected = new Set([...task.mustBandRuleIds, ...measurement.ruleIds]);
  for (const ruleId of matchedRuleIds(task.touches)) {
    if (injected.has(ruleId)) continue;
    diagnostics.push(
      diagnostic({
        pass: 6,
        code: "rule_missing_from_must",
        message: `Matched rule ${ruleId} is missing from task ${task.id}'s compiled MUST band.`,
        taskIds: [task.id],
        details: { ruleId },
      }),
    );
  }
  return diagnostics;
}
