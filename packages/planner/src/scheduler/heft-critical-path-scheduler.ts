import type {
  ExpectedCostLevelSelector,
  HistoricalPassRateCalibrator,
  VersionedModelRoster,
} from "../crew-levels/index.js";
import { dispatchReady, prewarmFor, type DispatchDeps } from "./dispatch.js";
import { SchedulerError } from "./errors.js";
import { computeRanks, indexGraph } from "./graph.js";
import { pacingCapOf, type TaskClaimManagerPort, type TaskHoldsManagerPort } from "./ports.js";
import { WaveParallelismCalculator } from "./parallelism.js";
import { CrewLevelsSelectorAdapter, CrewPresetProfileEngine } from "./presets.js";
import type { ExpectedCostLevelSelectorPort } from "./presets.js";
import { projectSchedule, projectWithSpeedup } from "./project.js";
import {
  coerceCrewPreset,
  coerceGovernorPressure,
  createScheduleState,
  type CrewPreset,
  type CrewPresetInput,
  type DispatchAssignment,
  type GovernorPressure,
  type GovernorPressureInput,
  type InFlightTurnInit,
  type LiveScheduleState,
  type PathLeaseView,
  type ProjectOptions,
  type ProviderConnection,
  type RankTable,
  type ScheduleGraph,
  type ScheduleProjection,
  type ScheduleResult,
  type TaskHoldRecord,
} from "./types.js";

export interface WorkloadFootprint {
  readonly taskId: string;
  readonly predictedMb: number;
  readonly wallClockMs: number;
}

export interface SchedulerDeps {
  readonly claims?: TaskClaimManagerPort;
  readonly holds?: TaskHoldsManagerPort;
  readonly levels?: ExpectedCostLevelSelectorPort | ExpectedCostLevelSelector;
  readonly roster?: VersionedModelRoster;
  readonly calibrator?: HistoricalPassRateCalibrator;
}

export interface WaveCapacityOptions {
  readonly hardwarePoolCap: number;
  readonly worktreeSlotCap?: number;
  readonly governorPressure?: GovernorPressure | GovernorPressureInput;
  readonly developerMax?: number | null;
  readonly connections?: readonly ProviderConnection[];
  readonly paidFallbackApproved?: boolean;
  readonly completedTaskIds?: readonly string[];
  readonly holds?: readonly TaskHoldRecord[];
  readonly inFlight?: readonly InFlightTurnInit[];
  readonly pathLeases?: readonly PathLeaseView[];
  readonly nowMs?: number;
}

export class HeftCriticalPathScheduler {
  private readonly deps: SchedulerDeps;

  constructor(deps: SchedulerDeps = {}) {
    this.deps = deps;
  }

  rank(graph: ScheduleGraph, execTimeOverrideMs: Readonly<Record<string, number>> = {}): RankTable {
    return computeRanks(indexGraph(graph, execTimeOverrideMs));
  }

  project(state: LiveScheduleState, options: ProjectOptions): ScheduleProjection {
    return projectSchedule(state, options, this.levelPort());
  }

  schedule(state: LiveScheduleState): ScheduleResult {
    const preset = coerceCrewPreset(state.preset);
    const governorPressure = coerceGovernorPressure(state.governorPressure);
    const ranks = this.rank(state.graph, state.execTimeOverrideMs);
    const engine = this.engine();
    const profile = engine.profile(preset);
    const parallelism = new WaveParallelismCalculator().calculate({
      graph: state.graph,
      hardwarePoolCap: state.hardwarePoolCap,
      governorPressure,
      providerPacingCap: pacingCapOf(state.connections, state.paidFallbackApproved),
      worktreeSlotCap: state.worktreeSlotCap,
      preset,
      developerMax: state.developerMax,
    });
    const projection = projectWithSpeedup(state, this.levelPort());
    return {
      preset,
      parallelism,
      levels: engine.assignAll(state.graph, ranks.onCriticalPath, preset, state.hintOverride),
      projection,
      prewarmNextWave: prewarmFor(state, profile.prewarmNextWave),
      parkedReason: projection.parkedReason,
    };
  }

