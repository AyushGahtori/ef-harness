import type {
  BoundedDeferralPolicy,
  ChosenForYouLedger,
  HonestReadinessCalculator,
  ReadinessCalculator,
} from "@ef-harness/discovery";
import {
  ExpectedCostLevelSelector,
  HistoricalPassRateCalibrator,
  VersionedModelRoster,
  defaultModelRoster,
  featuresFromGraphTask,
  selectionInput,
} from "../crew-levels/index.js";
import type { CostCurrency, RiskTag } from "../crew-levels/index.js";
import {
  MasterPlanOrchestrator,
  PaperworkBudgetEnvelopeAllocator,
  type MasterPlan,
  type MasterPlanRequest,
  type MasterPlannerModel,
} from "../master-plan/index.js";
import { RevisionImpactPreviewer } from "../revisions/index.js";
import {
  CrewLevelsSelectorAdapter,
  CrewPresetProfileEngine,
  HeftCriticalPathScheduler,
  MS_PER_MINUTE,
  SchedulerError,
  createScheduleState,
  type ExpectedCostLevelSelectorPort,
  type LevelSelection,
  type LevelSelectionRequest,
  type ScheduleGraph,
  type ScheduleTask,
} from "../scheduler/index.js";
import {
  PAPERWORK_CAP_PPM,
  PAPERWORK_ENVELOPES,
  PAPERWORK_LINE,
  PHASE0_STEPS,
  PLAN_WINDOW_PPM,
  PRESET_PEAK_WORKERS,
} from "./constants.js";
import { PlanPreviewError } from "./errors.js";
import { honestShortLabel } from "./money.js";
import { assignLevel, rankOf } from "./schedule.js";
import {
  coercePlanPreviewLevel,
  coercePlanPreviewPreset,
  createPlanRequest,
  type ActiveSlotSample,
  type ChosenForYouEntry,
  type ConnectionKind,
  type CrewLevel,
  type CrewPreset,
  type DeferredItem,
  type HeftSchedule,
  type ImpactPreviewInput,
  type PaperworkEnvelopeView,
  type PaperworkView,
  type Phase0Step,
  type PlanPreviewRequest,
  type PlanRequestInit,
  type PlannedTaskInput,
  type ProjectedFeatureInput,
  type ReadinessView,
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

export interface CrewLevelAssignmentView {
  readonly id: string;
  readonly crewLevel: CrewLevel;
  readonly modelId?: string;
  readonly expectedCostMicroUsd?: number;
}

export interface CrewPresetProfileEnginePort {
  apply(preset: CrewPreset, tasks: readonly PlannedTaskInput[]): readonly CrewLevelAssignmentView[];
}

export interface PaperworkBudgetPort {
  allocate(totalUnits: bigint, connection: ConnectionKind): PaperworkView;
}

export interface RevisionImpactPreviewPort {
  readonly llmCalls: 0;
  format(input: ImpactPreviewInput): string;
}

export interface ChosenForYouLedgerPort {
  forPlanPreview(): readonly ChosenForYouEntry[];
}

export interface BoundedDeferralPort {
  listDeferred(workItemId: string): readonly DeferredItem[];
}

export interface ReadinessCalculatorPort {
  project(workItemId: string): ReadinessView;
}

export interface MasterPlanPreviewOptions {
  readonly workItemId?: string;
  readonly revision?: number;
  readonly preset?: CrewPreset;
  readonly chosenForYou?: readonly ChosenForYouEntry[];
  readonly deferred?: readonly DeferredItem[];
  readonly readiness?: ReadinessView | null;
  readonly extraWave1Tasks?: readonly PlannedTaskInput[];
}

export interface MasterPlanPreviewPort {
  planToPreviewRequest(request: MasterPlanRequest, options?: MasterPlanPreviewOptions): PlanPreviewRequest;
  planModelToPreviewRequest(
    request: MasterPlanRequest,
    model: MasterPlannerModel,
    options?: MasterPlanPreviewOptions,
  ): Promise<PlanPreviewRequest>;
}

function slugifyTaskId(id: string): string {
  const cleaned = id.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return cleaned.length > 0 ? cleaned : "task";
}

function validatePreviewScheduleTasks(
  tasks: readonly { readonly id: string; readonly durationMinutes: number; readonly dependsOn: readonly string[] }[],
): void {
  const ids = new Set<string>();
  for (const task of tasks) {
    if (ids.has(task.id)) {
      throw new PlanPreviewError("duplicate_task", `Duplicate task ${task.id}`);
    }
    ids.add(task.id);
  }
  for (const task of tasks) {
    for (const dep of task.dependsOn) {
      if (!ids.has(dep)) {
        throw new PlanPreviewError("unknown_dependency", `${task.id} depends on unknown task ${dep}`);
      }
    }
  }
}

function toScheduleGraph(
  tasks: readonly { readonly id: string; readonly durationMinutes: number; readonly dependsOn: readonly string[] }[],
): ScheduleGraph {
  const successors = new Map<string, { readonly to: string; readonly commDelayMs: number }[]>();
  for (const task of tasks) successors.set(task.id, []);
  for (const task of tasks) {
    for (const dep of task.dependsOn) {
      successors.get(dep)?.push({ to: task.id, commDelayMs: 0 });
    }
  }
  const scheduleTasks: ScheduleTask[] = tasks.map((task) => ({
    id: task.id,
    featureId: task.id,
    featureSlug: slugifyTaskId(task.id),
    waveIndex: 1,
    writeScope: [`plan/${task.id}.ts`],
    avgExecTimeMs: Math.max(1, Math.round(task.durationMinutes)) * MS_PER_MINUTE,
    successors: successors.get(task.id) ?? [],
    explicit: true,
    optionalPolish: false,
    difficulty: "standard",
    riskTags: [],
    role: null,
    hintStep: 0,
    briefVersion: 1,
    baseCommit: "head",
  }));
  return { tasks: scheduleTasks };
}

class MemoizedExpectedCostPort implements ExpectedCostLevelSelectorPort {
  private readonly cache = new Map<string, LevelSelection>();

  constructor(private readonly inner: ExpectedCostLevelSelectorPort) {}

  selectLevel(input: LevelSelectionRequest): LevelSelection {
    const key = [
      input.preset,
      input.task.difficulty,
      input.onCriticalPath ? "1" : "0",
      input.hintStep,
      input.task.role ?? "",
      input.task.riskTags.join(","),
      input.paidFallbackApproved === undefined ? "" : String(input.paidFallbackApproved),
    ].join("|");
    const cached = this.cache.get(key);
    if (cached !== undefined) return cached;
    const selected = this.inner.selectLevel(input);
    this.cache.set(key, selected);
    return selected;
  }
}

export function bindHeftCriticalPathScheduler(
  scheduler: HeftCriticalPathScheduler,
): HeftCriticalPathSchedulerPort {
  return {
    schedule(input): HeftSchedule {
      if (input.tasks.length === 0) {
        return {
          criticalPathMinutes: 0,
          parallelSpeedupFactor: 1,
          activeSlotsByTime: [],
          sequentialMinutes: 0,
          peakWorkers: 0,
        };
      }
      validatePreviewScheduleTasks(input.tasks);
      const canonicalPreset = coercePlanPreviewPreset(input.preset);
      const presetMax = PRESET_PEAK_WORKERS[canonicalPreset];
      const cap = input.widthCap === null ? presetMax : Math.min(presetMax, Math.max(1, input.widthCap));
      const graph = toScheduleGraph(input.tasks);
      const state = createScheduleState({
        graph,
        preset: canonicalPreset,
        hardwarePoolCap: cap,
        worktreeSlotCap: cap,
        developerMax: cap,
      });
      try {
        const result = scheduler.schedule(state);
        const samples: ActiveSlotSample[] = result.projection.activeSlotsByTime
          .filter((sample) => sample.activeSlots > 0)
          .map((sample) => ({
            atMinute: Math.round(sample.timeMs / MS_PER_MINUTE),
            activeSlots: sample.activeSlots,
          }));
        const criticalMinutes = Math.round(result.projection.criticalPathMinutes);
        const sequentialMinutes = Math.round(result.projection.sequentialMinutes);
        const speedup =
          result.projection.parallelSpeedupFactor > 0
            ? Math.round(result.projection.parallelSpeedupFactor * 100) / 100
            : 1;
        return {
          criticalPathMinutes: criticalMinutes,
          parallelSpeedupFactor: speedup,
          activeSlotsByTime: samples.length > 0 ? samples : [{ atMinute: 0, activeSlots: result.projection.peakWorkers }],
          sequentialMinutes,
          peakWorkers: result.projection.peakWorkers,
        };
      } catch (error) {
        if (error instanceof SchedulerError) {
          throw new PlanPreviewError(error.code === "cycle" ? "cycle" : "unschedulable", error.message);
        }
        throw error;
      }
    },
  };
}

function riskTagsForFloor(floor: CrewLevel): RiskTag[] {
  if (floor === "Senior" || floor === "Principal") return ["auth"];
  return [];
}

function toScheduleTaskFromPlanned(task: PlannedTaskInput): ScheduleTask {
  const floor = coercePlanPreviewLevel(task.safetyFloor);
  const balanced = coercePlanPreviewLevel(task.balancedLevel);
  const difficulty =
    floor === "Principal" || balanced === "Principal"
      ? "critical"
      : floor === "Senior" || balanced === "Senior"
        ? "complex"
        : balanced === "Mid"
          ? "standard"
          : "trivial";
  return {
    id: task.id,
    featureId: task.featureId,
    featureSlug: slugifyTaskId(task.featureId),
    waveIndex: task.phase === "phase0" ? 0 : 1,
    writeScope: task.writeScope,
    avgExecTimeMs: Math.max(1, Math.round(task.durationMinutes)) * MS_PER_MINUTE,
    successors: [],
    explicit: true,
    optionalPolish: false,
    difficulty,
    riskTags: riskTagsForFloor(floor),
    role: floor === "Principal" ? "oracle-author@1" : null,
    hintStep: 0,
    briefVersion: 1,
    baseCommit: "head",
  };
}

export interface CrewPresetBindingOptions {
  readonly selector?: ExpectedCostLevelSelector;
  readonly roster?: VersionedModelRoster;
  readonly calibrator?: HistoricalPassRateCalibrator;
  readonly useExpectedCostSelector?: boolean;
}

export function bindExpectedCostLevelSelector(
  selector: ExpectedCostLevelSelector,
  roster: VersionedModelRoster = defaultModelRoster(),
  options: { readonly currency?: CostCurrency } = {},
): ExpectedCostLevelSelectorPort {
  return new CrewLevelsSelectorAdapter(selector, {
    roster,
    ...(options.currency === undefined ? {} : { currency: options.currency }),
  });
}

export function bindCrewPresetProfileEngine(
  engine: CrewPresetProfileEngine,
  options: CrewPresetBindingOptions = {},
): CrewPresetProfileEnginePort {
  const roster = options.roster ?? defaultModelRoster();
  const calibrator = options.calibrator ?? HistoricalPassRateCalibrator.fromRoster(roster, []);
  const selector = options.selector ?? new ExpectedCostLevelSelector(roster, calibrator);
  const useExpectedCostSelector = options.useExpectedCostSelector === true;

  const selectorCache = new Map<string, number>();

  return {
    apply(preset: CrewPreset, tasks: readonly PlannedTaskInput[]): readonly CrewLevelAssignmentView[] {
      const canonicalPreset = coercePlanPreviewPreset(preset);
      engine.profile(canonicalPreset);
      return tasks.map((task) => {
        if (useExpectedCostSelector) {
          const selection = engine.assignLevel(toScheduleTaskFromPlanned(task), task.criticalPath, canonicalPreset, 0);
          const floor = coercePlanPreviewLevel(task.safetyFloor);
          const crewLevel = rankOf(selection.level) >= rankOf(floor) ? selection.level : floor;
          const resolved =
            crewLevel === selection.level ? selection.modelId : roster.resolveModelForTier(crewLevel).modelId;
          return {
            id: task.id,
            crewLevel,
            modelId: resolved,
            expectedCostMicroUsd: selection.expectedCostMicroUsd,
          };
        }
        const crewLevel = assignLevel(task, canonicalPreset);
        const assignment = roster.resolveModelForTier(crewLevel);
        const costKey = `${canonicalPreset}|${crewLevel}|${task.criticalPath ? "1" : "0"}|${task.writeScope.length.toString()}`;
        let expectedCostMicroUsd = selectorCache.get(costKey);
        if (expectedCostMicroUsd === undefined) {
          expectedCostMicroUsd = Number(
            selector.select(
              selectionInput(
                featuresFromGraphTask({
                  id: task.id,
                  title: task.title,
                  primaryFiles: task.writeScope,
                }),
                canonicalPreset,
                "micro-usd",
                {
                  onCriticalPath: task.criticalPath,
                  paidFallbackApproved: true,
                },
              ),
            ).expectedCost,
          );
          selectorCache.set(costKey, expectedCostMicroUsd);
        }
        return {
          id: task.id,
          crewLevel,
          modelId: assignment.modelId,
          expectedCostMicroUsd,
        };
      });
    },
  };
}

export function bindPaperworkBudgetAllocator(
  allocator: PaperworkBudgetEnvelopeAllocator = new PaperworkBudgetEnvelopeAllocator(),
): PaperworkBudgetPort {
  return {
    allocate(totalUnits: bigint, connection: ConnectionKind): PaperworkView {
      if (totalUnits < 0n) {
        throw new PlanPreviewError("negative_budget", "Paperwork budget must be non-negative");
      }
      const allocated = allocator.allocate({
        currency: connection === "api" ? "usd" : "allowance_ppm",
        totalUnits,
        weights: [{ key: "plan", weight: 1n }],
      });
      let allocatedPpm = 0;
      const envelopes: PaperworkEnvelopeView[] = PAPERWORK_ENVELOPES.map((envelope) => {
        allocatedPpm += envelope.ppm;
        const reservedUnits = allocated.envelopes[envelope.id];
        const reservedLabel =
          connection === "api"
            ? honestShortLabel("api", reservedUnits, 0)
            : honestShortLabel("subscription", 0n, Number(reservedUnits));
        return {
          id: envelope.id,
          label: envelope.label,
          percentLabel: envelope.percentLabel,
          ppm: envelope.ppm,
          reservedUnits,
          reservedLabel,
        };
      });
      return {
        line: PAPERWORK_LINE,
        capPpm: PAPERWORK_CAP_PPM,
        allocatedPpm,
        withinCap: true,
        envelopes,
      };
    },
  };
}

export function bindRevisionImpactPreviewer(
  previewer: RevisionImpactPreviewer = new RevisionImpactPreviewer(),
): RevisionImpactPreviewPort {
  return {
    llmCalls: 0 as const,
    format(input: ImpactPreviewInput): string {
      return previewer.format({
        ...input,
        activeTasks: input.activeTasks.map((task, index) => ({
          id: task.id ?? `active-${index.toString()}`,
          title: task.title,
        })),
      });
    },
  };
}

export function bindChosenForYouLedger(ledger: ChosenForYouLedger): ChosenForYouLedgerPort {
  return {
    forPlanPreview(): readonly ChosenForYouEntry[] {
      return ledger.forPlanPreview().map((entry) => ({
        criterionId: entry.criterionId,
        criterionLabel: entry.criterionLabel,
        chosenValue: entry.chosenValue,
        optionId: entry.optionId,
        basis: entry.basis,
        rationale: entry.rationale,
        impactLevel: entry.impactLevel,
        downstreamTaskCount: entry.downstreamTaskCount,
        decisionId: entry.decisionId,
      }));
    },
  };
}

export function bindBoundedDeferralPolicy(policy: BoundedDeferralPolicy): BoundedDeferralPort {
  return {
    listDeferred(workItemId: string): readonly DeferredItem[] {
      return policy.listDeferred(workItemId).map((item) => ({
        decisionId: item.decisionId,
        criterionId: item.criterionId,
        label: item.label,
        deferredReason: item.deferredReason,
        revisitWave: item.revisitWave,
      }));
    },
  };
}

export function bindReadinessCalculator(calculator: ReadinessCalculator): ReadinessCalculatorPort {
  return {
    project(workItemId: string): ReadinessView {
      const report = calculator.project(workItemId);
      return {
        isReadyToPlan: report.isReadyToPlan,
        headline: report.headline,
        counts: {
          chosenForYou: report.counts.chosenForYou,
          deferred: report.counts.deferred,
          conflict: report.counts.conflict,
          openMustAsk: report.counts.openMustAsk,
          settledTotal: report.counts.settledTotal,
        },
      };
    },
  };
}

export function bindHonestReadinessCalculator(calculator: HonestReadinessCalculator): ReadinessCalculatorPort {
  return {
    project(workItemId: string): ReadinessView {
      const counts = calculator.snapshot(workItemId);
      const settledTotal =
        counts.explicitCount +
        counts.confirmedCount +
        counts.delegatedChosenForYouCount +
        counts.observedCount;
      return {
        isReadyToPlan: counts.readyToPlan,
        headline: counts.readyToPlan ? "Ready for plan preview" : "Discovery still has unsettled blockers",
        counts: {
          chosenForYou: counts.delegatedChosenForYouCount,
          deferred: counts.deferredCount,
          conflict: counts.blockingUnsettledCount,
          openMustAsk: counts.blockingUnsettledCount,
          settledTotal,
        },
      };
    },
  };
}

function asPhase0Step(id: string): Phase0Step {
  if ((PHASE0_STEPS as readonly string[]).includes(id)) return id as Phase0Step;
  return "P0.1";
}

export function planRequestFromMasterPlan(
  plan: MasterPlan,
  options: MasterPlanPreviewOptions = {},
): PlanPreviewRequest {
  const connection: ConnectionKind = plan.currency === "usd" ? "api" : "subscription";
  const totalBudgetMicroUsd = plan.currency === "usd" ? plan.totalUnits : 0n;
  const totalBudgetPpm = plan.currency === "allowance_ppm" ? Number(plan.totalUnits) : PLAN_WINDOW_PPM;
  const phase0Ids = new Set(plan.phase0.map((recipe) => recipe.id));
  const featureById = new Map(plan.features.map((feature) => [feature.id, feature]));
  const phase0Tasks: PlannedTaskInput[] = plan.phase0.map((recipe) => ({
    id: recipe.id,
    title: recipe.title,
    featureId: "F-Foundation",
    featureTitle: "Foundation",
    phase: "phase0",
    phase0Step: asPhase0Step(recipe.id),
    writeScope: [...recipe.writeScope],
    balancedLevel: recipe.level,
    safetyFloor: recipe.level,
    criticalPath: recipe.stage === "serial" || recipe.dependsOn.length === 0,
    juniorCostMicroUsd: plan.currency === "usd" ? plan.costPerLeafUnits : 100_000n,
    juniorCostPpm: plan.currency === "allowance_ppm" ? Number(plan.costPerLeafUnits) : 1_000,
    durationMinutes: recipe.stage === "serial" ? 10 : 8,
    dependsOn: recipe.dependsOn.filter((dep) => phase0Ids.has(dep)),
  }));

  const wave1 = plan.waves.find((wave) => wave.index === 1);
  const wave1Tasks: PlannedTaskInput[] =
    options.extraWave1Tasks && options.extraWave1Tasks.length > 0
      ? [...options.extraWave1Tasks]
      : (wave1?.featureIds ?? []).map((featureId) => {
          const feature = featureById.get(featureId);
          return {
            id: `W1-${featureId}`,
            title: feature?.title ?? featureId,
            featureId,
            featureTitle: feature?.title ?? featureId,
            phase: "wave1",
            writeScope: [`src/features/${slugifyTaskId(featureId)}/**`],
            balancedLevel: "Mid",
            safetyFloor: "Junior",
            criticalPath: feature?.verticalSlice === true,
            juniorCostMicroUsd: plan.currency === "usd" ? plan.costPerLeafUnits : 100_000n,
            juniorCostPpm: plan.currency === "allowance_ppm" ? Number(plan.costPerLeafUnits) : 1_000,
            durationMinutes: 12,
            dependsOn: phase0Tasks[0] ? [phase0Tasks[0].id] : [],
          };
        });

  const projected: ProjectedFeatureInput[] = [];
  for (const wave of plan.waves) {
    if (wave.index < 2) continue;
    const waveTaskRange = wave.projected?.taskCount ?? { min: 2, max: 4 };
    const waveCostRange = wave.projected?.costUnits ?? { min: 200_000n, max: 400_000n };
    const featureCount = Math.max(1, wave.featureIds.length);
    wave.featureIds.forEach((featureId, idx) => {
      const feature = featureById.get(featureId);
      const taskRange = feature?.estimatedLeafTasks ?? {
        min: Math.max(1, Math.floor(waveTaskRange.min / featureCount)),
        max: Math.max(1, Math.ceil(waveTaskRange.max / featureCount)),
      };
      const costUnits = feature?.estimatedCostUnits ?? {
        min: waveCostRange.min / BigInt(featureCount),
        max: waveCostRange.max / BigInt(featureCount),
      };
      projected.push({
        featureId,
        title: feature?.title ?? featureId,
        kind: "feature",
        wave: wave.index,
        taskCount: taskRange,
        costMicroUsd: plan.currency === "usd" ? costUnits : { min: 0n, max: 0n },
        costPpm:
          plan.currency === "allowance_ppm"
            ? { min: Number(costUnits.min), max: Number(costUnits.max) }
            : { min: 0, max: 0 },
        minutes: { min: taskRange.min * 5, max: taskRange.max * 8 },
        dependsOn: [...(feature?.dependsOn ?? [])].filter((dep) => !(wave1?.featureIds ?? []).includes(dep)),
        optional: feature?.verticalSlice !== true,
        priority: idx + 1,
      });
    });
  }

  projected.push({
    featureId: "F-Complete",
    title: "Final audit",
    kind: "completion",
    wave: 0,
    taskCount: { ...plan.completionWave.projected.taskCount },
    costMicroUsd:
      plan.currency === "usd" ? { ...plan.completionWave.projected.costUnits } : { min: 0n, max: 0n },
    costPpm:
      plan.currency === "allowance_ppm"
        ? {
            min: Number(plan.completionWave.projected.costUnits.min),
            max: Number(plan.completionWave.projected.costUnits.max),
          }
        : { min: 0, max: 0 },
    minutes: {
      min: plan.completionWave.projected.taskCount.min * 4,
      max: plan.completionWave.projected.taskCount.max * 8,
    },
    dependsOn: [...plan.completionWave.dependsOn],
    optional: false,
    priority: 99,
  });

  const init: PlanRequestInit = {
    projectId: plan.projectId,
    connection,
    tasks: [...phase0Tasks, ...wave1Tasks],
    totalBudgetMicroUsd,
    totalBudgetPpm,
    projected,
    ...(options.workItemId === undefined ? {} : { workItemId: options.workItemId }),
    ...(options.revision === undefined ? {} : { revision: options.revision }),
    ...(options.preset === undefined ? {} : { preset: options.preset }),
    ...(options.chosenForYou === undefined ? {} : { chosenForYou: options.chosenForYou }),
    ...(options.deferred === undefined ? {} : { deferred: options.deferred }),
    ...(options.readiness === undefined ? {} : { readiness: options.readiness }),
  };
  return createPlanRequest(init);
}

export function bindMasterPlanOrchestrator(
  orchestrator: MasterPlanOrchestrator = new MasterPlanOrchestrator(),
): MasterPlanPreviewPort {
  return {
    planToPreviewRequest(request: MasterPlanRequest, options?: MasterPlanPreviewOptions): PlanPreviewRequest {
      return planRequestFromMasterPlan(orchestrator.plan(request), options);
    },
    async planModelToPreviewRequest(
      request: MasterPlanRequest,
      model: MasterPlannerModel,
      options?: MasterPlanPreviewOptions,
    ): Promise<PlanPreviewRequest> {
      const plan = await orchestrator.planFromModel(request, model);
      return planRequestFromMasterPlan(plan, options);
    },
  };
}

export class LocalHeftCriticalPathScheduler implements HeftCriticalPathSchedulerPort {
  private readonly inner: HeftCriticalPathSchedulerPort;

  constructor(
    scheduler: HeftCriticalPathScheduler = new HeftCriticalPathScheduler({
      levels: new MemoizedExpectedCostPort(new CrewLevelsSelectorAdapter()),
    }),
  ) {
    this.inner = bindHeftCriticalPathScheduler(scheduler);
  }

  schedule(input: {
    readonly tasks: readonly {
      readonly id: string;
      readonly durationMinutes: number;
      readonly dependsOn: readonly string[];
    }[];
    readonly preset: CrewPreset;
    readonly widthCap: number | null;
  }): HeftSchedule {
    return this.inner.schedule(input);
  }
}

export class LocalCrewPresetProfileEngine implements CrewPresetProfileEnginePort {
  private readonly inner: CrewPresetProfileEnginePort;

  constructor(options: CrewPresetBindingOptions = {}) {
    const roster = options.roster ?? defaultModelRoster();
    const calibrator = options.calibrator ?? HistoricalPassRateCalibrator.fromRoster(roster, []);
    const selector = options.selector ?? new ExpectedCostLevelSelector(roster, calibrator);
    const engine = new CrewPresetProfileEngine({ selector, roster, calibrator });
    this.inner = bindCrewPresetProfileEngine(engine, { selector, roster, calibrator, ...options });
  }

  apply(preset: CrewPreset, tasks: readonly PlannedTaskInput[]): readonly CrewLevelAssignmentView[] {
    return this.inner.apply(preset, tasks);
  }
}

export class LocalPaperworkEnvelopeAllocator implements PaperworkBudgetPort {
  private readonly inner = bindPaperworkBudgetAllocator(new PaperworkBudgetEnvelopeAllocator());

  allocate(totalUnits: bigint, connection: ConnectionKind): PaperworkView {
    return this.inner.allocate(totalUnits, connection);
  }
}

export class LocalRevisionImpactPreviewer implements RevisionImpactPreviewPort {
  readonly llmCalls = 0 as const;
  private readonly inner = bindRevisionImpactPreviewer(new RevisionImpactPreviewer());

  format(input: ImpactPreviewInput): string {
    return this.inner.format(input);
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
  readonly masterPlan?: MasterPlanPreviewPort;
}

export interface CreatePlanPreviewSourcesOptions {
  readonly chosenForYou?: ChosenForYouLedger | ChosenForYouLedgerPort;
  readonly deferrals?: BoundedDeferralPolicy | BoundedDeferralPort;
  readonly readiness?: ReadinessCalculator | HonestReadinessCalculator | ReadinessCalculatorPort;
  readonly masterPlan?: MasterPlanOrchestrator | MasterPlanPreviewPort;
  readonly scheduler?: HeftCriticalPathScheduler | HeftCriticalPathSchedulerPort;
  readonly presets?: CrewPresetProfileEngine | CrewPresetProfileEnginePort;
  readonly selector?: ExpectedCostLevelSelector;
  readonly roster?: VersionedModelRoster;
  readonly calibrator?: HistoricalPassRateCalibrator;
  readonly useExpectedCostSelector?: boolean;
  readonly paperwork?: PaperworkBudgetEnvelopeAllocator | PaperworkBudgetPort;
  readonly impact?: RevisionImpactPreviewer | RevisionImpactPreviewPort;
}

function isHeftPort(value: HeftCriticalPathScheduler | HeftCriticalPathSchedulerPort): value is HeftCriticalPathSchedulerPort {
  return !(value instanceof HeftCriticalPathScheduler);
}

function isPresetsPort(value: CrewPresetProfileEngine | CrewPresetProfileEnginePort): value is CrewPresetProfileEnginePort {
  return !(value instanceof CrewPresetProfileEngine);
}

function isPaperworkPort(value: PaperworkBudgetEnvelopeAllocator | PaperworkBudgetPort): value is PaperworkBudgetPort {
  return !(value instanceof PaperworkBudgetEnvelopeAllocator);
}

function isChosenPort(value: ChosenForYouLedger | ChosenForYouLedgerPort): value is ChosenForYouLedgerPort {
  return !("override" in value);
}

function isDeferralPort(value: BoundedDeferralPolicy | BoundedDeferralPort): value is BoundedDeferralPort {
  return !("defer" in value);
}

function isReadinessPort(
  value: ReadinessCalculator | HonestReadinessCalculator | ReadinessCalculatorPort,
): value is ReadinessCalculatorPort {
  return "project" in value && !("scope" in value);
}

function isHonestReadiness(
  value: ReadinessCalculator | HonestReadinessCalculator | ReadinessCalculatorPort,
): value is HonestReadinessCalculator {
  return "snapshot" in value && !("project" in value);
}

function isMasterPlanPort(value: MasterPlanOrchestrator | MasterPlanPreviewPort): value is MasterPlanPreviewPort {
  return !(value instanceof MasterPlanOrchestrator);
}

export function createPlanPreviewSources(options: CreatePlanPreviewSourcesOptions = {}): PlanPreviewSources {
  const roster = options.roster ?? defaultModelRoster();
  const calibrator = options.calibrator ?? HistoricalPassRateCalibrator.fromRoster(roster, []);
  const selector = options.selector ?? new ExpectedCostLevelSelector(roster, calibrator);
  const memoLevels = new MemoizedExpectedCostPort(new CrewLevelsSelectorAdapter(selector, { roster, calibrator }));

  const scheduler: HeftCriticalPathSchedulerPort =
    options.scheduler === undefined
      ? bindHeftCriticalPathScheduler(new HeftCriticalPathScheduler({ levels: memoLevels }))
      : isHeftPort(options.scheduler)
        ? options.scheduler
        : bindHeftCriticalPathScheduler(options.scheduler);

  const presets: CrewPresetProfileEnginePort =
    options.presets === undefined
      ? bindCrewPresetProfileEngine(new CrewPresetProfileEngine(memoLevels), {
          selector,
          roster,
          calibrator,
          ...(options.useExpectedCostSelector === undefined
            ? {}
            : { useExpectedCostSelector: options.useExpectedCostSelector }),
        })
      : isPresetsPort(options.presets)
        ? options.presets
        : bindCrewPresetProfileEngine(options.presets, {
            selector,
            roster,
            calibrator,
            ...(options.useExpectedCostSelector === undefined
              ? {}
              : { useExpectedCostSelector: options.useExpectedCostSelector }),
          });

  const paperwork: PaperworkBudgetPort =
    options.paperwork === undefined
      ? bindPaperworkBudgetAllocator(new PaperworkBudgetEnvelopeAllocator())
      : isPaperworkPort(options.paperwork)
        ? options.paperwork
        : bindPaperworkBudgetAllocator(options.paperwork);

  const impact: RevisionImpactPreviewPort =
    options.impact === undefined
      ? bindRevisionImpactPreviewer(new RevisionImpactPreviewer())
      : options.impact instanceof RevisionImpactPreviewer
        ? bindRevisionImpactPreviewer(options.impact)
        : options.impact;

  const masterPlan: MasterPlanPreviewPort =
    options.masterPlan === undefined
      ? bindMasterPlanOrchestrator(new MasterPlanOrchestrator())
      : isMasterPlanPort(options.masterPlan)
        ? options.masterPlan
        : bindMasterPlanOrchestrator(options.masterPlan);

  const chosenForYouPort =
    options.chosenForYou === undefined
      ? undefined
      : isChosenPort(options.chosenForYou)
        ? options.chosenForYou
        : bindChosenForYouLedger(options.chosenForYou);

  const deferralsPort =
    options.deferrals === undefined
      ? undefined
      : isDeferralPort(options.deferrals)
        ? options.deferrals
        : bindBoundedDeferralPolicy(options.deferrals);

  const readinessPort =
    options.readiness === undefined
      ? undefined
      : isHonestReadiness(options.readiness)
        ? bindHonestReadinessCalculator(options.readiness)
        : isReadinessPort(options.readiness)
          ? options.readiness
          : bindReadinessCalculator(options.readiness);

  return {
    scheduler,
    presets,
    paperwork,
    impact,
    masterPlan,
    ...(chosenForYouPort === undefined ? {} : { chosenForYou: chosenForYouPort }),
    ...(deferralsPort === undefined ? {} : { deferrals: deferralsPort }),
    ...(readinessPort === undefined ? {} : { readiness: readinessPort }),
  };
}

export function defaultPlanPreviewSources(options: CreatePlanPreviewSourcesOptions = {}): PlanPreviewSources {
  return createPlanPreviewSources(options);
}
