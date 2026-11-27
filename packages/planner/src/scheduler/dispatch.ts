import { TaskNotFoundError } from "@ef-harness/db";
import type {
  ExpectedCostLevelSelector,
  HistoricalPassRateCalibrator,
  VersionedModelRoster,
} from "../crew-levels/index.js";
import { at } from "./errors.js";
import { computeRanks, indexGraph } from "./graph.js";
import type { IndexedGraph } from "./graph.js";
import {
  orderConnections,
  pacingCapOf,
  type TaskClaimManagerPort,
  type TaskHoldsManagerPort,
} from "./ports.js";
import { WaveParallelismCalculator } from "./parallelism.js";
import { CrewPresetProfileEngine } from "./presets.js";
import type { ExpectedCostLevelSelectorPort } from "./presets.js";
import { orderReadyTasks, takeCandidates } from "./select.js";
import {
  WAITING_FOR_RESET_REASON,
  coerceCrewPreset,
  coerceGovernorPressure,
  featureBranch,
  worktreeSlotFor,
  type DispatchAssignment,
  type LiveScheduleState,
  type ParallelismDecision,
  type PrewarmIntent,
  type RankTable,
} from "./types.js";

export interface DispatchBatch {
  readonly admissions: readonly DispatchAssignment[];
  readonly skippedRounds: Readonly<Record<string, number>>;
  readonly readySinceMs: Readonly<Record<string, number>>;
  readonly parkedReason: string | null;
  readonly parallelism: ParallelismDecision;
  readonly ranks: RankTable;
  readonly prewarmNextWave: PrewarmIntent | null;
  readonly nextSerial: number;
  readonly lastDispatchedFeatureId: string | null;
}

export interface DispatchDeps {
  readonly claims?: TaskClaimManagerPort;
  readonly holds?: TaskHoldsManagerPort;
  readonly levels?: ExpectedCostLevelSelectorPort | ExpectedCostLevelSelector;
  readonly roster?: VersionedModelRoster;
  readonly calibrator?: HistoricalPassRateCalibrator;
}

const calculator = new WaveParallelismCalculator();

export function heldIds(state: LiveScheduleState): Set<string> {
  return new Set(state.holds.map((hold) => hold.taskId));
}

function isHeldOnPort(holds: TaskHoldsManagerPort | undefined, taskId: string): boolean {
  if (holds === undefined) return false;
  try {
    return holds.isTaskHeld(taskId);
  } catch (error) {
    if (error instanceof TaskNotFoundError) return false;
    throw error;
  }
}

export function prewarmFor(state: LiveScheduleState, presetWantsIt: boolean): PrewarmIntent | null {
  if (!presetWantsIt) return null;
  let current = 0;
  for (const task of state.graph.tasks) {
    if (task.waveIndex > current) current = task.waveIndex;
  }
  const next = current + 1;
  const features = new Set<string>();
  for (const task of state.graph.tasks) {
    if (task.waveIndex === next) features.add(task.featureId);
  }
  return {
    waveIndex: next,
    featureIds: [...features].sort((a, b) => a.localeCompare(b)),
    reason: "fastest-preset-jit",
  };
}

function engineForDispatch(deps: DispatchDeps): CrewPresetProfileEngine {
  if (deps.levels) return new CrewPresetProfileEngine(deps.levels);
  if (deps.roster || deps.calibrator) {
    return new CrewPresetProfileEngine({
      ...(deps.roster === undefined ? {} : { roster: deps.roster }),
      ...(deps.calibrator === undefined ? {} : { calibrator: deps.calibrator }),
    });
  }
  return new CrewPresetProfileEngine();
}

