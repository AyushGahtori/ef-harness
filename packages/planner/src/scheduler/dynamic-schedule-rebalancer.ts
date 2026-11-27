import { performance } from "node:perf_hooks";

import { dispatchReady } from "./dispatch.js";
import type { DispatchDeps } from "./dispatch.js";
import { SchedulerError } from "./errors.js";
import {
  coerceCrewPreset,
  coerceGovernorPressure,
  coerceTaskHoldReason,
  type DispatchAssignment,
  type InFlightTurn,
  type LiveScheduleState,
  type RebalanceEvent,
  type RebalanceResult,
  type TaskHoldRecord,
} from "./types.js";

export class ParallelWaveDispatcher {
  constructor(private readonly deps: DispatchDeps = {}) {}

  dispatch(state: LiveScheduleState) {
    return dispatchReady(state, this.deps, "heft");
  }
}

export class DynamicScheduleRebalancer {
  private readonly dispatcher: ParallelWaveDispatcher;
  private readonly deps: DispatchDeps;

  constructor(deps: DispatchDeps = {}) {
    this.deps = deps;
    this.dispatcher = new ParallelWaveDispatcher(deps);
  }

  rebalance(state: LiveScheduleState, event: RebalanceEvent): RebalanceResult {
    const started = performance.now();
    const yieldedToHold: string[] = [];
    const next = applyEvent(state, event, yieldedToHold, this.deps);
    const batch = this.dispatcher.dispatch(next);
    const admittedAt = new Set(batch.admissions.map((row) => row.taskId));
    const readySince = { ...batch.readySinceMs };
    for (const id of admittedAt) delete readySince[id];
    for (const id of next.completedTaskIds) delete readySince[id];
    const updated: LiveScheduleState = {
      ...next,
      inFlight: [...next.inFlight, ...batch.admissions.map((row) => toTurn(row, next))],
      skippedRounds: batch.skippedRounds,
      readySinceMs: readySince,
      parkedReason: batch.parkedReason,
      attemptSerial: batch.nextSerial,
      lastDispatchedFeatureId: batch.lastDispatchedFeatureId,
    };
    return {
      state: updated,
      admissions: batch.admissions,
      yieldedToHold,
      abortedTaskIds: [],
      ranks: batch.ranks,
      parallelism: batch.parallelism,
      prewarmNextWave: batch.prewarmNextWave,
      elapsedMs: performance.now() - started,
    };
  }
}

function toTurn(row: DispatchAssignment, state: LiveScheduleState): InFlightTurn {
  const task = state.graph.tasks.find((item) => item.id === row.taskId);
  return {
    taskId: row.taskId,
    featureId: row.featureId,
    featureSlug: row.featureSlug,
    attemptId: row.attemptId,
    connectionId: row.connectionId,
    level: row.level,
    modelId: row.modelId,
    presetAtClaim: row.preset,
    startedAtMs: state.nowMs,
    execTimeMs: state.execTimeOverrideMs[row.taskId] ?? task?.avgExecTimeMs ?? 1,
    writeScope: row.writeScope,
    waveIndex: row.waveIndex,
  };
}

function applyEvent(
  state: LiveScheduleState,
  event: RebalanceEvent,
  yieldedToHold: string[],
  deps: DispatchDeps,
): LiveScheduleState {
  if (event.nowMs < state.nowMs) {
    throw new SchedulerError("time_went_backwards", `Event time ${event.nowMs} is before ${state.nowMs}`);
  }
  if ("taskId" in event && !state.graph.tasks.some((task) => task.id === event.taskId)) {
    throw new SchedulerError("unknown_task", `Unknown task ${event.taskId}`);
  }
  const base = { ...state, nowMs: event.nowMs, parkedReason: null };
  if (event.type === "task_completed") {
    const completed = state.completedTaskIds.includes(event.taskId)
      ? state.completedTaskIds
      : [...state.completedTaskIds, event.taskId];
    return { ...base, completedTaskIds: completed, inFlight: state.inFlight.filter((turn) => turn.taskId !== event.taskId) };
  }
  if (event.type === "retry_escalation") {
    if (!Number.isInteger(event.execTimeMs) || event.execTimeMs < 1 || !Number.isInteger(event.hintStep) || event.hintStep < 0) {
      throw new SchedulerError("invalid_graph", "Retry escalation needs a positive exec time and a non-negative hint step");
    }
    return {
      ...base,
      inFlight: state.inFlight.filter((turn) => turn.taskId !== event.taskId),
      execTimeOverrideMs: { ...state.execTimeOverrideMs, [event.taskId]: event.execTimeMs },
      hintOverride: { ...state.hintOverride, [event.taskId]: event.hintStep },
    };
  }
  if (event.type === "task_hold") {
    const reason = coerceTaskHoldReason(event.reason);
    deps.holds?.placeHold({
      task: event.taskId,
      reason,
      source: event.source,
      now: event.nowMs,
    });
    const exists = state.holds.some(
      (hold) => hold.taskId === event.taskId && hold.reason === reason && hold.source === event.source,
    );
    const holds: TaskHoldRecord[] = exists
      ? [...state.holds]
      : [...state.holds, { taskId: event.taskId, reason, source: event.source, createdAtMs: event.nowMs }];
    if (state.inFlight.some((turn) => turn.taskId === event.taskId)) yieldedToHold.push(event.taskId);
    return { ...base, holds, inFlight: state.inFlight.filter((turn) => turn.taskId !== event.taskId) };
  }
  if (event.type === "task_release") {
    const reason = coerceTaskHoldReason(event.reason);
    deps.holds?.releaseHold({
      task: event.taskId,
      reason,
      source: event.source,
      now: event.nowMs,
    });
    return {
      ...base,
      holds: state.holds.filter(
        (hold) => !(hold.taskId === event.taskId && hold.reason === reason && hold.source === event.source),
      ),
    };
  }
  if (event.type === "governor") {
    return { ...base, governorPressure: coerceGovernorPressure(event.pressure) };
  }
  if (event.type === "provider_pacing") {
    return { ...base, connections: event.connections };
  }
  return { ...base, preset: coerceCrewPreset(event.preset) };
}
