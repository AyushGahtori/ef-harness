export const CREW_LEVELS = ["junior", "mid", "senior", "principal"] as const;
export type CrewLevel = (typeof CREW_LEVELS)[number];

export const CREW_PRESETS = ["Fastest", "Balanced", "Cheapest"] as const;
export type CrewPreset = (typeof CREW_PRESETS)[number];

export const DIFFICULTIES = ["trivial", "standard", "complex", "critical"] as const;
export type DifficultyTier = (typeof DIFFICULTIES)[number];

export const GOVERNOR_PRESSURES = ["Green", "Yellow", "Orange"] as const;
export type GovernorPressure = (typeof GOVERNOR_PRESSURES)[number];

export const HOLD_REASONS = ["user_pause", "requirement_change", "budget", "ccr", "governor"] as const;
export type HoldReason = (typeof HOLD_REASONS)[number];

export const CLAIM_REFUSAL_REASONS = [
  "not_ready",
  "held",
  "dependency_open",
  "brief_stale",
  "sweep_overlap",
  "lost_race",
] as const;
export type ClaimRefusalReason = (typeof CLAIM_REFUSAL_REASONS)[number];

/** 30 min. Explicit work outranks optional polish without crossing the critical-path band. */
export const EXPLICIT_BOOST_MS = 30 * 60_000;
/** 1 min per dispatch a ready task is skipped. Monotonic, so ties cannot starve. */
export const AGE_MS_PER_SKIP = 60_000;
/** 5 min. Cheapest groups same-feature siblings whose upward ranks are close. */
export const CACHE_BONUS_MS = 5 * 60_000;

/** planning-and-crew.md kitchen illustration: Balanced peaks at 5, Cheapest at 3. */
export const BALANCED_PRESET_CAP = 5;
export const CHEAPEST_PRESET_CAP = 3;

export const SEQUENTIAL_CHAIN_REASON = "Sequential dependency chain — 1 worker active";
export const WAITING_FOR_RESET_REASON = "Waiting for reset / Switch connection";

export const MS_PER_MINUTE = 60_000;

export interface ScheduleEdge {
  readonly to: string;
  readonly commDelayMs: number;
}

export interface ScheduleTask {
  readonly id: string;
  readonly featureId: string;
  readonly featureSlug: string;
  readonly waveIndex: number;
  readonly writeScope: readonly string[];
  readonly avgExecTimeMs: number;
  readonly successors: readonly ScheduleEdge[];
  readonly explicit: boolean;
  readonly optionalPolish: boolean;
  readonly difficulty: DifficultyTier;
  readonly riskTags: readonly string[];
  readonly role: string | null;
  readonly hintStep: number;
  readonly briefVersion: number;
  readonly baseCommit: string;
}

export interface ScheduleGraph {
  readonly tasks: readonly ScheduleTask[];
}

export interface RankTable {
  readonly order: readonly string[];
  readonly rankUMs: ReadonlyMap<string, number>;
  readonly earliestStartMs: ReadonlyMap<string, number>;
  readonly criticalPathMs: number;
  readonly criticalTaskIds: readonly string[];
  readonly onCriticalPath: ReadonlySet<string>;
}

export interface TaskHoldRecord {
  readonly taskId: string;
  readonly reason: HoldReason;
  readonly source: string;
  readonly createdAtMs: number;
}

export interface PathLeaseView {
  readonly id: string;
  readonly holder: string;
  readonly mode: "intent" | "granted";
  readonly prefixes: readonly string[];
}

export interface ProviderConnection {
  readonly id: string;
  readonly kind: "subscription" | "paid_api";
  readonly throttled: boolean;
  readonly allowanceExhausted: boolean;
  readonly authorized: boolean;
  readonly pacingSlots: number;
}

export interface InFlightTurn {
  readonly taskId: string;
  readonly featureId: string;
  readonly featureSlug: string;
  readonly attemptId: string;
  readonly connectionId: string;
  readonly level: CrewLevel;
  readonly presetAtClaim: CrewPreset;
  readonly startedAtMs: number;
  readonly execTimeMs: number;
  readonly writeScope: readonly string[];
  readonly waveIndex: number;
}

