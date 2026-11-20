import { intersectRanges } from "./semver.js";
import type { DependencyIntent, DependencyReconciliation } from "./types.js";

/**
 * Merge concurrent dependency intents. Compatible ranges become one update.
 * Incompatible ranges are returned to the integrator with both task ids and reasons.
 */
export function reconcileDependencyIntents(intents: readonly DependencyIntent[]): DependencyReconciliation {
  const groups = new Map<string, DependencyIntent[]>();
  for (const intent of intents) {
    const existing = groups.get(intent.packageName);
    if (existing) existing.push(intent);
    else groups.set(intent.packageName, [intent]);
  }
  const names = [...groups.keys()].sort((left, right) => left.localeCompare(right));
  const updates: DependencyReconciliation["updates"][number][] = [];
  const conflicts: DependencyReconciliation["conflicts"][number][] = [];
  for (const name of names) {
    const group = groups.get(name) ?? [];
    const first = group[0];
    if (!first) continue;
    let merged: string | null = first.range;
    for (const intent of group.slice(1)) {
      if (merged === null) break;
      merged = intersectRanges(merged, intent.range);
    }
    if (merged === null) {
      conflicts.push({
        packageName: name,
        ranges: group.map((intent) => ({
          taskId: intent.taskId,
          range: intent.range,
          reason: intent.reason,
        })),
      });
      continue;
    }
    updates.push({
      packageName: name,
      range: merged,
      taskIds: group.map((intent) => intent.taskId),
      reasons: group.map((intent) => intent.reason),
    });
  }
  return { updates, conflicts };
}
