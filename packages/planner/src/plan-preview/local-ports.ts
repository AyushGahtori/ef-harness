import { allocatePaperwork } from "./paperwork.js";
import { assignLevel, computeHeft, workerCap } from "./schedule.js";
import { formatUsd } from "./money.js";
import type {
  ConnectionKind,
  CrewPreset,
  HeftSchedule,
  ImpactPreviewInput,
  PaperworkView,
  PlannedTaskInput,
} from "./types.js";

export interface HeftCriticalPathSchedulerPort {
  schedule(input: {
    readonly tasks: readonly {
      readonly id: string;
      readonly durationMinutes: number;
      readonly dependsOn: readonly string[];
    }[];
    readonly preset: CrewPreset;
    readonly widthCap: number | null;
  }): HeftSchedule;
}

export interface CrewPresetProfileEnginePort {
  apply(preset: CrewPreset, tasks: readonly PlannedTaskInput[]): readonly { readonly id: string; readonly crewLevel: PlannedTaskInput["balancedLevel"] }[];
}

export interface PaperworkBudgetPort {
  allocate(totalUnits: bigint, connection: ConnectionKind): PaperworkView;
}

export interface RevisionImpactPreviewPort {
  readonly llmCalls: 0;
  format(input: ImpactPreviewInput): string;
}

export interface ChosenForYouLedgerPort {
  forPlanPreview(): readonly import("./types.js").ChosenForYouEntry[];
}

export interface BoundedDeferralPort {
  listDeferred(workItemId: string): readonly import("./types.js").DeferredItem[];
}

export interface ReadinessCalculatorPort {
  project(workItemId: string): import("./types.js").ReadinessView;
}

export class LocalHeftCriticalPathScheduler implements HeftCriticalPathSchedulerPort {
  schedule(input: {
    readonly tasks: readonly {
      readonly id: string;
      readonly durationMinutes: number;
      readonly dependsOn: readonly string[];
    }[];
    readonly preset: CrewPreset;
    readonly widthCap: number | null;
  }): HeftSchedule {
    const width = workerCap(input.preset, input.widthCap, input.tasks.length);
    return computeHeft(input.tasks, width);
  }
}

export class LocalCrewPresetProfileEngine implements CrewPresetProfileEnginePort {
  apply(preset: CrewPreset, tasks: readonly PlannedTaskInput[]) {
    return tasks.map((task) => ({ id: task.id, crewLevel: assignLevel(task, preset) }));
  }
}

export class LocalPaperworkEnvelopeAllocator implements PaperworkBudgetPort {
  allocate(totalUnits: bigint, connection: ConnectionKind): PaperworkView {
    return allocatePaperwork(totalUnits, connection);
  }
}

export class LocalRevisionImpactPreviewer implements RevisionImpactPreviewPort {
  readonly llmCalls = 0 as const;

  format(input: ImpactPreviewInput): string {
    const contractNoun = input.contractCount === 1 ? "contract" : "contracts";
    const activeNoun = input.activeTasks.length === 1 ? "active task" : "active tasks";
    const names = input.activeTasks.map((task) => `'${task.title.replaceAll("'", "")}'`).join(", ");
    const pauses =
      input.activeTasks.length > 0
        ? `pauses ${input.activeTasks.length} ${activeNoun} (${names})`
        : "pauses 0 active tasks";
    const finishedNoun = input.finishedTaskCount === 1 ? "task" : "tasks";
    const otherNoun = input.untouchedTaskCount === 1 ? "task" : "tasks";
    const deltaNoun = input.deltaTasks === 1 ? "task" : "tasks";
    const cost = formatUsd(BigInt(Math.trunc(input.deltaCostMicroUsd)));
    return `Touches ${input.contractCount.toString()} ${contractNoun}, ${pauses}, re-checks ${input.finishedTaskCount.toString()} finished ${finishedNoun}, leaves ${input.untouchedTaskCount.toString()} other ${otherNoun} untouched · Est. delta: +${input.deltaTasks.toString()} ${deltaNoun}, ~${cost}`;
  }
}

export interface PlanPreviewSources {
  readonly scheduler: HeftCriticalPathSchedulerPort;
  readonly presets: CrewPresetProfileEnginePort;
  readonly paperwork: PaperworkBudgetPort;
  readonly impact: RevisionImpactPreviewPort;
  readonly chosenForYou?: ChosenForYouLedgerPort;
  readonly deferrals?: BoundedDeferralPort;
  readonly readiness?: ReadinessCalculatorPort;
}

export function defaultPlanPreviewSources(): PlanPreviewSources {
  return {
    scheduler: new LocalHeftCriticalPathScheduler(),
    presets: new LocalCrewPresetProfileEngine(),
    paperwork: new LocalPaperworkEnvelopeAllocator(),
    impact: new LocalRevisionImpactPreviewer(),
  };
}
