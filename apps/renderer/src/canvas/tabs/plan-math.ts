import type { CrewPreset, PlanSnapshot, PlannedLeaf, PricedLeaf } from "./types.js";
import { higherLevel, normalizeLevel, priceLeaf, raiseLevel, tierChip } from "./format.js";
import type { InteractivePlanEditorPort } from "./ports.js";

export function pricePlan(snapshot: PlanSnapshot, preset: CrewPreset): readonly PricedLeaf[] {
  return snapshot.planned.map((leaf) => priceOne(leaf, preset));
}

function priceOne(leaf: PlannedLeaf, preset: CrewPreset): PricedLeaf {
  const balanced = normalizeLevel(leaf.balancedLevel);
  const floor = normalizeLevel(leaf.safetyFloor);
  let level = higherLevel(balanced, floor);
  if (preset === "Cheapest") level = floor;
  if (preset === "Fastest" && leaf.criticalPath) level = higherLevel(raiseLevel(level), floor);
  const priced = priceLeaf(leaf.juniorCostMicroUsd, leaf.durationMinutes, level);
  return {
    ...leaf,
    level,
    chip: tierChip(level),
    costMicroUsd: priced.costMicroUsd,
    minutes: priced.minutes,
  };
}

export class LocalInteractivePlanEditor implements InteractivePlanEditorPort {
  switchPreset(
    preset: CrewPreset,
    snapshot: PlanSnapshot,
  ): { readonly preset: CrewPreset; readonly leaves: readonly PricedLeaf[]; readonly elapsedMs: number } {
    const start = performance.now();
    const leaves = pricePlan(snapshot, preset);
    return { preset, leaves, elapsedMs: performance.now() - start };
  }
}