export interface LiveScheduleState {
  readonly graph: ScheduleGraph;
  readonly preset: CrewPreset;
  readonly completedTaskIds: readonly string[];
  readonly holds: readonly TaskHoldRecord[];
  readonly inFlight: readonly InFlightTurn[];
  readonly pathLeases: readonly PathLeaseView[];
  readonly connections: readonly ProviderConnection[];
  readonly paidFallbackApproved: boolean;
  readonly governorPressure: GovernorPressure;
  readonly hardwarePoolCap: number;
  readonly worktreeSlotCap: number;
  readonly developerMax: number | null;
  readonly skippedRounds: Readonly<Record<string, number>>;
  readonly readySinceMs: Readonly<Record<string, number>>;
  readonly nowMs: number;
  readonly execTimeOverrideMs: Readonly<Record<string, number>>;
  readonly hintOverride: Readonly<Record<string, number>>;
  readonly parkedReason: string | null;
  readonly attemptSerial: number;
  readonly lastDispatchedFeatureId: string | null;
}

export interface LevelSelectionRequest {
  readonly task: ScheduleTask;
  readonly preset: CrewPreset;
  readonly onCriticalPath: boolean;
  readonly hintStep: number;
}

export interface LevelSelection {
  readonly level: CrewLevel;
  readonly expectedCostMicroUsd: number;
  readonly passProbability: number;
  readonly safetyFloor: CrewLevel;
  readonly rationale: string;
}

export interface TaskLevelAssignment extends LevelSelection {
  readonly taskId: string;
  readonly onCriticalPath: boolean;
}

export interface CrewPresetProfile {
  readonly preset: CrewPreset;
  readonly userPresetCap: number;
  readonly prewarmNextWave: boolean;
  readonly preferSubscription: boolean;
  readonly batchSameFeature: boolean;
  readonly summary: string;
}

export type BindingConstraint =
  | "dag_disjoint_width"
  | "hardware_pool_cap"
  | "provider_pacing_cap"
  | "worktree_slot_cap"
  | "user_preset_cap";

export interface ParallelismInput {
  readonly graph: ScheduleGraph;
  readonly hardwarePoolCap: number;
  readonly governorPressure: GovernorPressure;
  readonly providerPacingCap: number;
  readonly worktreeSlotCap: number;
  readonly preset: CrewPreset;
  readonly developerMax: number | null;
}

export interface ParallelismDecision {
  readonly wEff: number;
  readonly dagDisjointWidth: number;
  readonly hardwarePoolCap: number;
  readonly providerPacingCap: number;
  readonly worktreeSlotCap: number;
  readonly userPresetCap: number;
  readonly bindingConstraint: BindingConstraint;
  readonly sequentialChain: boolean;
  readonly reason: string;
}

export interface DispatchAssignment {
  readonly taskId: string;
  readonly featureId: string;
  readonly featureSlug: string;
  readonly featureBranch: string;
  readonly worktreeSlot: string;
  readonly level: CrewLevel;
  readonly connectionId: string;
  readonly rankUMs: number;
  readonly writeScope: readonly string[];
  readonly waveIndex: number;
  readonly preset: CrewPreset;
  readonly expectedCostMicroUsd: number;
  readonly passProbability: number;
  readonly rationale: string;
  readonly attemptId: string;
  readonly onCriticalPath: boolean;
}

export interface ActiveSlotSample {
  readonly timeMs: number;
  readonly activeSlots: number;
}

export interface TaskPlacement {
  readonly taskId: string;
  readonly featureId: string;
  readonly featureBranch: string;
  readonly startMs: number;
  readonly endMs: number;
  readonly level: CrewLevel;
  readonly connectionId: string;
  readonly writeScope: readonly string[];
  readonly onCriticalPath: boolean;
}

export interface PrewarmIntent {
  readonly waveIndex: number;
  readonly featureIds: readonly string[];
  readonly reason: "fastest-preset-jit";
}

export interface ScheduleProjection {
  readonly criticalPathMinutes: number;
  readonly parallelSpeedupFactor: number;
  readonly activeSlotsByTime: readonly ActiveSlotSample[];
  readonly sequentialMinutes: number;
  readonly parallelMinutes: number;
  readonly peakWorkers: number;
  readonly summary: string;
  readonly startOrder: readonly string[];
  readonly placements: readonly TaskPlacement[];
  readonly parkedReason: string | null;
}

