import type { Assignment, MachineProfile, PressureLevel, ScheduleResult, WorkGraph, WorkTask } from "./types.ts";

export interface WidthInput {
  dagDisjointWidth: number;
  hardwarePoolCap: number;
  providerPacingCap: number;
  worktreeSlotCap: number;
  userPresetCap: number;
  governor: PressureLevel;
}

export class WaveParallelismCalculator {
  effective(input: WidthInput): number {
    const hardware =
      input.governor === "ORANGE" || input.governor === "RED" ? Math.min(input.hardwarePoolCap, 1) : input.hardwarePoolCap;
    const width = Math.min(
      input.dagDisjointWidth,
      hardware,
      input.providerPacingCap,
      input.worktreeSlotCap,
      input.userPresetCap,
    );
    return Math.max(1, Math.floor(width));
  }
}

export function dagDisjointWidth(tasks: readonly WorkTask[]): number {
  const builds = tasks.filter((task) => task.kind === "model" && task.phase === "wave");
  return Math.max(1, builds.length);
}

function successorMap(tasks: readonly WorkTask[]): Map<string, string[]> {
  const succs = new Map<string, string[]>();
  for (const task of tasks) {
    for (const dep of task.deps) {
      const list = succs.get(dep) ?? [];
      list.push(task.id);
      succs.set(dep, list);
    }
  }
  return succs;
}

function upwardRank(tasks: readonly WorkTask[]): Map<string, number> {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const succs = successorMap(tasks);
  const memo = new Map<string, number>();
  const visiting = new Set<string>();
  const rankOf = (id: string): number => {
    const cached = memo.get(id);
    if (cached !== undefined) return cached;
    if (visiting.has(id)) throw new Error(`cycle at ${id}`);
    visiting.add(id);
    const task = byId.get(id);
    if (!task) throw new Error(`missing task ${id}`);
    let best = 0;
    for (const succ of succs.get(id) ?? []) {
      const commDelaySec = 0;
      best = Math.max(best, commDelaySec + rankOf(succ));
    }
    visiting.delete(id);
    const value = task.avgExecSec + best;
    memo.set(id, value);
    return value;
  };
  for (const task of tasks) rankOf(task.id);
  return memo;
}

function depFinish(task: WorkTask, finish: ReadonlyMap<string, number>): number {
  let max = 0;
  for (const dep of task.deps) max = Math.max(max, finish.get(dep) ?? 0);
  return max;
}

function earliestWorker(free: readonly number[]): { index: number; at: number } {
  let index = 0;
  let at = free[0] ?? 0;
  for (let i = 1; i < free.length; i += 1) {
    const candidate = free[i] ?? 0;
    if (candidate < at) {
      index = i;
      at = candidate;
    }
  }
  return { index, at };
}

function phaseSpan(tasks: readonly WorkTask[], assignments: readonly Assignment[], phase: WorkTask["phase"]): number {
  const ids = new Set(tasks.filter((task) => task.phase === phase).map((task) => task.id));
  const rows = assignments.filter((row) => ids.has(row.id));
  if (rows.length === 0) return 0;
  let start = rows[0]?.startSec ?? 0;
  let end = rows[0]?.finishSec ?? 0;
  for (const row of rows) {
    start = Math.min(start, row.startSec);
    end = Math.max(end, row.finishSec);
  }
  return end - start;
}

export class HeftCriticalPathScheduler {
  schedule(graph: WorkGraph, profile: MachineProfile, governor: PressureLevel = "GREEN"): ScheduleResult {
    const width = new WaveParallelismCalculator().effective({
      dagDisjointWidth: dagDisjointWidth(graph.tasks),
      hardwarePoolCap: profile.thinkingPool,
      providerPacingCap: profile.pacingCap,
      worktreeSlotCap: profile.worktreeSlots,
      userPresetCap: profile.presetCap,
      governor,
    });
    const scheduled = this.scheduleOn(graph, width);
    return { ...scheduled, preset: profile.preset };
  }