export function dispatchReady(
  state: LiveScheduleState,
  deps: DispatchDeps = {},
  policy: "heft" | "fifo" = "heft",
): DispatchBatch {
  const preset = coerceCrewPreset(state.preset);
  const governorPressure = coerceGovernorPressure(state.governorPressure);
  const indexed = indexGraph(state.graph, state.execTimeOverrideMs);
  const ranks = computeRanks(indexed);
  const pacing = pacingCapOf(state.connections, state.paidFallbackApproved);
  const parallelism = calculator.calculate({
    graph: state.graph,
    hardwarePoolCap: state.hardwarePoolCap,
    governorPressure,
    providerPacingCap: pacing,
    worktreeSlotCap: state.worktreeSlotCap,
    preset,
    developerMax: state.developerMax,
  });
  const engine = engineForDispatch(deps);
  const profile = engine.profile(preset);
  const held = heldIds(state);
  const runningIds = new Set(state.inFlight.map((turn) => turn.taskId));
  const done = new Set(state.completedTaskIds);
  const readyIndexes: number[] = [];
  const readySince = { ...state.readySinceMs };
  for (let index = 0; index < indexed.tasks.length; index += 1) {
    const task = at(indexed.tasks, index, "task");
    if (
      done.has(task.id) ||
      runningIds.has(task.id) ||
      held.has(task.id) ||
      isHeldOnPort(deps.holds, task.id)
    ) {
      continue;
    }
    if (!predecessorsDone(indexed, index, done)) continue;
    readyIndexes.push(index);
    if (readySince[task.id] === undefined) readySince[task.id] = state.nowMs;
  }

  const usable = orderConnections(state.connections, state.paidFallbackApproved, profile.preferSubscription);
  const parkedReason =
    state.connections.length > 0 && usable.length === 0 ? WAITING_FOR_RESET_REASON : null;
  const slots = parkedReason ? 0 : Math.max(0, parallelism.wEff - state.inFlight.length);
  const ordered = orderReadyTasks({
    indexed,
    readyIndexes,
    critical: ranks.onCriticalPath,
    ranks: ranks.rankUMs,
    skippedRounds: state.skippedRounds,
    readySinceMs: readySince,
    nowMs: state.nowMs,
    policy,
    batchSameFeature: profile.batchSameFeature,
    lastFeatureId: state.lastDispatchedFeatureId,
  });
  const occupied = state.inFlight.map((turn) => ({ featureId: turn.featureId, writeScope: turn.writeScope }));
  const taken = takeCandidates({
    ordered,
    indexed,
    slots,
    occupied,
    leases: state.pathLeases,
  });

  const slotBudget = new Map<string, number>();
  for (const connection of usable) slotBudget.set(connection.id, connection.pacingSlots);
  for (const turn of state.inFlight) {
    const remaining = slotBudget.get(turn.connectionId);
    if (remaining === undefined) continue;
    slotBudget.set(turn.connectionId, Math.max(0, remaining - 1));
  }
  const admissions: DispatchAssignment[] = [];
  const refused = new Set<string>();
  let serial = state.attemptSerial;
  let lastFeature = state.lastDispatchedFeatureId;
  for (const candidate of taken.chosen) {
    const task = at(indexed.tasks, candidate.index, "task");
    const connectionId = takeConnection(usable, slotBudget);
    if (state.connections.length > 0 && connectionId === null) {
      refused.add(task.id);
      continue;
    }
    const hint = state.hintOverride[task.id] ?? task.hintStep;
    const level = engine.assignLevel(task, ranks.onCriticalPath.has(task.id), preset, hint, {
      connections: state.connections,
      paidFallbackApproved: state.paidFallbackApproved,
      nowMs: state.nowMs,
    });
    const assignedConnection = connectionId ?? level.connectionId ?? "local-unassigned";
    serial += 1;
    const attemptId = `attempt:${task.id}:${serial}`;
    if (deps.claims) {
      const claim = deps.claims.claimTask({
        task: task.id,
        attemptId,
        expectedBrief: task.briefVersion,
        expiresAt: state.nowMs + 15 * 60_000,
        rev: serial,
        runtime: "native",
        model: level.modelId,
        connection: assignedConnection,
        baseCommit: task.baseCommit,
        now: state.nowMs,
        featureBranch: featureBranch(task.featureSlug),
        writeScope: task.writeScope,
      });
      if (!claim.claimed) {
        refused.add(task.id);
        serial -= 1;
        if (connectionId) slotBudget.set(connectionId, (slotBudget.get(connectionId) ?? 0) + 1);
        continue;
      }
    }
    admissions.push({
      taskId: task.id,
      featureId: task.featureId,
      featureSlug: task.featureSlug,
      featureBranch: featureBranch(task.featureSlug),
      worktreeSlot: worktreeSlotFor(task.featureSlug),
      level: level.level,
      modelId: level.modelId,
      connectionId: assignedConnection,
      rankUMs: ranks.rankUMs.get(task.id) ?? 0,
      writeScope: task.writeScope,
      waveIndex: task.waveIndex,
      preset,
      expectedCostMicroUsd: level.expectedCostMicroUsd,
      passProbability: level.passProbability,
      rationale: level.rationale,
      attemptId,
      onCriticalPath: ranks.onCriticalPath.has(task.id),
    });
    lastFeature = task.featureId;
  }

  const skipped = { ...state.skippedRounds };
  const admittedIds = new Set(admissions.map((row) => row.taskId));
  for (const id of taken.skippedIds) {
    if (admittedIds.has(id)) continue;
    skipped[id] = (skipped[id] ?? 0) + 1;
  }
  for (const id of refused) skipped[id] = (skipped[id] ?? 0) + 1;
  for (const id of admittedIds) delete skipped[id];

  return {
    admissions,
    skippedRounds: skipped,
    readySinceMs: readySince,
    parkedReason,
    parallelism,
    ranks,
    prewarmNextWave: prewarmFor(state, profile.prewarmNextWave),
    nextSerial: serial,
    lastDispatchedFeatureId: lastFeature,
  };
}

function predecessorsDone(indexed: IndexedGraph, index: number, done: ReadonlySet<string>): boolean {
  for (const edge of at(indexed.predecessors, index, "predecessor")) {
    const pred = at(indexed.tasks, edge.index, "task");
    if (!done.has(pred.id)) return false;
  }
  return true;
}

function takeConnection(
  usable: readonly { id: string; pacingSlots: number }[],
  budget: Map<string, number>,
): string | null {
  for (const connection of usable) {
    const left = budget.get(connection.id) ?? 0;
    if (left <= 0) continue;
    budget.set(connection.id, left - 1);
    return connection.id;
  }
  return usable.length === 0 ? null : null;
}
