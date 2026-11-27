import { SchedulerError } from "./errors.js";
import { descendantBits, indexGraph, isPureChain, reaches } from "./graph.js";
import type { IndexedGraph } from "./graph.js";
import {
  BALANCED_PRESET_CAP,
  CHEAPEST_PRESET_CAP,
  SEQUENTIAL_CHAIN_REASON,
  coerceCrewPreset,
  coerceGovernorPressure,
  type BindingConstraint,
  type CrewPreset,
  type CrewPresetInput,
  type GovernorPressure,
  type GovernorPressureInput,
  type ParallelismDecision,
  type ParallelismInput,
  type ScheduleGraph,
} from "./types.js";
import { writeScopesOverlap } from "./write-scope.js";

export interface DagWidth {
  readonly width: number;
  readonly sequentialChain: boolean;
}

const widthCache = new WeakMap<ScheduleGraph, DagWidth>();

export function presetCap(preset: CrewPreset | CrewPresetInput | string): number {
  const canonical = coerceCrewPreset(preset);
  if (canonical === "Fastest") return Number.POSITIVE_INFINITY;
  if (canonical === "Balanced") return BALANCED_PRESET_CAP;
  return CHEAPEST_PRESET_CAP;
}

function assertCap(value: number, label: string): void {
  if (value === Number.POSITIVE_INFINITY) return;
  if (!Number.isInteger(value) || value < 0) {
    throw new SchedulerError("invalid_graph", `${label} must be a non-negative integer`);
  }
}

export function effectiveHardwareCap(
  hardwarePoolCap: number,
  pressure: GovernorPressure | GovernorPressureInput | string,
): number {
  if (!Number.isInteger(hardwarePoolCap) || hardwarePoolCap < 0) {
    throw new SchedulerError("invalid_graph", "Hardware pool cap must be a non-negative integer");
  }
  const canonical = coerceGovernorPressure(pressure);
  if (canonical === "RED") return 0;
  if (canonical === "ORANGE") return Math.min(hardwarePoolCap, 1);
  if (canonical === "YELLOW") return Math.min(hardwarePoolCap, Math.max(1, Math.floor(hardwarePoolCap / 2)));
  return hardwarePoolCap;
}

export function dagDisjointWidth(graph: ScheduleGraph): DagWidth {
  const cached = widthCache.get(graph);
  if (cached) return cached;
  const indexed = indexGraph(graph);
  const sequentialChain = isPureChain(indexed);
  const width = featureAntichainWidth(indexed);
  const report = { width, sequentialChain };
  widthCache.set(graph, report);
  return report;
}

function featureAntichainWidth(indexed: IndexedGraph): number {
  const groups = new Map<string, number[]>();
  for (let index = 0; index < indexed.tasks.length; index += 1) {
    const task = indexed.tasks[index];
    if (!task) continue;
    const bucket = groups.get(task.featureId);
    if (bucket) bucket.push(index);
    else groups.set(task.featureId, [index]);
  }
  const featureIds = [...groups.keys()].sort((a, b) => a.localeCompare(b));
  const count = featureIds.length;
  if (count === 0) return 0;
  const bits = descendantBits(indexed);
  const conflict: boolean[][] = featureIds.map(() => featureIds.map(() => false));
  for (let left = 0; left < count; left += 1) {
    for (let right = left + 1; right < count; right += 1) {
      const leftId = featureIds[left];
      const rightId = featureIds[right];
      if (!leftId || !rightId) continue;
      const together = featuresCanOverlapInTime(
        groups.get(leftId) ?? [],
        groups.get(rightId) ?? [],
        indexed,
        bits,
      );
      const row = conflict[left];
      const column = conflict[right];
      if (row) row[right] = !together;
      if (column) column[left] = !together;
    }
  }
  return count <= 16 ? exactIndependentSet(conflict) : greedyIndependentSet(conflict);
}

