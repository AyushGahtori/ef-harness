import {
  CREW_PRESETS,
  WORKER_TIERS,
  isCrewPreset,
  isWorkerTier,
  normalizeCrewPreset,
  normalizeWorkerTier,
  type CrewPreset,
  type WorkerTier,
} from "@ef-harness/shared-contracts";
import { PHASE0_STEPS } from "./constants.js";
import { PlanPreviewError } from "./errors.js";

export {
  CREW_PRESETS,
  WORKER_TIERS,
  isCrewPreset,
  isWorkerTier,
  normalizeCrewPreset,
  normalizeWorkerTier,
};
export type { CrewPreset, WorkerTier };

export type Phase0Step = (typeof PHASE0_STEPS)[number];
export type CrewLevel = WorkerTier;
export type CrewLevelInput =
  | CrewLevel
  | "junior"
  | "mid"
  | "senior"
  | "principal"
  | "jr"
  | "sr"
  | "manager";
export type CrewPresetInput =
  | CrewPreset
  | "fastest"
  | "balanced"
  | "cheapest"
  | "budget"
  | "thorough";

export function coercePlanPreviewLevel(value: string): CrewLevel {
  const normalized = normalizeWorkerTier(value);
  if (normalized === undefined) {
    throw new PlanPreviewError("invalid_tier", `Unknown worker tier: ${value}`);
  }
  return normalized;
}

export function coercePlanPreviewPreset(value: string): CrewPreset {
  const normalized = normalizeCrewPreset(value);
  if (normalized === undefined) {
    throw new PlanPreviewError("invalid_preset", `Unknown crew preset: ${value}`);
  }
  return normalized;
}

export type ConnectionKind = "api" | "subscription";
export type DecisionBasis = "delegated" | "defaulted";
export type ImpactLevel = "critical" | "high" | "medium" | "low";
export type PaperworkEnvelopeId =
  | "research"
  | "architecture"
  | "planning"
  | "integration_review"
  | "final_audit";

export type ExternalEffect =
  | "push"
  | "pull_request"
  | "deploy"
  | "live_webhook"
  | "live_email"
  | "secret_mutation";

export type DestructiveMigrationKind = "drop" | "alter_narrowing" | "data_delete" | "rename_column";

export type HardStopTrigger =
  | "must_ask"
  | "conflict"
  | "breaking_contract"
  | "destructive_migration"
  | "new_dependency"
  | "external_effect";

export interface InclusiveRange {
  readonly min: number;
  readonly max: number;
}

export interface InclusiveBigRange {
  readonly min: bigint;
  readonly max: bigint;
}

export interface PlannedTaskInput {
  readonly id: string;
  readonly title: string;
  readonly featureId: string;
  readonly featureTitle: string;
  readonly phase: "phase0" | "wave1";
  readonly phase0Step?: Phase0Step;
  readonly writeScope: readonly string[];
  readonly balancedLevel: CrewLevel;
  readonly safetyFloor: CrewLevel;
  readonly criticalPath: boolean;
  readonly juniorCostMicroUsd: bigint;
  readonly juniorCostPpm: number;
  readonly durationMinutes: number;
  readonly dependsOn: readonly string[];
}

export interface ProjectedFeatureInput {
  readonly featureId: string;
  readonly title: string;
  readonly kind: "feature" | "completion";
  readonly wave: number;
  readonly taskCount: InclusiveRange;
  readonly costMicroUsd: InclusiveBigRange;
  readonly costPpm: InclusiveRange;
  readonly minutes: InclusiveRange;
  readonly dependsOn: readonly string[];
  readonly optional: boolean;
  readonly priority: number;
}

export interface ChosenForYouEntry {
  readonly criterionId: string;
  readonly criterionLabel: string;
  readonly chosenValue: string;
  readonly optionId: string;
  readonly basis: DecisionBasis;
  readonly rationale: string;
  readonly impactLevel: ImpactLevel;
  readonly downstreamTaskCount: number;
  readonly decisionId: string;
  readonly impactedTaskIds?: readonly string[];
}

export interface DeferredItem {
  readonly decisionId: string;
  readonly criterionId: string;
  readonly label: string;
  readonly deferredReason: string;
  readonly revisitWave: string;
}

