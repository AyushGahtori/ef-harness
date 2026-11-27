import { PHASE0_STEPS } from "./constants.js";
import { PlanPreviewError } from "./errors.js";
import { defaultPlanPreviewSources, type PlanPreviewSources } from "./local-ports.js";
import {
  honestPointLabel,
  honestRangeLabel,
  honestShortLabel,
  shortRangeLabel,
} from "./money.js";
import { costMicroForLevel, costPpmForLevel, durationForLevel, plannedWallClockLabel, projectedWallClockLabel, rankOf } from "./schedule.js";
import type {
  ChosenForYouEntry,
  ChosenForYouPreviewEntry,
  ConnectionKind,
  CrewLevel,
  DeferredItem,
  Phase0Step,
  PlanPreview,
  PlanPreviewRequest,
  PlannedTaskInput,
  PlannedTaskView,
  ProjectedFeatureInput,
  ProjectedFeatureView,
  ReadinessView,
  RevisionRoute,
} from "./types.js";

function route(label: "Change" | "Override", entry: ChosenForYouEntry): RevisionRoute {
  return {
    label,
    route: "revision",
    task: "Task-087",
    decisionId: entry.decisionId,
    criterionId: entry.criterionId,
  };
}

function assertRange(label: string, min: number, max: number): void {
  if (!Number.isInteger(min) || !Number.isInteger(max) || min < 0 || max < min) {
    throw new PlanPreviewError("inverted_range", `${label} needs an honest min–max range`);
  }
}

function assertBigRange(label: string, min: bigint, max: bigint): void {
  if (min < 0n || max < min) {
    throw new PlanPreviewError("inverted_range", `${label} needs an honest min–max range`);
  }
}

function isPhase0Step(value: string): value is Phase0Step {
  return (PHASE0_STEPS as readonly string[]).includes(value);
}

function projectedSummary(feature: ProjectedFeatureInput, connection: ConnectionKind, deferred: boolean): string {
  const waveLabel = feature.kind === "completion" ? "Completion Wave" : `Wave ${feature.wave.toString()}`;
  const cost = shortRangeLabel(
    connection,
    feature.costMicroUsd.min,
    feature.costMicroUsd.max,
    feature.costPpm.min,
    feature.costPpm.max,
  );
  const suffix = deferred ? " (deferred out of v1)" : " (planned in detail after Wave 1 finishes)";
  return `${waveLabel}: ${feature.title} — ~${feature.taskCount.min.toString()}–${feature.taskCount.max.toString()} tasks, ~${cost}${suffix}`;
}

function validateProjected(feature: ProjectedFeatureInput): void {
  if (feature.kind === "feature" && (!Number.isInteger(feature.wave) || feature.wave < 2)) {
    throw new PlanPreviewError("invalid_wave", `${feature.featureId} is projected and must be wave 2 or later`);
  }
  assertRange(feature.featureId, feature.taskCount.min, feature.taskCount.max);
  assertRange(`${feature.featureId} minutes`, feature.minutes.min, feature.minutes.max);
  assertRange(`${feature.featureId} ppm`, feature.costPpm.min, feature.costPpm.max);
  assertBigRange(feature.featureId, feature.costMicroUsd.min, feature.costMicroUsd.max);
}

export class PlanPreviewBuilder {
  constructor(private readonly sources: PlanPreviewSources = defaultPlanPreviewSources()) {}