function featuresCanOverlapInTime(
  left: readonly number[],
  right: readonly number[],
  indexed: IndexedGraph,
  bits: readonly Uint32Array[],
): boolean {
  for (const a of left) {
    for (const b of right) {
      if (reaches(bits, a, b) || reaches(bits, b, a)) continue;
      const taskA = indexed.tasks[a];
      const taskB = indexed.tasks[b];
      if (!taskA || !taskB) continue;
      if (writeScopesOverlap(taskA.writeScope, taskB.writeScope)) continue;
      return true;
    }
  }
  return false;
}

function exactIndependentSet(conflict: readonly (readonly boolean[])[]): number {
  const count = conflict.length;
  let best = 0;
  const chosen: number[] = [];
  const walk = (start: number): void => {
    if (chosen.length > best) best = chosen.length;
    for (let index = start; index < count; index += 1) {
      if (chosen.some((picked) => conflict[index]?.[picked])) continue;
      if (chosen.length + (count - index) <= best) return;
      chosen.push(index);
      walk(index + 1);
      chosen.pop();
    }
  };
  walk(0);
  return Math.max(best, count === 0 ? 0 : 1);
}

function greedyIndependentSet(conflict: readonly (readonly boolean[])[]): number {
  const count = conflict.length;
  const order = Array.from({ length: count }, (_, index) => index);
  order.sort((left, right) => {
    const leftDegree = conflict[left]?.filter(Boolean).length ?? 0;
    const rightDegree = conflict[right]?.filter(Boolean).length ?? 0;
    return leftDegree - rightDegree || left - right;
  });
  const chosen: number[] = [];
  for (const index of order) {
    if (chosen.some((picked) => conflict[index]?.[picked])) continue;
    chosen.push(index);
  }
  return chosen.length;
}

export class WaveParallelismCalculator {
  dagWidth(graph: ScheduleGraph): DagWidth {
    return dagDisjointWidth(graph);
  }

  calculate(input: ParallelismInput): ParallelismDecision {
    assertCap(input.providerPacingCap, "Provider pacing cap");
    assertCap(input.worktreeSlotCap, "Worktree slot cap");
    const width = dagDisjointWidth(input.graph);
    const hardware = effectiveHardwareCap(input.hardwarePoolCap, input.governorPressure);
    const preset = presetCap(input.preset);
    const developer = input.developerMax === null ? Number.POSITIVE_INFINITY : input.developerMax;
    if (input.developerMax !== null && (!Number.isInteger(input.developerMax) || input.developerMax < 0)) {
      throw new SchedulerError("invalid_graph", "Developer max must be a non-negative integer");
    }
    const userPresetCap = Math.min(preset, developer);
    const bounds: readonly { name: BindingConstraint; value: number }[] = [
      { name: "dag_disjoint_width", value: width.width },
      { name: "hardware_pool_cap", value: hardware },
      { name: "provider_pacing_cap", value: input.providerPacingCap },
      { name: "worktree_slot_cap", value: input.worktreeSlotCap },
      { name: "user_preset_cap", value: userPresetCap },
    ];
    let wEff = Number.POSITIVE_INFINITY;
    let binding: BindingConstraint = "dag_disjoint_width";
    for (const bound of bounds) {
      if (bound.value < wEff) {
        wEff = bound.value;
        binding = bound.name;
      }
    }
    if (!Number.isFinite(wEff)) wEff = width.width;
    wEff = Math.max(0, Math.floor(wEff));
    const sequentialChain = width.sequentialChain && width.width === 1 && wEff === 1;
    const reason = sequentialChain
      ? SEQUENTIAL_CHAIN_REASON
      : `W_eff=${wEff} bound by ${binding}`;
    return {
      wEff,
      dagDisjointWidth: width.width,
      hardwarePoolCap: hardware,
      providerPacingCap: input.providerPacingCap,
      worktreeSlotCap: input.worktreeSlotCap,
      userPresetCap,
      bindingConstraint: binding,
      sequentialChain,
      reason,
    };
  }
}