export interface ReadinessCountsView {
  readonly chosenForYou: number;
  readonly deferred: number;
  readonly conflict: number;
  readonly openMustAsk: number;
  readonly settledTotal: number;
}

export interface ReadinessView {
  readonly isReadyToPlan: boolean;
  readonly headline: string;
  readonly counts: ReadinessCountsView;
}

export type BudgetCap =
  | { readonly connection: "api"; readonly microUsd: bigint }
  | { readonly connection: "subscription"; readonly windowPpm: number };

export type SpendGuard =
  | { readonly connection: "api"; readonly haltMicroUsd: bigint }
  | { readonly connection: "subscription"; readonly haltWindowPpm: number };

export interface PlanPreviewRequest {
  readonly projectId: string;
  readonly workItemId: string;
  readonly revision: number;
  readonly connection: ConnectionKind;
  readonly preset: CrewPreset;
  readonly totalBudgetMicroUsd: bigint;
  readonly totalBudgetPpm: number;
  readonly tasks: readonly PlannedTaskInput[];
  readonly projected: readonly ProjectedFeatureInput[];
  readonly chosenForYou: readonly ChosenForYouEntry[];
  readonly deferred: readonly DeferredItem[];
  readonly widthCap: number | null;
  readonly levelOverrides: Readonly<Record<string, CrewLevel>>;
  readonly deferredFeatureIds: readonly string[];
  readonly priorityOverrides: Readonly<Record<string, number>>;
  readonly budgetCap: BudgetCap | null;
  readonly spendGuard: SpendGuard | null;
  readonly hiddenCriterionIds: readonly string[];
  readonly pendingRevisionTaskIds: readonly string[];
  readonly readiness: ReadinessView | null;
  readonly explicitOverrides: readonly ExplicitOverride[];
}

export interface ExplicitOverride {
  readonly criterionId: string;
  readonly criterionLabel: string;
  readonly chosenValue: string;
  readonly optionId: string;
  readonly basis: "explicit";
  readonly decisionId: string;
}

export interface PlanRequestInit {
  readonly projectId: string;
  readonly connection: ConnectionKind;
  readonly tasks: readonly PlannedTaskInput[];
  readonly totalBudgetMicroUsd: bigint;
  readonly totalBudgetPpm: number;
  readonly workItemId?: string;
  readonly revision?: number;
  readonly preset?: CrewPreset | CrewPresetInput;
  readonly projected?: readonly ProjectedFeatureInput[];
  readonly chosenForYou?: readonly ChosenForYouEntry[];
  readonly deferred?: readonly DeferredItem[];
  readonly widthCap?: number | null;
  readonly levelOverrides?: Readonly<Record<string, CrewLevel | CrewLevelInput>>;
  readonly deferredFeatureIds?: readonly string[];
  readonly priorityOverrides?: Readonly<Record<string, number>>;
  readonly budgetCap?: BudgetCap | null;
  readonly spendGuard?: SpendGuard | null;
  readonly hiddenCriterionIds?: readonly string[];
  readonly pendingRevisionTaskIds?: readonly string[];
  readonly readiness?: ReadinessView | null;
  readonly explicitOverrides?: readonly ExplicitOverride[];
}

export function createPlanRequest(init: PlanRequestInit): PlanPreviewRequest {
  const normalizedOverrides: Record<string, CrewLevel> = {};
  if (init.levelOverrides) {
    for (const [taskId, level] of Object.entries(init.levelOverrides)) {
      normalizedOverrides[taskId] = coercePlanPreviewLevel(level);
    }
  }
  return {
    projectId: init.projectId,
    workItemId: init.workItemId ?? init.projectId,
    revision: init.revision ?? 1,
    connection: init.connection,
    preset: init.preset === undefined ? "Balanced" : coercePlanPreviewPreset(init.preset),
    totalBudgetMicroUsd: init.totalBudgetMicroUsd,
    totalBudgetPpm: init.totalBudgetPpm,
    tasks: init.tasks.map((task) => ({
      ...task,
      balancedLevel: coercePlanPreviewLevel(task.balancedLevel),
      safetyFloor: coercePlanPreviewLevel(task.safetyFloor),
    })),
    projected: init.projected ?? [],
    chosenForYou: init.chosenForYou ?? [],
    deferred: init.deferred ?? [],
    widthCap: init.widthCap ?? null,
    levelOverrides: normalizedOverrides,
    deferredFeatureIds: init.deferredFeatureIds ?? [],
    priorityOverrides: init.priorityOverrides ?? {},
    budgetCap: init.budgetCap ?? null,
    spendGuard: init.spendGuard ?? null,
    hiddenCriterionIds: init.hiddenCriterionIds ?? [],
    pendingRevisionTaskIds: init.pendingRevisionTaskIds ?? [],
    readiness: init.readiness ?? null,
    explicitOverrides: init.explicitOverrides ?? [],
  };
}

