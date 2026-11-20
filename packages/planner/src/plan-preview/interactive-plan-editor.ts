import { defaultPlanPreviewSources, type PlanPreviewSources } from "./local-ports.js";
import { PlanPreviewBuilder } from "./plan-preview-builder.js";
import { costMicroForLevel, rankOf } from "./schedule.js";
import type {
  BudgetCap,
  ChosenForYouEntry,
  CrewLevel,
  CrewPreset,
  PlanPreview,
  PlanPreviewRequest,
  PlannedTaskInput,
  ProjectedFeatureInput,
  SpendGuard,
} from "./types.js";

export interface EditOutcome {
  readonly ok: boolean;
  readonly message: string | null;
  readonly preview: PlanPreview;
  readonly elapsedMs: number;
  readonly llmCalls: 0;
}

export interface DelegatedOverrideRoute {
  readonly label: "Override";
  readonly route: "revision";
  readonly task: "Task-087";
  readonly decisionId: string;
  readonly criterionId: string;
  readonly optionId: string;
  readonly previousValue: string;
  readonly nextValue: string;
}

export interface DelegatedOverrideResult extends EditOutcome {
  readonly route: DelegatedOverrideRoute | null;
  readonly impactedTaskIds: readonly string[];
  readonly impactSummary: string | null;
}

export class InteractivePlanEditor {
  readonly llmCalls = 0 as const;
  private request: PlanPreviewRequest;
  private readonly builder: PlanPreviewBuilder;
  private readonly sources: PlanPreviewSources;

  constructor(request: PlanPreviewRequest, sources: PlanPreviewSources = defaultPlanPreviewSources()) {
    this.request = cloneRequest(request);
    this.sources = sources;
    this.builder = new PlanPreviewBuilder(sources);
  }

  preview(): PlanPreview {
    return this.builder.build(this.request);
  }

  switchPreset(preset: CrewPreset): EditOutcome {
    const started = performance.now();
    this.request = { ...this.request, preset };
    return this.finish(true, `Switched to ${preset}`, started);
  }

  overrideTaskTier(taskId: string, level: CrewLevel): EditOutcome {
    const started = performance.now();
    const task = this.request.tasks.find((item) => item.id === taskId);
    if (!task) return this.finish(false, `Unknown task ${taskId}`, started);
    const blocked = floorMessage(task, level);
    if (blocked) return this.finish(false, blocked, started);
    this.request = {
      ...this.request,
      levelOverrides: { ...this.request.levelOverrides, [taskId]: level },
    };
    return this.finish(true, `Assigned ${level} to ${task.title}`, started);
  }

  overrideFeatureTier(featureId: string, level: CrewLevel): EditOutcome {
    const started = performance.now();
    const tasks = this.request.tasks.filter((task) => task.featureId === featureId);
    if (tasks.length === 0) {
      return this.finish(false, `Feature ${featureId} has no compiled tasks to retier`, started);
    }
    for (const task of tasks) {
      const blocked = floorMessage(task, level);
      if (blocked) return this.finish(false, blocked, started);
    }
    const levelOverrides = { ...this.request.levelOverrides };
    for (const task of tasks) levelOverrides[task.id] = level;
    this.request = { ...this.request, levelOverrides };
    return this.finish(true, `Assigned ${level} to ${featureId}`, started);
  }

  reorderOptionalWave(featureId: string, priority: number): EditOutcome {
    const started = performance.now();
    const feature = this.request.projected.find((item) => item.featureId === featureId);
    if (!feature || feature.kind !== "feature" || feature.wave < 2) {
      return this.finish(false, "Only optional projected waves can be reordered", started);
    }
    if (!Number.isInteger(priority)) {
      return this.finish(false, "Wave priority must be an integer", started);
    }
    const next = { ...this.request.priorityOverrides, [featureId]: priority };
    const blocked = priorityConflict(this.request.projected, next, new Set(this.request.deferredFeatureIds));
    if (blocked) return this.finish(false, blocked, started);
    this.request = { ...this.request, priorityOverrides: next };
    return this.finish(true, `Reordered ${feature.title}`, started);
  }

  deferFeature(featureId: string): EditOutcome {
    return this.deferFeatures([featureId]);
  }