  build(request: PlanPreviewRequest): PlanPreview {
    const tasks = this.compileTasks(request);
    const levels = new Map(this.sources.presets.apply(request.preset, tasks).map((row) => [row.id, row.crewLevel]));
    const views = tasks.map((task) => this.toPlannedTask(request, task, levels));
    const resolved = tasks.map((task) => {
      const override = request.levelOverrides[task.id];
      const presetLevel = levels.get(task.id);
      if (!presetLevel) throw new PlanPreviewError("unknown_task", `Missing crew level for ${task.id}`);
      return { task, level: override ?? presetLevel };
    });
    const schedule = this.sources.scheduler.schedule({
      tasks: resolved.map(({ task, level }) => ({
        id: task.id,
        durationMinutes: durationForLevel(task.durationMinutes, level),
        dependsOn: task.dependsOn,
      })),
      preset: request.preset,
      widthCap: request.widthCap,
    });
    const plannedMicro = resolved.reduce(
      (sum, item) => sum + costMicroForLevel(item.task.juniorCostMicroUsd, item.level),
      0n,
    );
    const plannedPpm = resolved.reduce(
      (sum, item) => sum + costPpmForLevel(item.task.juniorCostPpm, item.level),
      0,
    );
    const projected = this.projectFeatures(request);
    const waves = projected.filter((feature) => feature.kind === "feature" && !feature.deferredOutOfV1);
    const completion = projected.find((feature) => feature.kind === "completion" && !feature.deferredOutOfV1) ?? null;
    const deferredOut = projected.filter((feature) => feature.deferredOutOfV1);
    const projectedMicro = sumBig(waves.map((feature) => requestProjectedCost(request, feature.featureId)));
    const projectedPpm = sumNum(waves.map((feature) => requestProjectedPpm(request, feature.featureId)));
    const minuteMin = waves.reduce((sum, feature) => sum + feature.minutes.min, 0);
    const minuteMax = waves.reduce((sum, feature) => sum + feature.minutes.max, 0);
    const chosen = this.chosenForYou(request);
    const deferred = this.deferred(request);
    const readiness = this.readiness(request, chosen.count, deferred.length);
    const budgetUnits = request.connection === "api" ? request.totalBudgetMicroUsd : BigInt(request.totalBudgetPpm);
    const paperwork = this.sources.paperwork.allocate(budgetUnits, request.connection);
    const guard = guardStatus(request, plannedMicro, plannedPpm, projectedMicro.high, projectedPpm.high);
    const       projectedCostLabel =
      waves.length === 0
        ? null
        : honestRangeLabel(request.connection, projectedMicro.low, projectedMicro.high, projectedPpm.low, projectedPpm.high);

    return {
      projectId: request.projectId,
      workItemId: request.workItemId,
      revision: request.revision,
      connection: request.connection,
      preset: request.preset,
      llmCalls: 0,
      startBuild: { label: "Start build", requiresExplicitClick: true, autoStart: false },
      costLabel: honestPointLabel(request.connection, plannedMicro, plannedPpm),
      plannedCostLabel: honestShortLabel(request.connection, plannedMicro, plannedPpm),
      projectedCostLabel,
      wallClockLabel: plannedWallClockLabel(schedule),
      projectedWallClockLabel:
        waves.length === 0 ? null : projectedWallClockLabel(minuteMin, minuteMax, schedule.peakWorkers || 1),
      phase0: {
        precision: "exact",
        steps: PHASE0_STEPS.map((step) => ({
          step,
          tasks: views.filter((task) => task.phase0Step === step),
        })),
        tasks: views.filter((task) => task.phase === "phase0"),
      },
      wave1: {
        precision: "exact",
        tasks: views.filter((task) => task.phase === "wave1"),
      },
      projected: {
        label: "Projected",
        precision: "range",
        waves,
        completion,
      },
      deferredOutOfV1: deferredOut,
      paperwork,
      chosenForYou: chosen,
      deferred,
      readiness,
      heft: schedule,
      crewCounts: countLevels(views),
      guard,
      explicitOverrides: request.explicitOverrides,
    };
  }

  private compileTasks(request: PlanPreviewRequest): PlannedTaskInput[] {
    const seen = new Set<string>();
    for (const task of request.tasks) {
      if (seen.has(task.id)) throw new PlanPreviewError("duplicate_task", `Duplicate task ${task.id}`);
      seen.add(task.id);
      if (task.juniorCostMicroUsd < 0n || task.juniorCostPpm < 0 || task.durationMinutes <= 0) {
        throw new PlanPreviewError("invalid_task", `${task.id} has an invalid cost or duration`);
      }
      if (task.phase === "phase0") {
        if (!task.phase0Step || !isPhase0Step(task.phase0Step)) {
          throw new PlanPreviewError("missing_phase_step", `${task.id} must name a P0.1–P0.8 step`);
        }
      } else if (task.phase0Step) {
        throw new PlanPreviewError("invalid_wave", `${task.id} is Wave 1 and cannot carry a Phase 0 step`);
      }
    }
    for (const feature of request.projected) validateProjected(feature);
    return [...request.tasks];
  }

