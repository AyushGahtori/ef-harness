import { LEVEL_COST_PERCENT, PRESET_PEAK_WORKERS } from "./constants.js";
import { PlanPreviewError } from "./errors.js";
import {
  coercePlanPreviewLevel,
  coercePlanPreviewPreset,
  type ActiveSlotSample,
  type CrewLevel,
  type CrewLevelInput,
  type CrewPreset,
  type CrewPresetInput,
  type HeftSchedule,
  type PlannedTaskInput,
} from "./types.js";

export function rankOf(level: CrewLevel | CrewLevelInput | string): number {
  const canonical = coercePlanPreviewLevel(level);
  if (canonical === "Junior") return 0;
  if (canonical === "Mid") return 1;
  if (canonical === "Senior") return 2;
  return 3;
}

export function levelFromRank(rank: number): CrewLevel {
  if (rank <= 0) return "Junior";
  if (rank === 1) return "Mid";
  if (rank === 2) return "Senior";
  return "Principal";
}

export function assignLevel(
  task: PlannedTaskInput,
  preset: CrewPreset | CrewPresetInput | string,
): CrewLevel {
  const canonicalPreset = coercePlanPreviewPreset(preset);
  const floorLevel = coercePlanPreviewLevel(task.safetyFloor);
  const floor = rankOf(floorLevel);
  const balanced = Math.max(rankOf(task.balancedLevel), floor);
  if (canonicalPreset === "Cheapest") return floorLevel;
  if (canonicalPreset === "Balanced") return levelFromRank(balanced);
  const raised = task.criticalPath ? Math.min(3, balanced + 1) : balanced;
  return levelFromRank(Math.max(raised, floor));
}

export function durationForLevel(midMinutes: number, level: CrewLevel | CrewLevelInput | string): number {
  const canonical = coercePlanPreviewLevel(level);
  const mid = Math.max(1, Math.round(midMinutes));
  if (canonical === "Junior") return Math.max(1, Math.round((mid * 3) / 2));
  if (canonical === "Senior") return Math.max(1, Math.round((mid * 7) / 10));
  if (canonical === "Principal") return Math.max(1, Math.round((mid * 5) / 10));
  return mid;
}

export function costMicroForLevel(juniorMicroUsd: bigint, level: CrewLevel | CrewLevelInput | string): bigint {
  const canonical = coercePlanPreviewLevel(level);
  return (juniorMicroUsd * BigInt(LEVEL_COST_PERCENT[canonical])) / 100n;
}

export function costPpmForLevel(juniorPpm: number, level: CrewLevel | CrewLevelInput | string): number {
  const canonical = coercePlanPreviewLevel(level);
  return Math.round((juniorPpm * LEVEL_COST_PERCENT[canonical]) / 100);
}

export function workerCap(
  preset: CrewPreset | CrewPresetInput | string,
  widthCap: number | null,
  taskCount: number,
): number {
  const canonical = coercePlanPreviewPreset(preset);
  const presetCap = PRESET_PEAK_WORKERS[canonical];
  const capped = widthCap === null ? presetCap : Math.min(presetCap, Math.max(1, widthCap));
  if (taskCount <= 0) return capped;
  return Math.max(1, Math.min(capped, taskCount));
}

interface Schedulable {
  readonly id: string;
  readonly durationMinutes: number;
  readonly dependsOn: readonly string[];
}