  deferFeatures(featureIds: readonly string[]): EditOutcome {
    const started = performance.now();
    const unique = [...new Set(featureIds)];
    if (unique.length === 0) return this.finish(false, "Choose a feature to defer", started);
    const projectedIds = new Set(this.request.projected.map((feature) => feature.featureId));
    for (const featureId of unique) {
      if (projectedIds.has(featureId)) continue;
      const compiled = this.request.tasks.some((task) => task.featureId === featureId);
      if (compiled) return this.finish(false, "Wave 1 compiled features stay in the plan", started);
      return this.finish(false, `Unknown feature ${featureId}`, started);
    }
    const already = new Set(this.request.deferredFeatureIds);
    const proposed = new Set([...already, ...unique]);
    for (const featureId of unique) {
      const feature = this.request.projected.find((item) => item.featureId === featureId);
      if (!feature) return this.finish(false, `Unknown feature ${featureId}`, started);
      const dependents = this.request.projected.filter(
        (item) => item.dependsOn.includes(featureId) && !proposed.has(item.featureId),
      );
      if (dependents.length > 0) {
        return this.finish(false, requiredByMessage(feature.title, dependents.map((item) => item.title)), started);
      }
    }
    this.request = { ...this.request, deferredFeatureIds: [...proposed] };
    const titles = unique.map((id) => this.request.projected.find((item) => item.featureId === id)?.title ?? id);
    return this.finish(true, `Deferred ${titles.join(" and ")} out of v1`, started);
  }

  setBudgetCap(cap: BudgetCap): EditOutcome {
    const started = performance.now();
    if (cap.connection !== this.request.connection) {
      return this.finish(false, "Budget cap connection does not match the plan", started);
    }
    this.request = { ...this.request, budgetCap: cap };
    return this.finish(true, "Updated budget cap", started);
  }

  setSpendGuard(guard: SpendGuard): EditOutcome {
    const started = performance.now();
    if (guard.connection !== this.request.connection) {
      return this.finish(false, "Spend guard connection does not match the plan", started);
    }
    this.request = { ...this.request, spendGuard: guard };
    return this.finish(true, "Updated spend guard", started);
  }

  overrideDelegatedChoice(input: {
    readonly criterionId: string;
    readonly optionId: string;
    readonly chosenValue: string;
    readonly impactedTaskIds: readonly string[];
  }): DelegatedOverrideResult {
    const started = performance.now();
    if (this.request.hiddenCriterionIds.includes(input.criterionId)) {
      const failed = this.finish(false, `${input.criterionId} was already overridden`, started);
      return { ...failed, route: null, impactedTaskIds: [], impactSummary: null };
    }
    const entry = this.ledger().find((item) => item.criterionId === input.criterionId);
    if (!entry) {
      const failed = this.finish(false, `Chosen for you has no ${input.criterionId}`, started);
      return { ...failed, route: null, impactedTaskIds: [], impactSummary: null };
    }
    const unknown = input.impactedTaskIds.filter((id) => !this.request.tasks.some((task) => task.id === id));
    if (unknown.length > 0) {
      const failed = this.finish(false, `Unknown impacted task ${unknown[0] ?? ""}`, started);
      return { ...failed, route: null, impactedTaskIds: [], impactSummary: null };
    }
    this.request = {
      ...this.request,
      hiddenCriterionIds: [...new Set([...this.request.hiddenCriterionIds, entry.criterionId])],
      pendingRevisionTaskIds: [...new Set([...this.request.pendingRevisionTaskIds, ...input.impactedTaskIds])],
      explicitOverrides: [
        ...this.request.explicitOverrides,
        {
          criterionId: entry.criterionId,
          criterionLabel: entry.criterionLabel,
          chosenValue: input.chosenValue,
          optionId: input.optionId,
          basis: "explicit",
          decisionId: entry.decisionId,
        },
      ],
    };
    const base = this.finish(true, `Override routed to Task 087`, started);
    const impactedTasks = this.request.tasks.filter((task) => input.impactedTaskIds.includes(task.id));
    let deltaCost = 0n;
    for (const task of impactedTasks) {
      const level = this.request.levelOverrides[task.id] ?? task.balancedLevel;
      deltaCost += costMicroForLevel(task.juniorCostMicroUsd, level);
    }
    const impactSummary = this.sources.impact.format({
      contractCount: 1,
      activeTasks: [],
      finishedTaskCount: impactedTasks.length,
      untouchedTaskCount: Math.max(0, this.request.tasks.length - impactedTasks.length),
      deltaTasks: impactedTasks.length,
      deltaCostMicroUsd: Number(deltaCost),
    });
    return {
      ...base,
      route: {
        label: "Override",
        route: "revision",
        task: "Task-087",
        decisionId: entry.decisionId,
        criterionId: entry.criterionId,
        optionId: input.optionId,
        previousValue: entry.chosenValue,
        nextValue: input.chosenValue,
      },
      impactedTaskIds: [...input.impactedTaskIds],
      impactSummary,
    };
  }