  private toPlannedTask(
    request: PlanPreviewRequest,
    task: PlannedTaskInput,
    levels: ReadonlyMap<string, CrewLevel>,
  ): PlannedTaskView {
    const presetLevel = levels.get(task.id);
    if (!presetLevel) throw new PlanPreviewError("unknown_task", `Missing crew level for ${task.id}`);
    const override = request.levelOverrides[task.id];
    const crewLevel = override ?? presetLevel;
    if (rankOf(crewLevel) < rankOf(task.safetyFloor)) {
      throw new PlanPreviewError(
        "safety_floor",
        `Rejected: ${task.safetyFloor} safety floor (Task 106) — cannot assign ${crewLevel} to ${task.title}`,
      );
    }
    const micro = costMicroForLevel(task.juniorCostMicroUsd, crewLevel);
    const ppm = costPpmForLevel(task.juniorCostPpm, crewLevel);
    return {
      id: task.id,
      title: task.title,
      featureId: task.featureId,
      featureTitle: task.featureTitle,
      phase: task.phase,
      phase0Step: task.phase === "phase0" ? (task.phase0Step ?? null) : null,
      wave: task.phase === "phase0" ? 0 : 1,
      crewLevel,
      writeScope: [...task.writeScope],
      criticalPath: task.criticalPath,
      safetyFloor: task.safetyFloor,
      durationMinutes: durationForLevel(task.durationMinutes, crewLevel),
      precision: "exact",
      pendingRevision: request.pendingRevisionTaskIds.includes(task.id),
      costLabel: honestShortLabel(request.connection, micro, ppm),
      microUsd: request.connection === "api" ? micro : null,
      windowPpm: request.connection === "subscription" ? ppm : null,
    };
  }

  private projectFeatures(request: PlanPreviewRequest): ProjectedFeatureView[] {
    const deferred = new Set(request.deferredFeatureIds);
    const features = request.projected.map((feature) => {
      const priority = request.priorityOverrides[feature.featureId] ?? feature.priority;
      const isDeferred = deferred.has(feature.featureId);
      return {
        featureId: feature.featureId,
        title: feature.title,
        kind: feature.kind,
        wave: feature.wave,
        label: "Projected" as const,
        precision: "range" as const,
        summary: projectedSummary(feature, request.connection, isDeferred),
        taskCount: { min: feature.taskCount.min, max: feature.taskCount.max },
        minutes: { min: feature.minutes.min, max: feature.minutes.max },
        costLabel: shortRangeLabel(
          request.connection,
          feature.costMicroUsd.min,
          feature.costMicroUsd.max,
          feature.costPpm.min,
          feature.costPpm.max,
        ),
        dependsOn: [...feature.dependsOn],
        optional: feature.optional,
        priority,
        deferredOutOfV1: isDeferred,
      };
    });
    features.sort((left, right) => {
      if (left.kind !== right.kind) return left.kind === "completion" ? 1 : -1;
      if (left.priority !== right.priority) return left.priority - right.priority;
      return left.featureId.localeCompare(right.featureId);
    });
    return features;
  }

  private chosenForYou(request: PlanPreviewRequest) {
    const hidden = new Set(request.hiddenCriterionIds);
    const source = this.sources.chosenForYou
      ? this.sources.chosenForYou.forPlanPreview()
      : request.chosenForYou;
    const entries: ChosenForYouPreviewEntry[] = source
      .filter((entry) => !hidden.has(entry.criterionId))
      .filter((entry) => entry.basis === "delegated" || entry.basis === "defaulted")
      .map((entry) => ({
        criterionId: entry.criterionId,
        criterionLabel: entry.criterionLabel,
        chosenValue: entry.chosenValue,
        optionId: entry.optionId,
        basis: entry.basis,
        rationale: entry.rationale,
        impactLevel: entry.impactLevel,
        downstreamTaskCount: entry.downstreamTaskCount,
        decisionId: entry.decisionId,
        ...(entry.impactedTaskIds ? { impactedTaskIds: [...entry.impactedTaskIds] } : {}),
        change: route("Change", entry),
        override: route("Override", entry),
        visibleBeforeStartBuild: true as const,
      }));
    const noun = entries.length === 1 ? "choice" : "choices";
    return {
      count: entries.length,
      clickable: true as const,
      visibleBeforeStartBuild: true as const,
      watchLabel: `⚑ ${entries.length.toString()} ${noun} made for you`,
      entries,
    };
  }