export interface RevisionRoute {
  readonly label: "Change" | "Override";
  readonly route: "revision";
  readonly task: "Task-087";
  readonly decisionId: string;
  readonly criterionId: string;
}

export interface ChosenForYouPreviewEntry extends ChosenForYouEntry {
  readonly change: RevisionRoute;
  readonly override: RevisionRoute;
  readonly visibleBeforeStartBuild: true;
}

export interface ChosenForYouView {
  readonly count: number;
  readonly clickable: true;
  readonly visibleBeforeStartBuild: true;
  readonly watchLabel: string;
  readonly entries: readonly ChosenForYouPreviewEntry[];
}

export interface PlannedTaskView {
  readonly id: string;
  readonly title: string;
  readonly featureId: string;
  readonly featureTitle: string;
  readonly phase: "phase0" | "wave1";
  readonly phase0Step: Phase0Step | null;
  readonly wave: 0 | 1;
  readonly crewLevel: CrewLevel;
  readonly modelId?: string;
  readonly writeScope: readonly string[];
  readonly criticalPath: boolean;
  readonly safetyFloor: CrewLevel;
  readonly durationMinutes: number;
  readonly precision: "exact";
  readonly pendingRevision: boolean;
  readonly costLabel: string;
  readonly microUsd: bigint | null;
  readonly windowPpm: number | null;
}

export interface Phase0StepView {
  readonly step: Phase0Step;
  readonly tasks: readonly PlannedTaskView[];
}

export interface ProjectedFeatureView {
  readonly featureId: string;
  readonly title: string;
  readonly kind: "feature" | "completion";
  readonly wave: number;
  readonly label: "Projected";
  readonly precision: "range";
  readonly summary: string;
  readonly taskCount: InclusiveRange;
  readonly minutes: InclusiveRange;
  readonly costLabel: string;
  readonly dependsOn: readonly string[];
  readonly optional: boolean;
  readonly priority: number;
  readonly deferredOutOfV1: boolean;
}

export interface PaperworkEnvelopeView {
  readonly id: PaperworkEnvelopeId;
  readonly label: string;
  readonly percentLabel: string;
  readonly ppm: number;
  readonly reservedLabel: string;
  readonly reservedUnits: bigint;
}

export interface PaperworkView {
  readonly line: string;
  readonly capPpm: 200_000;
  readonly allocatedPpm: number;
  readonly withinCap: true;
  readonly envelopes: readonly PaperworkEnvelopeView[];
}

export interface ActiveSlotSample {
  readonly atMinute: number;
  readonly activeSlots: number;
}

export interface HeftSchedule {
  readonly criticalPathMinutes: number;
  readonly parallelSpeedupFactor: number;
  readonly activeSlotsByTime: readonly ActiveSlotSample[];
  readonly sequentialMinutes: number;
  readonly peakWorkers: number;
}

export interface GuardStatus {
  readonly budgetCap: BudgetCap | null;
  readonly spendGuard: SpendGuard | null;
  readonly plannedExceedsCap: boolean;
  readonly projectedHighExceedsCap: boolean;
  readonly spendGuardTripped: boolean;
  readonly message: string | null;
}

