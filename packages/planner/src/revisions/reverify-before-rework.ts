import type { CheckFailure, LinkedCheck, ReverifyDecision } from "./types.js";

/**
 * Already-merged code is checked against the updated checks before any rework
 * task is created. This gate never spawns work.
 */
export class ReverifyBeforeReworkGate {
  evaluate(taskId: string, satisfied: ReadonlySet<string>, checks: readonly LinkedCheck[]): ReverifyDecision {
    const failingChecks: CheckFailure[] = [];
    for (const check of checks) {
      if (satisfied.has(check.id)) continue;
      failingChecks.push({
        checkId: check.id,
        title: check.title,
        expected: check.text,
        actual: "merged code does not satisfy this check",
      });
    }
    if (failingChecks.length === 0) {
      return { taskId, outcome: "verified_under_rev", failingChecks: [] };
    }
    return { taskId, outcome: "rework_required", failingChecks };
  }
}