  private deferred(request: PlanPreviewRequest): readonly DeferredItem[] {
    const source = this.sources.deferrals
      ? this.sources.deferrals.listDeferred(request.workItemId)
      : request.deferred;
    return source.map((item) => ({
      decisionId: item.decisionId,
      criterionId: item.criterionId,
      label: item.label,
      deferredReason: item.deferredReason,
      revisitWave: item.revisitWave,
    }));
  }

  private readiness(request: PlanPreviewRequest, chosenCount: number, deferredCount: number): ReadinessView {
    if (this.sources.readiness) return this.sources.readiness.project(request.workItemId);
    if (request.readiness) return request.readiness;
    return {
      isReadyToPlan: true,
      headline: "Ready for plan preview",
      counts: {
        chosenForYou: chosenCount,
        deferred: deferredCount,
        conflict: 0,
        openMustAsk: 0,
        settledTotal: chosenCount,
      },
    };
  }
}

function countLevels(tasks: readonly PlannedTaskView[]): Record<CrewLevel, number> {
  const counts: Record<CrewLevel, number> = { Junior: 0, Mid: 0, Senior: 0 };
  for (const task of tasks) counts[task.crewLevel] += 1;
  return counts;
}

function requestProjectedCost(request: PlanPreviewRequest, featureId: string): { low: bigint; high: bigint } {
  const feature = request.projected.find((item) => item.featureId === featureId);
  return { low: feature?.costMicroUsd.min ?? 0n, high: feature?.costMicroUsd.max ?? 0n };
}

function requestProjectedPpm(request: PlanPreviewRequest, featureId: string): { low: number; high: number } {
  const feature = request.projected.find((item) => item.featureId === featureId);
  return { low: feature?.costPpm.min ?? 0, high: feature?.costPpm.max ?? 0 };
}

function sumBig(parts: readonly { low: bigint; high: bigint }[]): { low: bigint; high: bigint } {
  return parts.reduce((sum, part) => ({ low: sum.low + part.low, high: sum.high + part.high }), {
    low: 0n,
    high: 0n,
  });
}

function sumNum(parts: readonly { low: number; high: number }[]): { low: number; high: number } {
  return parts.reduce((sum, part) => ({ low: sum.low + part.low, high: sum.high + part.high }), { low: 0, high: 0 });
}

function guardStatus(
  request: PlanPreviewRequest,
  plannedMicro: bigint,
  plannedPpm: number,
  projectedHighMicro: bigint,
  projectedHighPpm: number,
) {
  const cap = request.budgetCap;
  const guard = request.spendGuard;
  if (cap && cap.connection !== request.connection) {
    throw new PlanPreviewError("connection_mismatch", "Budget cap connection does not match the plan");
  }
  if (guard && guard.connection !== request.connection) {
    throw new PlanPreviewError("connection_mismatch", "Spend guard connection does not match the plan");
  }
  let plannedExceedsCap = false;
  let projectedHighExceedsCap = false;
  let spendGuardTripped = false;
  if (cap?.connection === "api") {
    plannedExceedsCap = plannedMicro > cap.microUsd;
    projectedHighExceedsCap = plannedMicro + projectedHighMicro > cap.microUsd;
  } else if (cap?.connection === "subscription") {
    plannedExceedsCap = plannedPpm > cap.windowPpm;
    projectedHighExceedsCap = plannedPpm + projectedHighPpm > cap.windowPpm;
  }
  if (guard?.connection === "api") spendGuardTripped = plannedMicro > guard.haltMicroUsd;
  if (guard?.connection === "subscription") spendGuardTripped = plannedPpm > guard.haltWindowPpm;
  const messages: string[] = [];
  if (plannedExceedsCap || projectedHighExceedsCap) messages.push("Budget cap: projected high end exceeds the cap");
  if (spendGuardTripped) messages.push("Spend guard: planned cost exceeds the halt cap");
  return {
    budgetCap: cap,
    spendGuard: guard,
    plannedExceedsCap,
    projectedHighExceedsCap,
    spendGuardTripped,
    message: messages.length === 0 ? null : messages.join(" · "),
  };
}