  private ledger(): readonly ChosenForYouEntry[] {
    return this.sources.chosenForYou ? this.sources.chosenForYou.forPlanPreview() : this.request.chosenForYou;
  }

  private finish(ok: boolean, message: string | null, started: number): EditOutcome {
    return {
      ok,
      message,
      preview: this.builder.build(this.request),
      elapsedMs: performance.now() - started,
      llmCalls: 0,
    };
  }
}

function floorMessage(task: PlannedTaskInput, level: CrewLevel): string | null {
  if (rankOf(level) >= rankOf(task.safetyFloor)) return null;
  return `Rejected: ${task.safetyFloor} safety floor (Task 106) — cannot assign ${level} to ${task.title}`;
}

function requiredByMessage(featureTitle: string, dependentTitles: readonly string[]): string {
  const first = dependentTitles[0];
  const second = dependentTitles[1];
  if (dependentTitles.length === 1 && first) {
    return `Required by ${first} — defer both or keep ${featureTitle}`;
  }
  if (dependentTitles.length === 2 && first && second) {
    return `Required by ${first} and ${second} — defer both or keep ${featureTitle}`;
  }
  return `Required by ${dependentTitles.join(", ")} — defer each dependent or keep ${featureTitle}`;
}

function priorityOf(feature: ProjectedFeatureInput, overrides: Readonly<Record<string, number>>): number {
  return overrides[feature.featureId] ?? feature.priority;
}

function priorityConflict(
  features: readonly ProjectedFeatureInput[],
  overrides: Readonly<Record<string, number>>,
  deferred: ReadonlySet<string>,
): string | null {
  for (const feature of features) {
    if (deferred.has(feature.featureId)) continue;
    for (const dependencyId of feature.dependsOn) {
      const dependency = features.find((item) => item.featureId === dependencyId);
      if (!dependency || deferred.has(dependency.featureId)) continue;
      if (priorityOf(feature, overrides) < priorityOf(dependency, overrides)) {
        return `Cannot schedule ${feature.title} before ${dependency.title}`;
      }
    }
  }
  return null;
}

function cloneTask(task: PlannedTaskInput): PlannedTaskInput {
  const copy: PlannedTaskInput = {
    id: task.id,
    title: task.title,
    featureId: task.featureId,
    featureTitle: task.featureTitle,
    phase: task.phase,
    writeScope: [...task.writeScope],
    balancedLevel: task.balancedLevel,
    safetyFloor: task.safetyFloor,
    criticalPath: task.criticalPath,
    juniorCostMicroUsd: task.juniorCostMicroUsd,
    juniorCostPpm: task.juniorCostPpm,
    durationMinutes: task.durationMinutes,
    dependsOn: [...task.dependsOn],
  };
  if (task.phase0Step) return { ...copy, phase0Step: task.phase0Step };
  return copy;
}

function cloneRequest(request: PlanPreviewRequest): PlanPreviewRequest {
  return {
    ...request,
    tasks: request.tasks.map(cloneTask),
    projected: request.projected.map((feature) => ({
      ...feature,
      dependsOn: [...feature.dependsOn],
      taskCount: { ...feature.taskCount },
      costMicroUsd: { ...feature.costMicroUsd },
      costPpm: { ...feature.costPpm },
      minutes: { ...feature.minutes },
    })),
    chosenForYou: request.chosenForYou.map((entry) =>
      entry.impactedTaskIds
        ? { ...entry, impactedTaskIds: [...entry.impactedTaskIds] }
        : { ...entry },
    ),
    deferred: request.deferred.map((item) => ({ ...item })),
    levelOverrides: { ...request.levelOverrides },
    deferredFeatureIds: [...request.deferredFeatureIds],
    priorityOverrides: { ...request.priorityOverrides },
    hiddenCriterionIds: [...request.hiddenCriterionIds],
    pendingRevisionTaskIds: [...request.pendingRevisionTaskIds],
    explicitOverrides: request.explicitOverrides.map((item) => ({ ...item })),
  };
}