export interface ScheduleResult {
  readonly preset: CrewPreset;
  readonly parallelism: ParallelismDecision;
  readonly levels: readonly TaskLevelAssignment[];
  readonly projection: ScheduleProjection;
  readonly prewarmNextWave: PrewarmIntent | null;
  readonly parkedReason: string | null;
}

export interface ProjectOptions {
  readonly policy: "heft" | "fifo";
  readonly workerCap: number | null;
}

export type RebalanceEvent =
  | { readonly type: "task_completed"; readonly taskId: string; readonly nowMs: number }
  | {
      readonly type: "retry_escalation";
      readonly taskId: string;
      readonly hintStep: number;
      readonly execTimeMs: number;
      readonly nowMs: number;
    }
  | {
      readonly type: "task_hold";
      readonly taskId: string;
      readonly reason: HoldReason;
      readonly source: string;
      readonly nowMs: number;
    }
  | {
      readonly type: "task_release";
      readonly taskId: string;
      readonly reason: HoldReason;
      readonly source: string;
      readonly nowMs: number;
    }
  | { readonly type: "governor"; readonly pressure: GovernorPressure; readonly nowMs: number }
  | {
      readonly type: "provider_pacing";
      readonly connections: readonly ProviderConnection[];
      readonly nowMs: number;
    }
  | { readonly type: "preset_switch"; readonly preset: CrewPreset; readonly nowMs: number };

export interface RebalanceResult {
  readonly state: LiveScheduleState;
  readonly admissions: readonly DispatchAssignment[];
  readonly yieldedToHold: readonly string[];
  readonly abortedTaskIds: readonly string[];
  readonly ranks: RankTable;
  readonly parallelism: ParallelismDecision;
  readonly prewarmNextWave: PrewarmIntent | null;
  readonly elapsedMs: number;
}

export interface ScheduleStateInit {
  readonly graph: ScheduleGraph;
  readonly preset?: CrewPreset;
  readonly completedTaskIds?: readonly string[];
  readonly holds?: readonly TaskHoldRecord[];
  readonly inFlight?: readonly InFlightTurn[];
  readonly pathLeases?: readonly PathLeaseView[];
  readonly connections?: readonly ProviderConnection[];
  readonly paidFallbackApproved?: boolean;
  readonly governorPressure?: GovernorPressure;
  readonly hardwarePoolCap: number;
  readonly worktreeSlotCap: number;
  readonly developerMax?: number | null;
  readonly skippedRounds?: Readonly<Record<string, number>>;
  readonly readySinceMs?: Readonly<Record<string, number>>;
  readonly nowMs?: number;
  readonly execTimeOverrideMs?: Readonly<Record<string, number>>;
  readonly hintOverride?: Readonly<Record<string, number>>;
  readonly lastDispatchedFeatureId?: string | null;
}

export function featureBranch(featureSlug: string): string {
  return `harness/f/${featureSlug}`;
}

export function worktreeSlotFor(featureSlug: string): string {
  return `wt:${featureSlug}`;
}

export function isCrewPreset(value: string): value is CrewPreset {
  return (CREW_PRESETS as readonly string[]).includes(value);
}

export function isCrewLevel(value: string): value is CrewLevel {
  return (CREW_LEVELS as readonly string[]).includes(value);
}

export function levelIndex(level: CrewLevel): number {
  return CREW_LEVELS.indexOf(level);
}

export function createScheduleState(init: ScheduleStateInit): LiveScheduleState {
  return {
    graph: init.graph,
    preset: init.preset ?? "Balanced",
    completedTaskIds: init.completedTaskIds ?? [],
    holds: init.holds ?? [],
    inFlight: init.inFlight ?? [],
    pathLeases: init.pathLeases ?? [],
    connections: init.connections ?? [],
    paidFallbackApproved: init.paidFallbackApproved ?? false,
    governorPressure: init.governorPressure ?? "Green",
    hardwarePoolCap: init.hardwarePoolCap,
    worktreeSlotCap: init.worktreeSlotCap,
    developerMax: init.developerMax ?? null,
    skippedRounds: init.skippedRounds ?? {},
    readySinceMs: init.readySinceMs ?? {},
    nowMs: init.nowMs ?? 0,
    execTimeOverrideMs: init.execTimeOverrideMs ?? {},
    hintOverride: init.hintOverride ?? {},
    parkedReason: null,
    attemptSerial: 0,
    lastDispatchedFeatureId: init.lastDispatchedFeatureId ?? null,
  };
}
