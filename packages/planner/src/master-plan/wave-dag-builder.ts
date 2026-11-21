import { MasterPlanError } from "./errors.js";
import type { WeightShare } from "./integer-budget.js";
import type {
  CompletionWave,
  CostRange,
  PlannedFeature,
  PlannedWave,
  ProjectedRange,
  TaskCountRange,
} from "./types.js";

export interface WaveDagOptions {
  readonly breadthCap: number;
  readonly costPerLeafUnits: bigint;
}

export interface WaveDag {
  readonly waves: readonly PlannedWave[];
  readonly completionWave: CompletionWave;
  readonly breadthCap: number;
}

const DEFAULT_MAX_TASKS_WITHOUT_SIGNAL = 3;

export function projectedTaskCount(feature: PlannedFeature): TaskCountRange {
  const signal = feature.specItems + feature.screens + feature.endpoints;
  const declared = feature.estimatedLeafTasks;
  const min = declared?.min ?? 1;
  const max = declared?.max ?? Math.max(min, signal > 0 ? signal : DEFAULT_MAX_TASKS_WITHOUT_SIGNAL);
  if (!Number.isInteger(min) || !Number.isInteger(max) || min < 1 || max < min) {
    throw new MasterPlanError("invalid_feature_id", `Feature ${feature.id} has an invalid task-count range`);
  }
  return { min, max };
}

export function projectedCost(feature: PlannedFeature, costPerLeafUnits: bigint): CostRange {
  const tasks = projectedTaskCount(feature);
  const min = feature.estimatedCostUnits?.min ?? costPerLeafUnits * BigInt(tasks.min);
  const max = feature.estimatedCostUnits?.max ?? costPerLeafUnits * BigInt(tasks.max);
  if (min < 0n || max < min) {
    throw new MasterPlanError("invalid_budget", `Feature ${feature.id} has an invalid cost range`);
  }
  return { min, max };
}

function sumProjection(
  features: readonly PlannedFeature[],
  costPerLeafUnits: bigint,
): ProjectedRange {
  let minTasks = 0;
  let maxTasks = 0;
  let minCost = 0n;
  let maxCost = 0n;
  for (const feature of features) {
    const tasks = projectedTaskCount(feature);
    const cost = projectedCost(feature, costPerLeafUnits);
    minTasks += tasks.min;
    maxTasks += tasks.max;
    minCost += cost.min;
    maxCost += cost.max;
  }
  return {
    taskCount: { min: minTasks, max: maxTasks },
    costUnits: { min: minCost, max: maxCost },
  };
}

export function featureWaveWeight(features: readonly PlannedFeature[]): number {
  const projection = sumProjection(features, 0n);
  return Math.max(1, projection.taskCount.max);
}

function uniqueIds(ids: readonly string[], featureId: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  if (out.includes(featureId)) {
    throw new MasterPlanError("cycle", `cycle: ${featureId} -> ${featureId}`);
  }
  return out;
}

function findCycle(features: readonly PlannedFeature[]): string[] | null {
  const color = new Map<string, 0 | 1 | 2>();
  const stack: string[] = [];
  const byId = new Map(features.map((feature) => [feature.id, feature]));

  function visit(id: string): string[] | null {
    color.set(id, 1);
    stack.push(id);
    const node = byId.get(id);
    if (!node) return null;
    for (const dep of node.dependsOn) {
      const state = color.get(dep) ?? 0;
      if (state === 1) {
        const start = stack.indexOf(dep);
        return [...stack.slice(start), dep];
      }
      if (state === 0) {
        const found = visit(dep);
        if (found) return found;
      }
    }
    stack.pop();
    color.set(id, 2);
    return null;
  }

  for (const feature of features) {
    if ((color.get(feature.id) ?? 0) === 0) {
      const found = visit(feature.id);
      if (found) return found;
    }
  }
  return null;
}