  scheduleOn(graph: WorkGraph, workers: number): ScheduleResult {
    if (workers < 1) throw new Error("worker cap must be at least 1");
    const tasks = graph.tasks;
    const byId = new Map(tasks.map((task) => [task.id, task]));
    const rank = upwardRank(tasks);
    const succs = successorMap(tasks);
    const indeg = new Map(tasks.map((task) => [task.id, task.deps.length]));
    const ready = tasks.filter((task) => task.deps.length === 0).map((task) => task.id);
    const finish = new Map<string, number>();
    const workerFree = Array.from({ length: workers }, () => 0);
    let integratorFree = 0;
    const assignments: Assignment[] = [];
    let guard = 0;
    while (ready.length > 0) {
      guard += 1;
      if (guard > tasks.length + 1) throw new Error("schedule did not finish");
      ready.sort((left, right) => {
        const delta = (rank.get(right) ?? 0) - (rank.get(left) ?? 0);
        if (delta !== 0) return delta;
        return left < right ? -1 : left > right ? 1 : 0;
      });
      const id = ready.shift();
      if (!id) break;
      const task = byId.get(id);
      if (!task) throw new Error(`missing task ${id}`);
      const readyAt = depFinish(task, finish);
      let start = readyAt;
      let worker = "w0";
      if (task.kind === "merge") {
        start = Math.max(readyAt, integratorFree);
        integratorFree = start + task.avgExecSec;
        worker = "integrator";
      } else {
        const slot = earliestWorker(workerFree);
        start = Math.max(readyAt, slot.at);
        workerFree[slot.index] = start + task.avgExecSec;
        worker = `w${slot.index}`;
      }
      const end = start + task.avgExecSec;
      finish.set(id, end);
      assignments.push({ id, startSec: start, finishSec: end, worker });
      for (const succ of succs.get(id) ?? []) {
        const next = (indeg.get(succ) ?? 1) - 1;
        indeg.set(succ, next);
        if (next === 0) ready.push(succ);
      }
    }
    if (finish.size !== tasks.length) throw new Error("schedule missed a task");
    let makespanSec = 0;
    for (const value of finish.values()) makespanSec = Math.max(makespanSec, value);
    const sequentialSec = tasks.reduce((sum, task) => sum + task.avgExecSec, 0);
    return {
      makespanSec,
      sequentialSec,
      phase0Sec: phaseSpan(tasks, assignments, "phase0"),
      waveBuildSec: phaseSpan(tasks, assignments, "wave"),
      mergeQueueSec: phaseSpan(tasks, assignments, "merge"),
      completionAuditSec: phaseSpan(tasks, assignments, "audit"),
      wEff: workers,
      preset: "Balanced",
      assignments,
    };
  }
}

export class DynamicScheduleRebalancer {
  withRetry(graph: WorkGraph, profile: MachineProfile, taskId: string, extraSec: number): ScheduleResult {
    const tasks = graph.tasks.map((task) =>
      task.id === taskId ? { ...task, avgExecSec: task.avgExecSec + extraSec } : task,
    );
    return new HeftCriticalPathScheduler().schedule({ ...graph, tasks }, profile);
  }
}

export function speedupAgainst(baselineSec: number, makespanSec: number): number {
  if (makespanSec <= 0) return Number.POSITIVE_INFINITY;
  return baselineSec / makespanSec;
}

export function mergesOverlap(assignments: readonly Assignment[], tasks: readonly WorkTask[]): boolean {
  const merges = assignments
    .filter((row) => tasks.find((task) => task.id === row.id)?.kind === "merge")
    .sort((left, right) => left.startSec - right.startSec);
  for (let i = 1; i < merges.length; i += 1) {
    const previous = merges[i - 1];
    const current = merges[i];
    if (!previous || !current) return true;
    if (current.startSec < previous.finishSec) return true;
  }
  return false;
}