export interface PlanPreview {
  readonly projectId: string;
  readonly workItemId: string;
  readonly revision: number;
  readonly connection: ConnectionKind;
  readonly preset: CrewPreset;
  readonly llmCalls: 0;
  readonly startBuild: {
    readonly label: "Start build";
    readonly requiresExplicitClick: true;
    readonly autoStart: false;
  };
  readonly costLabel: string;
  readonly plannedCostLabel: string;
  readonly projectedCostLabel: string | null;
  readonly wallClockLabel: string;
  readonly projectedWallClockLabel: string | null;
  readonly phase0: {
    readonly precision: "exact";
    readonly steps: readonly Phase0StepView[];
    readonly tasks: readonly PlannedTaskView[];
  };
  readonly wave1: {
    readonly precision: "exact";
    readonly tasks: readonly PlannedTaskView[];
  };
  readonly projected: {
    readonly label: "Projected";
    readonly precision: "range";
    readonly waves: readonly ProjectedFeatureView[];
    readonly completion: ProjectedFeatureView | null;
  };
  readonly deferredOutOfV1: readonly ProjectedFeatureView[];
  readonly paperwork: PaperworkView;
  readonly chosenForYou: ChosenForYouView;
  readonly deferred: readonly DeferredItem[];
  readonly readiness: ReadinessView;
  readonly heft: HeftSchedule;
  readonly crewCounts: Readonly<Record<CrewLevel, number>>;
  readonly guard: GuardStatus;
  readonly explicitOverrides: readonly ExplicitOverride[];
}

export interface ImpactPreviewInput {
  readonly contractCount: number;
  readonly activeTasks: readonly { readonly id?: string; readonly title: string }[];
  readonly finishedTaskCount: number;
  readonly untouchedTaskCount: number;
  readonly deltaTasks: number;
  readonly deltaCostMicroUsd: number;
}

export interface AutoStartSettings {
  readonly deltaTasksCeiling: number;
  readonly deltaCostCeilingMicroUsd: bigint;
  readonly deltaWindowCeilingPpm: number;
  readonly dailyCapMicroUsd: bigint;
  readonly dailyWindowCapPpm: number;
}

export interface AutoStartHistoryEntry {
  readonly atMs: number;
  readonly costMicroUsd: bigint;
  readonly windowPpm: number;
}

export interface RevisionCandidate {
  readonly revisionId: string;
  readonly isFirstBuild: boolean;
  readonly connection: ConnectionKind;
  readonly deltaTasks: number;
  readonly deltaCostMicroUsd: bigint;
  readonly deltaPlanWindowPpm: number;
  readonly planWindowPpm: number;
  readonly nowMs: number;
  readonly unresolvedMustAsk: boolean;
  readonly unresolvedConflict: boolean;
  readonly breakingContract: boolean;
  readonly destructiveMigration: DestructiveMigrationKind | null;
  readonly newPackages: readonly string[];
  readonly externalEffects: readonly ExternalEffect[];
}

export interface BuildCockpitEntry {
  readonly surface: "build-cockpit";
  readonly kind: "auto_start";
  readonly banner: string;
  readonly revisionId: string;
  readonly taskCount: number;
  readonly costLabel: string;
  readonly openedAtMs: number;
  readonly undoWindowMs: number;
  readonly pauseAffordanceMs: number;
}

export interface AutoStartToast {
  readonly id: string;
  readonly banner: string;
  readonly revisionId: string;
  readonly taskCount: number;
  readonly costLabel: string;
  readonly openedAtMs: number;
  readonly pauseUntilMs: number;
  readonly undoUntilMs: number;
  readonly undoWindowMs: number;
  readonly pauseAffordanceMs: number;
  readonly timeline: BuildCockpitEntry;
}

export interface PlanSnapshot {
  readonly taskCount: number;
  readonly costMicroUsd: bigint;
  readonly windowPpm: number;
  readonly dependencies: readonly string[];
  readonly connection: ConnectionKind;
}

export interface PlanDelta {
  readonly headline: "Before → After Plan Delta";
  readonly taskDeltaLabel: string;
  readonly reverifiedLabel: string;
  readonly costDeltaLabel: string;
  readonly dependencyNotes: readonly string[];
  readonly approvalReason: string;
  readonly lines: readonly string[];
}

export interface AutoStartDecision {
  readonly autoStart: boolean;
  readonly openPlanPreview: boolean;
  readonly explicitConfirmationRequired: boolean;
  readonly approvalReason: string | null;
  readonly reasons: readonly string[];
  readonly triggers: readonly HardStopTrigger[];
  readonly toast: AutoStartToast | null;
  readonly planDelta: PlanDelta | null;
}

export type GraceStatus = "pending" | "paused" | "cancelled" | "reviewing" | "started";

export interface GraceAction {
  readonly ok: boolean;
  readonly status: GraceStatus;
  readonly message: string;
  readonly openPlanPreview: boolean;
}