function downstreamDepth(features: readonly PlannedFeature[]): Map<string, number> {
  const dependents = new Map<string, string[]>();
  for (const feature of features) dependents.set(feature.id, []);
  for (const feature of features) {
    for (const dep of feature.dependsOn) {
      dependents.get(dep)?.push(feature.id);
    }
  }
  const memo = new Map<string, number>();
  function depth(id: string, trail: Set<string>): number {
    const cached = memo.get(id);
    if (cached !== undefined) return cached;
    if (trail.has(id)) return 1;
    trail.add(id);
    let best = 1;
    for (const child of dependents.get(id) ?? []) {
      const next = 1 + depth(child, trail);
      if (next > best) best = next;
    }
    trail.delete(id);
    memo.set(id, best);
    return best;
  }
  for (const feature of features) depth(feature.id, new Set());
  return memo;
}

function upstreamDepth(features: readonly PlannedFeature[]): Map<string, number> {
  const byId = new Map(features.map((feature) => [feature.id, feature]));
  const memo = new Map<string, number>();
  function depth(id: string, trail: Set<string>): number {
    const cached = memo.get(id);
    if (cached !== undefined) return cached;
    if (trail.has(id)) return 1;
    trail.add(id);
    let best = 1;
    for (const dep of byId.get(id)?.dependsOn ?? []) {
      const next = 1 + depth(dep, trail);
      if (next > best) best = next;
    }
    trail.delete(id);
    memo.set(id, best);
    return best;
  }
  for (const feature of features) depth(feature.id, new Set());
  return memo;
}

function compareReady(
  left: PlannedFeature,
  right: PlannedFeature,
  waveIndex: number,
  downstream: ReadonlyMap<string, number>,
  upstream: ReadonlyMap<string, number>,
): number {
  if (waveIndex === 1) {
    const leftSlice = left.verticalSlice === true && left.dependsOn.length === 0 ? 1 : 0;
    const rightSlice = right.verticalSlice === true && right.dependsOn.length === 0 ? 1 : 0;
    if (leftSlice !== rightSlice) return rightSlice - leftSlice;
  }
  const leftDepth = downstream.get(left.id) ?? 1;
  const rightDepth = downstream.get(right.id) ?? 1;
  if (leftDepth !== rightDepth) return rightDepth - leftDepth;
  const leftUpstream = upstream.get(left.id) ?? 1;
  const rightUpstream = upstream.get(right.id) ?? 1;
  if (leftUpstream !== rightUpstream) return rightUpstream - leftUpstream;
  if (left.id !== right.id) return left.id < right.id ? -1 : 1;
  return 0;
}

/**
 * Topological wave partition.
 * A feature in wave W depends only on Phase 0 or on features in waves < W.
 * Breadth is capped. Ready nodes are taken longest-downstream-chain first,
 * then furthest-along an in-progress chain, so an independent feature does not
 * cut in front of the tail of a longer dependency chain.
 */
export function allocationWeights(phase0Count: number, waves: readonly PlannedWave[]): WeightShare[] {
  return [
    { key: "upfront", weight: BigInt(Math.max(1, phase0Count)) },
    ...waves.map((wave) => ({ key: `wave:${wave.index}`, weight: BigInt(wave.weightTasks) })),
    { key: "completion", weight: 1n },
  ];
}

