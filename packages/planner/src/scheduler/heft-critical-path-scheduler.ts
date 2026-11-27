import { computeRanks, indexGraph } from "./graph.js";
import { pacingCapOf } from "./ports.js";
import type { TaskClaimManagerPort } from "./ports.js";
import { WaveParallelismCalculator } from "./parallelism.js";
import { CrewPresetProfileEngine } from "./presets.js";
import type { ExpectedCostLevelSelectorPort } from "./presets.js";
import { prewarmFor } from "./dispatch.js";
import { projectSchedule, projectWithSpeedup } from "./project.js";
import type {
  LiveScheduleState,
  ProjectOptions,
  RankTable,
  ScheduleGraph,
  ScheduleProjection,
  ScheduleResult,
} from "./types.js";

export interface SchedulerDeps {
  readonly claims?: TaskClaimManagerPort;
  readonly levels?: ExpectedCostLevelSelectorPort;
}

export class HeftCriticalPathScheduler {
  private readonly levels: ExpectedCostLevelSelectorPort | undefined;

  constructor(deps: SchedulerDeps = {}) {
    this.levels = deps.levels;
  }

  rank(graph: ScheduleGraph, execTimeOverrideMs: Readonly<Record<string, number>> = {}): RankTable {
    return computeRanks(indexGraph(graph, execTimeOverrideMs));
  }

  project(state: LiveScheduleState, options: ProjectOptions): ScheduleProjection {
    return projectSchedule(state, options, this.levels);
  }

  schedule(state: LiveScheduleState): ScheduleResult {
    const ranks = this.rank(state.graph, state.execTimeOverrideMs);
    const engine = new CrewPresetProfileEngine(this.levels);
    const profile = engine.profile(state.preset);
    const parallelism = new WaveParallelismCalculator().calculate({
      graph: state.graph,
      hardwarePoolCap: state.hardwarePoolCap,
      governorPressure: state.governorPressure,
      providerPacingCap: pacingCapOf(state.connections, state.paidFallbackApproved),
      worktreeSlotCap: state.worktreeSlotCap,
      preset: state.preset,
      developerMax: state.developerMax,
    });
    const projection = projectWithSpeedup(state, this.levels);
    return {
      preset: state.preset,
      parallelism,
      levels: engine.assignAll(state.graph, ranks.onCriticalPath, state.preset, state.hintOverride),
      projection,
      prewarmNextWave: prewarmFor(state, profile.prewarmNextWave),
      parkedReason: projection.parkedReason,
    };
  }
}
