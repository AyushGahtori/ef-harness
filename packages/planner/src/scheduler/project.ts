import { at, SchedulerError } from "./errors.js";
import { computeRanks, indexGraph } from "./graph.js";
import type { IndexedGraph } from "./graph.js";
import { pacingCapOf } from "./ports.js";
import { WaveParallelismCalculator } from "./parallelism.js";
import { CrewPresetProfileEngine } from "./presets.js";
import type { ExpectedCostLevelSelectorPort } from "./presets.js";
import { blockedByLease, conflictsWithOccupied, orderReadyTasks } from "./select.js";
import type { OccupiedWork } from "./select.js";
import {
  MS_PER_MINUTE,
  featureBranch,
  type ActiveSlotSample,
  type LiveScheduleState,
  type ProjectOptions,
  type ScheduleProjection,
  type TaskPlacement,
} from "./types.js";

const calculator = new WaveParallelismCalculator();

interface RunningJob {
  readonly taskId: string;
  readonly featureId: string;
  readonly index: number;
  readonly endMs: number;
  readonly writeScope: readonly string[];
}

export function projectSchedule(
  state: LiveScheduleState,
  options: ProjectOptions,
  levels?: ExpectedCostLevelSelectorPort,
): ScheduleProjection {
  const indexed = indexGraph(state.graph, state.execTimeOverrideMs);
  const ranks = computeRanks(indexed);
  const pacing = pacingCapOf(state.connections, state.paidFallbackApproved);
  const decision = calculator.calculate({
    graph: state.graph,
    hardwarePoolCap: state.hardwarePoolCap,
    governorPressure: state.governorPressure,
    providerPacingCap: pacing,
    worktreeSlotCap: state.worktreeSlotCap,
    preset: state.preset,
    developerMax: state.developerMax,
  });
  const workerCap = options.workerCap === null ? decision.wEff : options.workerCap;
  const engine = new CrewPresetProfileEngine(levels);
  const profile = engine.profile(state.preset);
  const done = new Set(state.completedTaskIds);
  const held = new Set(state.holds.map((hold) => hold.taskId));
  const endAt = new Map<string, number>();
  for (const id of done) endAt.set(id, state.nowMs);
  const running: RunningJob[] = [];
  for (const turn of state.inFlight) {
    const index = indexed.tasks.findIndex((task) => task.id === turn.taskId);
    if (index < 0) continue;
    running.push({
      taskId: turn.taskId,
      featureId: turn.featureId,
      index,
      endMs: Math.max(state.nowMs, turn.startedAtMs + turn.execTimeMs),
      writeScope: turn.writeScope,
    });
  }

  const placements: TaskPlacement[] = [];
  const samples: ActiveSlotSample[] = [];
  const skipped: Record<string, number> = { ...state.skippedRounds };
  const readySince: Record<string, number> = { ...state.readySinceMs };
  let time = state.nowMs;
  let lastFeature = state.lastDispatchedFeatureId;
  let parkedReason: string | null = null;
  const record = (): void => {
    const previous = samples[samples.length - 1];
    if (previous && previous.timeMs === time && previous.activeSlots === running.length) return;
    samples.push({ timeMs: time, activeSlots: running.length });
  };
  record();

  const release = (): void => {
    for (let index = running.length - 1; index >= 0; index -= 1) {
      const job = running[index];
      if (!job || job.endMs > time) continue;
      done.add(job.taskId);
      endAt.set(job.taskId, job.endMs);
      running.splice(index, 1);
    }
  };

  let guard = 0;
  const limit = indexed.tasks.length * 8 + 8;
  while (done.size < indexed.tasks.length && guard < limit) {
    guard += 1;
    release();
    const readyIndexes: number[] = [];
    let nextReady = Number.POSITIVE_INFINITY;
    for (let index = 0; index < indexed.tasks.length; index += 1) {
      const task = at(indexed.tasks, index, "task");
      if (done.has(task.id) || running.some((job) => job.taskId === task.id) || held.has(task.id)) continue;
      const readyAt = predecessorReadyAt(indexed, index, done, endAt, running);
      if (readyAt === null) continue;
      if (readyAt <= time) {
        readyIndexes.push(index);
        if (readySince[task.id] === undefined) readySince[task.id] = time;
      } else if (readyAt < nextReady) nextReady = readyAt;
    }
    const openSlots = Math.max(0, workerCap - running.length);
    const ordered = orderReadyTasks({
      indexed,
      readyIndexes,
      critical: ranks.onCriticalPath,
      ranks: ranks.rankUMs,
      skippedRounds: skipped,
      readySinceMs: readySince,
      nowMs: time,
      policy: options.policy,
      batchSameFeature: profile.batchSameFeature && options.policy === "heft",
      lastFeatureId: lastFeature,
    });
    const occupied: OccupiedWork[] = running.map((job) => ({ featureId: job.featureId, writeScope: job.writeScope }));
    const started: number[] = [];
    for (const candidate of ordered) {
      if (started.length >= openSlots) {
        skipped[candidate.id] = (skipped[candidate.id] ?? 0) + 1;
        continue;
      }
      const task = at(indexed.tasks, candidate.index, "task");
      if (conflictsWithOccupied(task, occupied) || blockedByLease(task, state.pathLeases)) {
        skipped[candidate.id] = (skipped[candidate.id] ?? 0) + 1;
        continue;
      }
      started.push(candidate.index);
      occupied.push({ featureId: task.featureId, writeScope: task.writeScope });
      delete skipped[task.id];
    }
    if (started.length > 0) {
      for (const index of started) {
        const task = at(indexed.tasks, index, "task");
        const exec = indexed.execMs[index] ?? task.avgExecTimeMs;
        const hint = state.hintOverride[task.id] ?? task.hintStep;
        const level = engine.assignLevel(task, ranks.onCriticalPath.has(task.id), state.preset, hint);
        const endMs = time + exec;
        running.push({
          taskId: task.id,
          featureId: task.featureId,
          index,
          endMs,
          writeScope: task.writeScope,
        });
        placements.push({
          taskId: task.id,
          featureId: task.featureId,
          featureBranch: featureBranch(task.featureSlug),
          startMs: time,
          endMs,
          level: level.level,
          connectionId: "projected",
          writeScope: task.writeScope,
          onCriticalPath: ranks.onCriticalPath.has(task.id),
        });
        lastFeature = task.featureId;
      }
      record();
      continue;
    }
    const nextFinish = running.reduce((soonest, job) => Math.min(soonest, job.endMs), Number.POSITIVE_INFINITY);
    const next = Math.min(nextFinish, nextReady);
    if (!Number.isFinite(next) || next <= time) {
      if (readyIndexes.length > 0 && openSlots === 0 && running.length === 0) {
        parkedReason = decision.reason;
      }
      break;
    }
    time = next;
    release();
    record();
  }
  if (guard >= limit) {
    throw new SchedulerError("invalid_graph", "Schedule simulation did not finish");
  }

  let finish = state.nowMs;
  for (const placement of placements) {
    if (placement.endMs > finish) finish = placement.endMs;
  }
  for (const job of running) {
    if (job.endMs > finish) finish = job.endMs;
  }
  const parallelMs = Math.max(0, finish - state.nowMs);
  const peakWorkers = samples.reduce((peak, sample) => Math.max(peak, sample.activeSlots), 0);
  return {
    criticalPathMinutes: ranks.criticalPathMs / MS_PER_MINUTE,
    parallelSpeedupFactor: 1,
    activeSlotsByTime: samples,
    sequentialMinutes: parallelMs / MS_PER_MINUTE,
    parallelMinutes: parallelMs / MS_PER_MINUTE,
    peakWorkers,
    summary: decision.sequentialChain ? decision.reason : "",
    startOrder: placements.map((placement) => placement.taskId),
    placements,
    parkedReason,
  };
}