  scheduleReadyWave(
    graph: ScheduleGraph,
    preset: CrewPreset | CrewPresetInput | string,
    capacity: number | WaveCapacityOptions,
  ): readonly DispatchAssignment[] {
    const canonicalPreset = coerceCrewPreset(preset);
    const options: WaveCapacityOptions =
      typeof capacity === "number"
        ? { hardwarePoolCap: capacity, worktreeSlotCap: capacity }
        : capacity;
    const state = createScheduleState({
      graph,
      preset: canonicalPreset,
      hardwarePoolCap: options.hardwarePoolCap,
      worktreeSlotCap: options.worktreeSlotCap ?? options.hardwarePoolCap,
      ...(options.governorPressure === undefined ? {} : { governorPressure: options.governorPressure }),
      ...(options.developerMax === undefined ? {} : { developerMax: options.developerMax }),
      ...(options.connections === undefined ? {} : { connections: options.connections }),
      ...(options.paidFallbackApproved === undefined
        ? {}
        : { paidFallbackApproved: options.paidFallbackApproved }),
      ...(options.completedTaskIds === undefined ? {} : { completedTaskIds: options.completedTaskIds }),
      ...(options.holds === undefined ? {} : { holds: options.holds }),
      ...(options.inFlight === undefined ? {} : { inFlight: options.inFlight }),
      ...(options.pathLeases === undefined ? {} : { pathLeases: options.pathLeases }),
      ...(options.nowMs === undefined ? {} : { nowMs: options.nowMs }),
    });
    return dispatchReady(state, this.dispatchDeps()).admissions;
  }

  scheduleWithFootprints(
    state: LiveScheduleState,
    footprints: readonly WorkloadFootprint[],
  ): ScheduleResult {
    const execTimeOverrideMs: Record<string, number> = { ...state.execTimeOverrideMs };
    for (const footprint of footprints) {
      if (!Number.isInteger(footprint.wallClockMs) || footprint.wallClockMs < 1) {
        throw new SchedulerError(
          "invalid_graph",
          `Workload footprint ${footprint.taskId} needs a positive integer wallClockMs`,
        );
      }
      execTimeOverrideMs[footprint.taskId] = footprint.wallClockMs;
    }
    return this.schedule({
      ...state,
      execTimeOverrideMs,
      governorPressure: coerceGovernorPressure(state.governorPressure),
    });
  }

  private levelPort(): ExpectedCostLevelSelectorPort | ExpectedCostLevelSelector | undefined {
    if (this.deps.levels) return this.deps.levels;
    if (this.deps.roster || this.deps.calibrator) {
      return new CrewLevelsSelectorAdapter(undefined, {
        ...(this.deps.roster === undefined ? {} : { roster: this.deps.roster }),
        ...(this.deps.calibrator === undefined ? {} : { calibrator: this.deps.calibrator }),
      });
    }
    return undefined;
  }

  private engine(): CrewPresetProfileEngine {
    if (this.deps.levels) return new CrewPresetProfileEngine(this.deps.levels);
    if (this.deps.roster || this.deps.calibrator) {
      return new CrewPresetProfileEngine({
        ...(this.deps.roster === undefined ? {} : { roster: this.deps.roster }),
        ...(this.deps.calibrator === undefined ? {} : { calibrator: this.deps.calibrator }),
      });
    }
    return new CrewPresetProfileEngine();
  }

  private dispatchDeps(): DispatchDeps {
    return {
      ...(this.deps.claims === undefined ? {} : { claims: this.deps.claims }),
      ...(this.deps.holds === undefined ? {} : { holds: this.deps.holds }),
      ...(this.deps.levels === undefined ? {} : { levels: this.deps.levels }),
      ...(this.deps.roster === undefined ? {} : { roster: this.deps.roster }),
      ...(this.deps.calibrator === undefined ? {} : { calibrator: this.deps.calibrator }),
    };
  }
}
