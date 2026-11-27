import {
  ExpectedCostLevelSelector,
  HistoricalPassRateCalibrator,
  VersionedModelRoster,
  defaultModelRoster,
  isCrewRole,
  isRiskTag,
  selectionInput,
  type CompiledTaskFeatures,
  type CostCurrency,
  type GlobalConnectionView,
  type MigrationKind,
  type RiskTag,
} from "../crew-levels/index.js";
import { SchedulerError } from "./errors.js";
import {
  AGE_MS_PER_SKIP,
  BALANCED_PRESET_CAP,
  CACHE_BONUS_MS,
  CHEAPEST_PRESET_CAP,
  EXPLICIT_BOOST_MS,
  coerceCrewPreset,
  type CrewPreset,
  type CrewPresetInput,
  type CrewPresetProfile,
  type DifficultyTier,
  type LevelSelection,
  type LevelSelectionRequest,
  type ProviderConnection,
  type ScheduleGraph,
  type ScheduleTask,
  type TaskLevelAssignment,
  type WorkerTier,
} from "./types.js";

export const DEFAULT_SCHEDULER_ROSTER: VersionedModelRoster = defaultModelRoster();

export function defaultSchedulerRoster(): VersionedModelRoster {
  return DEFAULT_SCHEDULER_ROSTER;
}

const DIFFICULTY_METRICS: Readonly<
  Record<
    DifficultyTier,
    { readonly fileCount: number; readonly mustBandTokens: number; readonly contractFanIn: number }
  >
> = {
  trivial: { fileCount: 1, mustBandTokens: 100, contractFanIn: 0 },
  standard: { fileCount: 3, mustBandTokens: 6_000, contractFanIn: 0 },
  complex: { fileCount: 5, mustBandTokens: 20_000, contractFanIn: 0 },
  critical: { fileCount: 9, mustBandTokens: 36_000, contractFanIn: 4 },
};

function toCompiledTaskFeatures(task: ScheduleTask, hintStep: number): CompiledTaskFeatures {
  const metrics = DIFFICULTY_METRICS[task.difficulty];
  const riskTags: RiskTag[] = [];
  let migrationKind: MigrationKind = "none";
  let crossFeatureConflictMerge = false;
  for (const tag of task.riskTags) {
    if (isRiskTag(tag) && !riskTags.includes(tag)) {
      riskTags.push(tag);
    } else if (tag === "destructive_migration") {
      migrationKind = "destructive";
      if (!riskTags.includes("migrations")) riskTags.push("migrations");
    } else if (tag === "expand_contract_migration") {
      migrationKind = "expand-contract";
      if (!riskTags.includes("migrations")) riskTags.push("migrations");
    } else if (tag === "cross_feature_conflict") {
      crossFeatureConflictMerge = true;
    }
  }
  const roleId = task.role !== null && isCrewRole(task.role) ? task.role : null;
  return {
    taskId: task.id,
    fileCount: metrics.fileCount,
    mustBandTokens: metrics.mustBandTokens,
    riskTags,
    contractFanIn: metrics.contractFanIn,
    fileRanks: [],
    priorFailedAttempts: Math.max(0, hintStep),
    roleId,
    migrationKind,
    crossFeatureConflictMerge,
    language: "ts",
  };
}

export function safetyFloor(task: ScheduleTask): WorkerTier {
  if (task.role === "oracle-author@1") return "Senior";
  const floorTags = new Set([
    "auth",
    "payments",
    "migrations",
    "destructive_migration",
    "expand_contract_migration",
    "cross_feature_conflict",
  ]);
  if (task.riskTags.some((tag) => floorTags.has(tag))) return "Senior";
  if (task.difficulty === "critical") return "Senior";
  return "Junior";
}

export interface ExpectedCostLevelSelectorPort {
  selectLevel(input: LevelSelectionRequest): LevelSelection;
}

export interface CrewLevelsSelectorAdapterOptions {
  readonly roster?: VersionedModelRoster;
  readonly calibrator?: HistoricalPassRateCalibrator;
  readonly currency?: CostCurrency;
  readonly paidFallbackApproved?: boolean;
  readonly allowedConnectionIds?: readonly string[] | null;
  readonly nowMs?: number;
}

function toGlobalConnectionViews(
  connections: readonly ProviderConnection[],
): readonly GlobalConnectionView[] {
  return connections.map((connection) => ({
    id: connection.id,
    provider: connection.kind === "subscription" ? "subscription" : "api",
    route: connection.kind === "subscription" ? "subscription" : "api_key",
    currency: connection.kind === "subscription" ? `allowance:${connection.id}` : "usd",
    enabled:
      connection.authorized &&
      !connection.throttled &&
      !connection.allowanceExhausted &&
      connection.pacingSlots > 0,
  }));
}