function predecessorReadyAt(
  indexed: IndexedGraph,
  index: number,
  done: ReadonlySet<string>,
  endAt: ReadonlyMap<string, number>,
  running: readonly RunningJob[],
): number | null {
  let ready = 0;
  for (const edge of at(indexed.predecessors, index, "predecessor")) {
    const pred = at(indexed.tasks, edge.index, "task");
    if (done.has(pred.id)) {
      ready = Math.max(ready, (endAt.get(pred.id) ?? 0) + edge.commDelayMs);
      continue;
    }
    const live = running.find((job) => job.taskId === pred.id);
    if (!live) return null;
    ready = Math.max(ready, live.endMs + edge.commDelayMs);
  }
  return ready;
}

export function projectWithSpeedup(
  state: LiveScheduleState,
  levels?: ExpectedCostLevelSelectorPort,
): ScheduleProjection {
  const parallel = projectSchedule(state, { policy: "heft", workerCap: null }, levels);
  const sequential = projectSchedule(state, { policy: "fifo", workerCap: 1 }, levels);
  const parallelMs = Math.round(parallel.parallelMinutes * MS_PER_MINUTE);
  const sequentialMs = Math.round(sequential.parallelMinutes * MS_PER_MINUTE);
  const factor = parallelMs === 0 ? 1 : sequentialMs / parallelMs;
  const decision = calculator.calculate({
    graph: state.graph,
    hardwarePoolCap: state.hardwarePoolCap,
    governorPressure: state.governorPressure,
    providerPacingCap: pacingCapOf(state.connections, state.paidFallbackApproved),
    worktreeSlotCap: state.worktreeSlotCap,
    preset: state.preset,
    developerMax: state.developerMax,
  });
  const low = Math.max(1, Math.round(parallel.parallelMinutes));
  const high = Math.max(low, Math.round(parallel.parallelMinutes * 1.5));
  const sequentialMinutes = Math.max(low, Math.round(sequential.parallelMinutes));
  const summary = decision.sequentialChain
    ? decision.reason
    : `~${low}–${high} min with ${parallel.peakWorkers} parallel workers vs ~${sequentialMinutes} min sequential`;
  return {
    ...parallel,
    parallelSpeedupFactor: factor,
    sequentialMinutes: sequential.parallelMinutes,
    summary,
    parkedReason: parallel.parkedReason,
  };
}
