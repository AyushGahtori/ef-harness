import {
  DynamicScheduleRebalancer,
  HeftCriticalPathScheduler,
  createScheduleState,
  projectSchedule,
  projectWithSpeedup,
} from "@ef-harness/planner";
import type { LiveScheduleState, ScheduleGraph, ScheduleTask } from "@ef-harness/planner";
import type { Assignment, MachineProfile, ScheduleResult, WorkGraph, WorkTask } from "./types.js";

const MS_PER_SEC = 1000;

function slugFor(feature: string): string {
  const bare = feature.startsWith("F-") ? feature.slice(2) : feature;
  return bare
    .replace(/[A-Z]/g, (char, index: number) => (index === 0 ? char.toLowerCase() : `-${char.toLowerCase()}`))
    .toLowerCase();
}

function execMs(task: WorkTask): number {
  const ms = Math.round(task.avgExecSec * MS_PER_SEC);
  if (!Number.isInteger(ms) || ms < 1) throw new Error(`${task.id} has no positive exec time`);
  return ms;
}

export function toScheduleGraph(graph: WorkGraph): ScheduleGraph {
  const successors = new Map<string, { to: string; commDelayMs: number }[]>();
  for (const task of graph.tasks) successors.set(task.id, []);
  for (const task of graph.tasks) {
    for (const dep of task.deps) {
      const edges = successors.get(dep);
      if (!edges) throw new Error(`${task.id} depends on missing ${dep}`);
      edges.push({ to: task.id, commDelayMs: 0 });
    }
  }
  const tasks: ScheduleTask[] = graph.tasks.map((task) => {
    const slug = slugFor(task.feature);
    const writeScope = task.kind === "merge" ? ["integration/queue"] : [`${slug}/${task.id}`];
    return {
      id: task.id,
      featureId: task.feature,
      featureSlug: slug,
      waveIndex: task.phase === "phase0" ? 0 : task.phase === "wave" ? 1 : task.phase === "merge" ? 2 : 3,
      writeScope,
      avgExecTimeMs: execMs(task),
      successors: successors.get(task.id) ?? [],
      explicit: true,
      optionalPolish: false,
      difficulty: "standard",
      riskTags: [],
      role: null,
      hintStep: 0,
      briefVersion: 1,
      baseCommit: "kitchen",
    };
  });
  return { tasks };
}

function kitchenState(graph: WorkGraph, profile: MachineProfile, workers?: number): LiveScheduleState {
  return createScheduleState({
    graph: toScheduleGraph(graph),
    preset: profile.preset,
    hardwarePoolCap: profile.thinkingPool,
    worktreeSlotCap: profile.worktreeSlots,
    governorPressure: "GREEN",
    ...(workers === undefined ? {} : { developerMax: workers }),
  });
}

function projectOf(state: LiveScheduleState, workers?: number) {
  if (workers === undefined) return projectWithSpeedup(state);
  return projectSchedule(state, { policy: "heft", workerCap: workers });
}

function toResult(graph: WorkGraph, state: LiveScheduleState, workers: number | undefined, preset: MachineProfile["preset"]): ScheduleResult {
  const projection = projectOf(state, workers);
  const kind = new Map(graph.tasks.map((task) => [task.id, task.kind]));
  const phase = new Map(graph.tasks.map((task) => [task.id, task.phase]));
  const assignments: Assignment[] = projection.placements.map((placement) => ({
    id: placement.taskId,
    startSec: placement.startMs / MS_PER_SEC,
    finishSec: placement.endMs / MS_PER_SEC,
    worker: kind.get(placement.taskId) === "merge" ? "integrator" : placement.featureId,
  }));
  const span = (name: WorkTask["phase"]): number => {
    const rows = assignments.filter((row) => phase.get(row.id) === name);
    if (rows.length === 0) return 0;
    let start = rows[0]?.startSec ?? 0;
    let end = rows[0]?.finishSec ?? 0;
    for (const row of rows) {
      start = Math.min(start, row.startSec);
      end = Math.max(end, row.finishSec);
    }
    return end - start;
  };
  const scheduler = new HeftCriticalPathScheduler();
  const decided = scheduler.schedule(workers === undefined ? state : { ...state, developerMax: workers });
  return {
    makespanSec: projection.parallelMinutes * 60,
    sequentialSec: (workers === undefined ? projection.sequentialMinutes : projection.parallelMinutes) * 60,
    phase0Sec: span("phase0"),
    waveBuildSec: span("wave"),
    mergeQueueSec: span("merge"),
    completionAuditSec: span("audit"),
    wEff: workers ?? decided.parallelism.wEff,
    preset,
    assignments,
  };
}

export function scheduleKitchen(graph: WorkGraph, profile: MachineProfile): ScheduleResult {
  const state = kitchenState(graph, profile);
  return toResult(graph, state, undefined, profile.preset);
}

export function scheduleKitchenOn(graph: WorkGraph, workers: number): ScheduleResult {
  if (workers < 1) throw new Error("worker cap must be at least 1");
  const state = kitchenState(graph, {
    schema: "inline",
    ramGb: 64,
    thinkingPool: workers,
    warmSlots: 1,
    sessionCap: workers,
    pacingCap: workers,
    worktreeSlots: workers,
    preset: "Balanced",
    presetCap: workers,
    orangeEnterMs: 10_000,
    greenRecoverMs: 30_000,
    spikeIgnoredMs: 3_000,
  }, workers);
  return toResult(graph, state, workers, "Balanced");
}

export function scheduleWithRetry(graph: WorkGraph, profile: MachineProfile, taskId: string, extraSec: number): ScheduleResult {
  const state = kitchenState(graph, profile);
  const task = graph.tasks.find((item) => item.id === taskId);
  if (!task) throw new Error(`schedule is missing ${taskId}`);
  const rebalancer = new DynamicScheduleRebalancer();
  const rebalanced = rebalancer.rebalance(state, {
    type: "retry_escalation",
    taskId,
    hintStep: 1,
    execTimeMs: execMs(task) + Math.round(extraSec * MS_PER_SEC),
    nowMs: state.nowMs,
  });
  const cleared: LiveScheduleState = { ...rebalanced.state, inFlight: [], completedTaskIds: [] };
  return toResult(graph, cleared, undefined, profile.preset);
}

export function finishOf(schedule: ScheduleResult, id: string): number {
  const row = schedule.assignments.find((item) => item.id === id);
  if (!row) throw new Error(`schedule is missing ${id}`);
  return row.finishSec;
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