export class CrewLevelsSelectorAdapter implements ExpectedCostLevelSelectorPort {
  private readonly roster: VersionedModelRoster;
  private readonly selector: ExpectedCostLevelSelector;
  private readonly defaultCurrency: CostCurrency;
  private readonly defaultPaidFallbackApproved: boolean | undefined;
  private readonly allowedConnectionIds: readonly string[] | null;
  private readonly defaultNowMs: number;

  constructor(
    selector?: ExpectedCostLevelSelector,
    options: CrewLevelsSelectorAdapterOptions = {},
  ) {
    this.roster = options.roster ?? DEFAULT_SCHEDULER_ROSTER;
    const calibrator =
      options.calibrator ?? HistoricalPassRateCalibrator.fromRoster(this.roster, []);
    this.selector = selector ?? new ExpectedCostLevelSelector(this.roster, calibrator);
    this.defaultCurrency = options.currency ?? "micro-usd";
    this.defaultPaidFallbackApproved = options.paidFallbackApproved;
    this.allowedConnectionIds = options.allowedConnectionIds ?? null;
    this.defaultNowMs = options.nowMs ?? 0;
  }

  selectLevel(input: LevelSelectionRequest): LevelSelection {
    const preset = coerceCrewPreset(input.preset);
    const features = toCompiledTaskFeatures(input.task, input.hintStep);
    const hasRosterMatch =
      input.connections !== undefined &&
      input.connections.length > 0 &&
      this.roster.entries.some((entry) =>
        input.connections!.some((conn) => conn.id === entry.connectionId),
      );
    const connections = hasRosterMatch && input.connections
      ? toGlobalConnectionViews(input.connections)
      : null;
    const currency: CostCurrency =
      hasRosterMatch &&
      input.connections?.some(
        (conn) =>
          conn.kind === "subscription" &&
          conn.authorized &&
          !conn.throttled &&
          !conn.allowanceExhausted &&
          this.roster.entries.some(
            (entry) => entry.connectionId === conn.id && entry.spendKind === "subscription",
          ),
      ) &&
      (preset === "Cheapest" || input.paidFallbackApproved === false)
        ? "ppm"
        : this.defaultCurrency;
    const paidFallbackApproved = hasRosterMatch
      ? (input.paidFallbackApproved ?? this.defaultPaidFallbackApproved ?? false)
      : (this.defaultPaidFallbackApproved ?? true);
    const assignment = this.selector.select(
      selectionInput(features, preset, currency, {
        nowMs: input.nowMs ?? this.defaultNowMs,
        failedAttempts: Math.max(0, input.hintStep),
        onCriticalPath: input.onCriticalPath,
        role: features.roleId ?? "worker",
        paidFallbackApproved,
        allowedConnectionIds: this.allowedConnectionIds,
        connections,
      }),
    );
    if (
      assignment.status === "blocked" ||
      assignment.level === null ||
      assignment.modelId === null ||
      assignment.modelTier === null
    ) {
      throw new SchedulerError("no_eligible_model", assignment.rationale);
    }
    return {
      level: assignment.level,
      modelId: assignment.modelId,
      modelTier: assignment.modelTier,
      family: assignment.family ?? "unknown",
      provider: assignment.provider ?? "unknown",
      connectionId: assignment.connectionId ?? "default",
      expectedCostMicroUsd: Number(assignment.expectedCost),
      passProbability: assignment.passProbability,
      safetyFloor: assignment.floor,
      rationale: assignment.rationale,
    };
  }
}

export class LocalExpectedCostLevelSelector implements ExpectedCostLevelSelectorPort {
  private readonly inner: CrewLevelsSelectorAdapter;

  constructor(options: CrewLevelsSelectorAdapterOptions = {}) {
    this.inner = new CrewLevelsSelectorAdapter(undefined, options);
  }

  selectLevel(input: LevelSelectionRequest): LevelSelection {
    return this.inner.selectLevel(input);
  }
}

export interface CrewPresetEngineConfig {
  readonly levels?: ExpectedCostLevelSelectorPort;
  readonly selector?: ExpectedCostLevelSelector;
  readonly roster?: VersionedModelRoster;
  readonly calibrator?: HistoricalPassRateCalibrator;
}

function resolveSelectorPort(
  input?: ExpectedCostLevelSelectorPort | ExpectedCostLevelSelector | CrewPresetEngineConfig,
): ExpectedCostLevelSelectorPort {
  if (input === undefined) {
    return new CrewLevelsSelectorAdapter();
  }
  if (input instanceof ExpectedCostLevelSelector) {
    return new CrewLevelsSelectorAdapter(input);
  }
  if ("selectLevel" in input) {
    return input;
  }
  if (input.levels) {
    return input.levels;
  }
  const roster = input.roster ?? DEFAULT_SCHEDULER_ROSTER;
  const calibrator =
    input.calibrator ?? HistoricalPassRateCalibrator.fromRoster(roster, []);
  const selector = input.selector ?? new ExpectedCostLevelSelector(roster, calibrator);
  return new CrewLevelsSelectorAdapter(selector, { roster, calibrator });
}