export function computeHeft(tasks: readonly Schedulable[], width: number): HeftSchedule {
  if (tasks.length === 0) {
    return {
      criticalPathMinutes: 0,
      parallelSpeedupFactor: 1,
      activeSlotsByTime: [],
      sequentialMinutes: 0,
      peakWorkers: 0,
    };
  }
  const duration = new Map<string, number>();
  const deps = new Map<string, readonly string[]>();
  for (const task of tasks) {
    if (duration.has(task.id)) {
      throw new PlanPreviewError("duplicate_task", `Duplicate task ${task.id}`);
    }
    duration.set(task.id, Math.max(1, Math.round(task.durationMinutes)));
    deps.set(task.id, task.dependsOn);
  }
  for (const task of tasks) {
    for (const dep of task.dependsOn) {
      if (!duration.has(dep)) {
        throw new PlanPreviewError("unknown_dependency", `${task.id} depends on unknown task ${dep}`);
      }
    }
  }

  const chainMemo = new Map<string, number>();
  const visiting = new Set<string>();
  const chain = (id: string): number => {
    const cached = chainMemo.get(id);
    if (cached !== undefined) return cached;
    if (visiting.has(id)) {
      throw new PlanPreviewError("cycle", `Task graph cycle at ${id}`);
    }
    visiting.add(id);
    let longest = 0;
    for (const dep of deps.get(id) ?? []) {
      longest = Math.max(longest, chain(dep));
    }
    visiting.delete(id);
    const total = longest + (duration.get(id) ?? 0);
    chainMemo.set(id, total);
    return total;
  };

  let critical = 0;
  let sequential = 0;
  for (const task of tasks) {
    critical = Math.max(critical, chain(task.id));
    sequential += duration.get(task.id) ?? 0;
  }

  const unfinished = new Set(tasks.map((task) => task.id));
  const done = new Set<string>();
  const running: { id: string; doneAt: number }[] = [];
  const slots: ActiveSlotSample[] = [];
  let clock = 0;
  let peak = 0;
  const slotWidth = Math.max(1, width);
  const limit = tasks.length * 4 + 4;

  const pickReady = (): string | null => {
    let best: string | null = null;
    let bestChain = -1;
    for (const id of unfinished) {
      const predecessors = deps.get(id) ?? [];
      if (!predecessors.every((dep) => done.has(dep))) continue;
      const score = chainMemo.get(id) ?? 0;
      if (best === null || score > bestChain || (score === bestChain && id.localeCompare(best) < 0)) {
        best = id;
        bestChain = score;
      }
    }
    return best;
  };

  for (let step = 0; step < limit && (unfinished.size > 0 || running.length > 0); step += 1) {
    let started = false;
    while (running.length < slotWidth) {
      const next = pickReady();
      if (next === null) break;
      unfinished.delete(next);
      running.push({ id: next, doneAt: clock + (duration.get(next) ?? 0) });
      started = true;
    }
    if (started) {
      peak = Math.max(peak, running.length);
      slots.push({ atMinute: clock, activeSlots: running.length });
    }
    if (unfinished.size === 0 && running.length === 0) break;
    if (running.length === 0) {
      throw new PlanPreviewError("unschedulable", "Task dependencies cannot be scheduled");
    }
    let soonest = running[0]?.doneAt ?? clock;
    for (const item of running) {
      if (item.doneAt < soonest) soonest = item.doneAt;
    }
    clock = soonest;
    for (let index = running.length - 1; index >= 0; index -= 1) {
      const item = running[index];
      if (item && item.doneAt === soonest) {
        done.add(item.id);
        running.splice(index, 1);
      }
    }
  }

  if (unfinished.size > 0 || running.length > 0) {
    throw new PlanPreviewError("unschedulable", "Scheduling did not finish");
  }

  const speedup = critical === 0 ? 1 : Math.round((sequential * 100) / critical) / 100;
  return {
    criticalPathMinutes: critical,
    parallelSpeedupFactor: speedup,
    activeSlotsByTime: slots,
    sequentialMinutes: sequential,
    peakWorkers: peak,
  };
}

export function plannedWallClockLabel(schedule: HeftSchedule): string {
  const workers = schedule.peakWorkers === 1 ? "parallel worker" : "parallel workers";
  return `~${schedule.criticalPathMinutes.toString()} min with ${schedule.peakWorkers.toString()} ${workers} vs ~${schedule.sequentialMinutes.toString()} min sequential`;
}

export function projectedWallClockLabel(minMinutes: number, maxMinutes: number, peakWorkers: number): string {
  const workers = peakWorkers === 1 ? "parallel worker" : "parallel workers";
  return `~${minMinutes.toString()}–${maxMinutes.toString()} min with ${peakWorkers.toString()} ${workers} vs ~${maxMinutes.toString()} min sequential`;
}