export class WaveDagBuilder {
  build(features: readonly PlannedFeature[], options: WaveDagOptions): WaveDag {
    if (!Number.isInteger(options.breadthCap) || options.breadthCap < 1) {
      throw new MasterPlanError("invalid_breadth", "Wave breadth cap must be a positive integer");
    }
    if (options.costPerLeafUnits < 0n) {
      throw new MasterPlanError("invalid_budget", "Cost per leaf must be non-negative");
    }
    if (features.length === 0) {
      throw new MasterPlanError(
        "no_active_features",
        "Wave 1 needs at least one immediately buildable vertical-slice feature",
      );
    }
    const seen = new Set<string>();
    const normalized: PlannedFeature[] = [];
    for (const feature of features) {
      if (seen.has(feature.id)) {
        throw new MasterPlanError("duplicate_feature", `Duplicate feature ${feature.id}`);
      }
      seen.add(feature.id);
      normalized.push({ ...feature, dependsOn: uniqueIds(feature.dependsOn, feature.id) });
    }
    for (const feature of normalized) {
      for (const dep of feature.dependsOn) {
        if (!seen.has(dep)) {
          throw new MasterPlanError("dangling_dependency", `Feature ${feature.id} depends on missing ${dep}`);
        }
      }
    }
    const cycle = findCycle(normalized);
    if (cycle) {
      throw new MasterPlanError("cycle", `cycle: ${cycle.join(" -> ")}`);
    }

    const depth = downstreamDepth(normalized);
    const alongChain = upstreamDepth(normalized);
    const byId = new Map(normalized.map((feature) => [feature.id, feature]));
    const remaining = new Map(normalized.map((feature) => [feature.id, new Set(feature.dependsOn)]));
    const assigned = new Map<string, number>();
    const waves: PlannedWave[] = [];
    let waveIndex = 1;

    while (assigned.size < normalized.length) {
      const ready = normalized.filter((feature) => {
        if (assigned.has(feature.id)) return false;
        return (remaining.get(feature.id)?.size ?? 0) === 0;
      });
      if (ready.length === 0) {
        throw new MasterPlanError("cycle", "Wave scheduling stalled without a ready feature");
      }
      ready.sort((left, right) => compareReady(left, right, waveIndex, depth, alongChain));
      const chosen = ready.slice(0, options.breadthCap);
      const chosenIds = chosen.map((feature) => feature.id);
      for (const id of chosenIds) assigned.set(id, waveIndex);
      for (const feature of normalized) {
        if (assigned.has(feature.id)) continue;
        const deps = remaining.get(feature.id);
        if (!deps) continue;
        for (const id of chosenIds) deps.delete(id);
      }
      const chosenFeatures = chosenIds.map((id) => {
        const feature = byId.get(id);
        if (!feature) throw new MasterPlanError("dangling_dependency", `Missing scheduled feature ${id}`);
        return feature;
      });
      const projection = sumProjection(chosenFeatures, options.costPerLeafUnits);
      const dependsOn = waveIndex === 1 ? ["phase0"] : [`wave:${waveIndex - 1}`];
      waves.push({
        index: waveIndex,
        kind: "feature",
        featureIds: chosenIds,
        dependsOn,
        status: waveIndex === 1 ? "planned" : "projected",
        projected: waveIndex === 1 ? null : projection,
        leafTasks: [],
        weightTasks: Math.max(1, projection.taskCount.max),
      });
      waveIndex += 1;
      if (waveIndex > normalized.length + 1) {
        throw new MasterPlanError("wave_order_violation", "Wave index grew past the feature count");
      }
    }

    const wave1 = waves[0];
    if (!wave1) {
      throw new MasterPlanError("wave1_missing_vertical_slice", "Wave 1 was not created");
    }
    const wave1HasSlice = wave1.featureIds.some((id) => {
      const feature = byId.get(id);
      return feature?.verticalSlice === true && feature.dependsOn.length === 0;
    });
    if (!wave1HasSlice) {
      throw new MasterPlanError(
        "wave1_missing_vertical_slice",
        "Wave 1 must contain at least one immediately buildable vertical-slice feature",
      );
    }

    for (const feature of normalized) {
      const wave = assigned.get(feature.id);
      if (wave === undefined) {
        throw new MasterPlanError("unscheduled_feature", `Feature ${feature.id} was not scheduled`);
      }
      for (const dep of feature.dependsOn) {
        const depWave = assigned.get(dep);
        if (depWave === undefined || depWave >= wave) {
          throw new MasterPlanError(
            "wave_order_violation",
            `Feature ${feature.id} in wave ${wave} depends on ${dep} in wave ${depWave ?? "none"}`,
          );
        }
      }
    }

    const last = waves[waves.length - 1];
    if (!last) {
      throw new MasterPlanError("no_active_features", "No feature wave was produced");
    }
    return {
      waves,
      breadthCap: options.breadthCap,
      completionWave: {
        id: "completion",
        kind: "completion",
        ownerTask: "101",
        index: last.index + 1,
        dependsOn: [`wave:${last.index}`],
        status: "projected",
        leafTasks: [],
        projected: {
          taskCount: { min: 1, max: 1 },
          costUnits: { min: options.costPerLeafUnits, max: options.costPerLeafUnits },
        },
      },
    };
  }
}