export class CrewPresetProfileEngine {
  private readonly levels: ExpectedCostLevelSelectorPort;

  constructor(
    levels?: ExpectedCostLevelSelectorPort | ExpectedCostLevelSelector | CrewPresetEngineConfig,
  ) {
    this.levels = resolveSelectorPort(levels);
  }

  profile(preset: CrewPreset | CrewPresetInput | string): CrewPresetProfile {
    const canonical = coerceCrewPreset(preset);
    if (canonical === "Fastest") {
      return {
        preset: canonical,
        userPresetCap: Number.POSITIVE_INFINITY,
        prewarmNextWave: true,
        preferSubscription: false,
        batchSameFeature: false,
        summary: "Maximizes width and puts high first-pass models on the critical path",
      };
    }
    if (canonical === "Cheapest") {
      return {
        preset: canonical,
        userPresetCap: CHEAPEST_PRESET_CAP,
        prewarmNextWave: false,
        preferSubscription: true,
        batchSameFeature: true,
        summary: "Minimizes expected cost, batches same-feature siblings, and prefers subscription windows",
      };
    }
    return {
      preset: canonical,
      userPresetCap: BALANCED_PRESET_CAP,
      prewarmNextWave: false,
      preferSubscription: false,
      batchSameFeature: false,
      summary: "Expected-cost levels, senior on the critical path, laptop-friendly width",
    };
  }

  assignLevel(
    task: ScheduleTask,
    onCriticalPath: boolean,
    preset: CrewPreset | CrewPresetInput | string,
    hintStep = task.hintStep,
    options: {
      readonly connections?: readonly ProviderConnection[];
      readonly paidFallbackApproved?: boolean;
      readonly nowMs?: number;
    } = {},
  ): LevelSelection {
    const canonical = coerceCrewPreset(preset);
    return this.levels.selectLevel({
      task,
      preset: canonical,
      onCriticalPath,
      hintStep,
      ...(options.connections === undefined ? {} : { connections: options.connections }),
      ...(options.paidFallbackApproved === undefined
        ? {}
        : { paidFallbackApproved: options.paidFallbackApproved }),
      ...(options.nowMs === undefined ? {} : { nowMs: options.nowMs }),
    });
  }

  assignAll(
    graph: ScheduleGraph,
    onCriticalPath: ReadonlySet<string>,
    preset: CrewPreset | CrewPresetInput | string,
    hintOverride: Readonly<Record<string, number>> = {},
  ): readonly TaskLevelAssignment[] {
    const canonical = coerceCrewPreset(preset);
    return graph.tasks.map((task) => {
      const critical = onCriticalPath.has(task.id);
      const hint = hintOverride[task.id] ?? task.hintStep;
      return {
        taskId: task.id,
        onCriticalPath: critical,
        ...this.assignLevel(task, critical, canonical, hint),
      };
    });
  }
}

export function priorityScore(input: {
  readonly rankUMs: number;
  readonly onCriticalPath: boolean;
  readonly explicit: boolean;
  readonly optionalPolish: boolean;
  readonly skippedRounds: number;
  readonly sameFeatureBonus: boolean;
}): { readonly band: number; readonly score: number } {
  const band = input.onCriticalPath ? 2 : 1;
  const explicitBoost =
    !input.onCriticalPath && input.explicit && !input.optionalPolish ? EXPLICIT_BOOST_MS : 0;
  const cache = !input.onCriticalPath && input.sameFeatureBonus ? CACHE_BONUS_MS : 0;
  return {
    band,
    score: input.rankUMs + explicitBoost + input.skippedRounds * AGE_MS_PER_SKIP + cache,
  };
}

export interface ReadyCandidate {
  readonly index: number;
  readonly id: string;
  readonly featureId: string;
  readonly band: number;
  readonly score: number;
  readonly featureAffinity: number;
  readonly readySinceMs: number;
}

export function compareCandidates(left: ReadyCandidate, right: ReadyCandidate, policy: "heft" | "fifo"): number {
  if (policy === "fifo") return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
  if (left.band !== right.band) return right.band - left.band;
  if (left.score !== right.score) return right.score - left.score;
  if (left.featureAffinity !== right.featureAffinity) return right.featureAffinity - left.featureAffinity;
  if (left.readySinceMs !== right.readySinceMs) return left.readySinceMs - right.readySinceMs;
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}
