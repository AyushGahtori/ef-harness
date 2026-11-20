import { HistoricalPassRateCalibrator } from "./calibrator.js";
import { TaskDifficultyClassifier, minimumWorkerLevel } from "./difficulty.js";
import { CrewLevelsError } from "./errors.js";
import { assertSafeCount, levelExpectedCost, sameLevelRetryCost } from "./money.js";
import type { BudgetLedgerPort, BudgetScopeRef, GlobalConnectionView } from "./ports.js";
import { estimateUnitCost } from "./pricing.js";
import { buildRationale } from "./rationale.js";
import type { VersionedModelRoster } from "./roster.js";
import {
  type BlockReason,
  type CompiledTaskFeatures,
  type CostCurrency,
  type CrewPreset,
  type CrewRole,
  type DifficultyTier,
  type LevelAssignment,
  type LevelQuote,
  type ModelRosterEntry,
  type RiskTag,
  type TokenEstimate,
  type WorkerLevel,
  BALANCED_CRITICAL_PATH_COST_DENOMINATOR,
  BALANCED_CRITICAL_PATH_COST_NUMERATOR,
  HINT_ESCALATION_FAILURES,
  RISK_TAGS,
  entryCurrency,
  higherLevel,
  isDiversityRole,
  isMicroLocal,
  levelByRank,
  levelRank,
} from "./types.js";

const HIGH_TO_LOW: readonly WorkerLevel[] = ["principal", "senior", "mid", "junior"];

export interface LevelSelectionInput {
  readonly task: CompiledTaskFeatures;
  readonly preset: CrewPreset;
  readonly currency: CostCurrency;
  readonly nowMs: number;
  readonly failedAttempts: number;
  readonly onCriticalPath: boolean;
  readonly language: string;
  readonly tokens: TokenEstimate;
  readonly role: CrewRole;
  readonly buildWorkerFamily: string | null;
  readonly requiresVision: boolean;
  readonly paidFallbackApproved: boolean;
  readonly allowedConnectionIds: readonly string[] | null;
  readonly budget: BudgetLedgerPort | null;
  readonly budgetScope: BudgetScopeRef | null;
  readonly connections: readonly GlobalConnectionView[] | null;
}

export interface SelectionOptions {
  readonly nowMs?: number;
  readonly failedAttempts?: number;
  readonly onCriticalPath?: boolean;
  readonly language?: string;
  readonly tokens?: TokenEstimate;
  readonly role?: CrewRole;
  readonly buildWorkerFamily?: string | null;
  readonly requiresVision?: boolean;
  readonly paidFallbackApproved?: boolean;
  readonly allowedConnectionIds?: readonly string[] | null;
  readonly budget?: BudgetLedgerPort | null;
  readonly budgetScope?: BudgetScopeRef | null;
  readonly connections?: readonly GlobalConnectionView[] | null;
}

const DEFAULT_TOKENS: TokenEstimate = {
  inputTokens: 1_000_000,
  outputTokens: 0,
  cachedInputTokens: 0,
};

export function selectionInput(
  task: CompiledTaskFeatures,
  preset: CrewPreset,
  currency: CostCurrency,
  options: SelectionOptions = {},
): LevelSelectionInput {
  return {
    task,
    preset,
    currency,
    nowMs: options.nowMs ?? 0,
    failedAttempts: options.failedAttempts ?? 0,
    onCriticalPath: options.onCriticalPath ?? false,
    language: options.language ?? task.language,
    tokens: options.tokens ?? DEFAULT_TOKENS,
    role: options.role ?? "worker",
    buildWorkerFamily: options.buildWorkerFamily ?? null,
    requiresVision: options.requiresVision ?? false,
    paidFallbackApproved: options.paidFallbackApproved ?? false,
    allowedConnectionIds: options.allowedConnectionIds ?? null,
    budget: options.budget ?? null,
    budgetScope: options.budgetScope ?? null,
    connections: options.connections ?? null,
  };
}

interface PoolResult {
  readonly models: readonly ModelRosterEntry[];
  readonly blockReason: BlockReason | null;
  readonly diversityRelaxed: boolean;
}

function connectionAllowed(
  entry: ModelRosterEntry,
  input: LevelSelectionInput,
): boolean {
  const connections = input.connections;
  if (connections === null) {
    if (input.allowedConnectionIds === null) return true;
    return input.allowedConnectionIds.includes(entry.connectionId);
  }
  const match = connections.find((connection) => connection.id === entry.connectionId);
  if (match === undefined || !match.enabled) return false;
  if (input.currency === "micro-usd" && match.currency !== "usd") return false;
  if (input.currency === "ppm" && !match.currency.startsWith("allowance:")) return false;
  if (
    input.allowedConnectionIds !== null &&
    !input.allowedConnectionIds.includes(entry.connectionId)
  ) {
    return false;
  }
  return true;
}

function paidAllowed(entry: ModelRosterEntry, input: LevelSelectionInput): boolean {
  if (entry.spendKind !== "paid-api") return true;
  if (input.paidFallbackApproved) return true;
  return (
    input.allowedConnectionIds !== null &&
    input.allowedConnectionIds.includes(entry.connectionId)
  );
}

function preparePool(
  roster: VersionedModelRoster,
  input: LevelSelectionInput,
  floor: WorkerLevel,
): PoolResult {
  const alive = roster.entries.filter(
    (entry) => !roster.isRevoked(entry.modelId) && !roster.isDeprecated(entry, input.nowMs),
  );
  const connected = alive.filter((entry) => connectionAllowed(entry, input));
  const inCurrency = connected.filter((entry) => entryCurrency(entry) === input.currency);
  if (inCurrency.length === 0) {
    const otherCurrency = connected.some((entry) => entryCurrency(entry) !== input.currency);
    return {
      models: [],
      blockReason: otherCurrency ? "currency_pool_empty" : "no_eligible_model",
      diversityRelaxed: false,
    };
  }
  const affordable = inCurrency.filter((entry) => paidAllowed(entry, input));
  if (affordable.length === 0) {
    return { models: [], blockReason: "paid_fallback_not_approved", diversityRelaxed: false };
  }
  const capable = affordable.filter((entry) => {
    if (!entry.supportsTools || !entry.supportsStructuredJson) return false;
    if (input.requiresVision && !entry.supportsVision) return false;
    return true;
  });
  if (capable.length === 0) {
    return { models: [], blockReason: "capability_unavailable", diversityRelaxed: false };
  }
  let models = capable;
  if (levelRank(floor) >= levelRank("senior")) {
    const nonMicro = capable.filter((entry) => !isMicroLocal(entry));
    if (nonMicro.length > 0) models = nonMicro;
  }
  let diversityRelaxed = false;
  if (isDiversityRole(input.role) && input.buildWorkerFamily !== null) {
    const families = new Set(models.map((entry) => entry.family));
    if (families.size >= 2) {
      const otherFamily = models.filter((entry) => entry.family !== input.buildWorkerFamily);
      const otherMeetsFloor = otherFamily.some(
        (entry) => levelRank(entry.tier) >= levelRank(floor),
      );
      if (otherMeetsFloor) models = otherFamily;
      else diversityRelaxed = true;
    }
  }
  if (models.length === 0) {
    return { models: [], blockReason: "no_eligible_model", diversityRelaxed };
  }
  return { models, blockReason: null, diversityRelaxed };
}

function betterQuote(candidate: LevelQuote, current: LevelQuote): boolean {
  if (candidate.expectedCost !== current.expectedCost) {
    return candidate.expectedCost < current.expectedCost;
  }
  if (candidate.passProbability !== current.passProbability) {
    return candidate.passProbability > current.passProbability;
  }
  return candidate.modelId < current.modelId;
}

function higherPass(candidate: LevelQuote, current: LevelQuote): boolean {
  if (candidate.passProbability !== current.passProbability) {
    return candidate.passProbability > current.passProbability;
  }
  return betterQuote(candidate, current);
}

function quoteLevels(
  models: readonly ModelRosterEntry[],
  calibrator: HistoricalPassRateCalibrator,
  difficulty: DifficultyTier,
  language: string,
  tokens: TokenEstimate,
): LevelQuote[] {
  const grouped = new Map<WorkerLevel, ModelRosterEntry[]>();
  for (const model of models) {
    const group = grouped.get(model.tier) ?? [];
    group.push(model);
    grouped.set(model.tier, group);
  }
  let nextUnit: bigint | null = null;
  const quotes: LevelQuote[] = [];
  for (const level of HIGH_TO_LOW) {
    const group = grouped.get(level);
    if (group === undefined || group.length === 0) continue;
    let best: LevelQuote | null = null;
    for (const model of group) {
      const pass = calibrator.firstPass(model.modelId, difficulty, language);
      const unitCost = estimateUnitCost(model, tokens);
      const sameLevel = sameLevelRetryCost(unitCost, pass.probabilityMicro);
      const expectedCost = levelExpectedCost(unitCost, pass.probabilityMicro, nextUnit);
      const quote: LevelQuote = {
        level,
        modelId: model.modelId,
        family: model.family,
        unitCost,
        expectedCost,
        sameLevelRetryCost: sameLevel,
        passProbability: pass.probability,
        currency: entryCurrency(model),
      };
      if (best === null || betterQuote(quote, best)) best = quote;
    }
    if (best !== null) {
      quotes.push(best);
      nextUnit = best.unitCost;
    }
  }
  return quotes.sort((left, right) => levelRank(left.level) - levelRank(right.level));
}

function cheapest(quotes: readonly LevelQuote[]): LevelQuote {
  const first = quotes[0];
  if (first === undefined) {
    throw new CrewLevelsError("bad-model", "cannot choose from an empty roster");
  }
  let best = first;
  for (const quote of quotes) {
    if (betterQuote(quote, best)) best = quote;
  }
  return best;
}

function highestPass(quotes: readonly LevelQuote[]): LevelQuote {
  const first = quotes[0];
  if (first === undefined) {
    throw new CrewLevelsError("bad-model", "cannot choose from an empty roster");
  }
  let best = first;
  for (const quote of quotes) {
    if (higherPass(quote, best)) best = quote;
  }
  return best;
}

function choosePolicy(
  quotes: readonly LevelQuote[],
  input: LevelSelectionInput,
  floor: WorkerLevel,
): { readonly chosen: LevelQuote; readonly criticalPathBoost: boolean; readonly floorHeld: boolean } {
  const legal = quotes.filter((quote) => levelRank(quote.level) >= levelRank(floor));
  const pool = legal.length > 0 ? legal : quotes;
  const costBest = cheapest(pool);
  let chosen = costBest;
  let criticalPathBoost = false;
  if (input.onCriticalPath && input.preset === "fastest") {
    chosen = highestPass(pool);
    criticalPathBoost = chosen.modelId !== costBest.modelId || chosen.level !== costBest.level;
  } else if (input.onCriticalPath && input.preset === "balanced") {
    const cap = costBest.expectedCost * BALANCED_CRITICAL_PATH_COST_NUMERATOR;
    const band = pool.filter(
      (quote) =>
        quote.expectedCost * BALANCED_CRITICAL_PATH_COST_DENOMINATOR <= cap,
    );
    chosen = highestPass(band.length > 0 ? band : pool);
    criticalPathBoost = chosen.modelId !== costBest.modelId || chosen.level !== costBest.level;
  }
  return { chosen, criticalPathBoost, floorHeld: legal.length > 0 };
}

function escalate(quotes: readonly LevelQuote[], chosen: LevelQuote, failedAttempts: number): {
  readonly quote: LevelQuote;
  readonly escalated: boolean;
} {
  const steps =
    failedAttempts >= HINT_ESCALATION_FAILURES ? failedAttempts - (HINT_ESCALATION_FAILURES - 1) : 0;
  if (steps <= 0) return { quote: chosen, escalated: false };
  const wanted = levelRank(chosen.level) + steps;
  const floor = levelRank(chosen.level);
  let best: LevelQuote | null = null;
  for (const quote of quotes) {
    const rank = levelRank(quote.level);
    if (rank < floor || rank > wanted) continue;
    if (best === null || rank > levelRank(best.level)) best = quote;
  }
  const quote = best ?? chosen;
  return { quote, escalated: quote.level !== chosen.level };
}

function retryRiskLevel(quotes: readonly LevelQuote[], chosen: LevelQuote): WorkerLevel | null {
  let tempting: LevelQuote | null = null;
  for (const quote of quotes) {
    if (quote.level === chosen.level) continue;
    if (quote.unitCost >= chosen.unitCost) continue;
    if (quote.expectedCost <= chosen.expectedCost) continue;
    if (tempting === null || levelRank(quote.level) < levelRank(tempting.level)) {
      tempting = quote;
    }
  }
  return tempting?.level ?? null;
}

function safetyFloorApplied(
  quotes: readonly LevelQuote[],
  floor: WorkerLevel,
  chosen: LevelQuote,
): boolean {
  if (levelRank(floor) <= levelRank("junior")) return false;
  if (levelRank(chosen.level) < levelRank(floor)) return false;
  const unconstrained = cheapest(quotes);
  return levelRank(unconstrained.level) < levelRank(floor);
}

function touchTags(features: CompiledTaskFeatures): RiskTag[] {
  const tags: RiskTag[] = [];
  for (const tag of RISK_TAGS) {
    if (features.riskTags.includes(tag)) tags.push(tag);
  }
  if (
    features.migrationKind !== "none" &&
    !tags.includes("migrations")
  ) {
    tags.push("migrations");
  }
  return tags;
}

function parseUnits(value: number | bigint): bigint {
  if (typeof value === "bigint") {
    if (value < 0n) {
      throw new CrewLevelsError("negative-money", "remaining units cannot be negative");
    }
    return value;
  }
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new CrewLevelsError("negative-money", "remaining units must be a non-negative integer");
  }
  return BigInt(value);
}

function currencyMatches(rowCurrency: string, pool: CostCurrency): boolean {
  if (pool === "micro-usd") return rowCurrency === "usd";
  return rowCurrency.startsWith("allowance:");
}

function remainingBudget(input: LevelSelectionInput): bigint | null {
  if (input.budget === null || input.budgetScope === null) return null;
  const rows = input.budget.getBudgetRemaining(
    input.budgetScope.scopeKind,
    input.budgetScope.scopeId,
  );
  let remaining: bigint | null = null;
  for (const row of rows) {
    if (!currencyMatches(row.currency, input.currency)) continue;
    const units = row.overrun ? 0n : parseUnits(row.remainingUnits);
    remaining = remaining === null || units < remaining ? units : remaining;
  }
  return remaining;
}

function findModel(
  models: readonly ModelRosterEntry[],
  modelId: string,
): ModelRosterEntry | null {
  return models.find((model) => model.modelId === modelId) ?? null;
}

function blockedAssignment(
  input: LevelSelectionInput,
  difficulty: DifficultyTier,
  floor: WorkerLevel,
  reason: BlockReason,
  touches: readonly RiskTag[],
): LevelAssignment {
  const rationale = buildRationale({
    status: "blocked",
    level: null,
    currency: input.currency,
    expectedCost: 0n,
    passProbability: 0,
    blockReason: reason,
    touches,
    safetyFloor: false,
    retryRiskLevel: null,
    criticalPathBoost: false,
    escalated: false,
    singleModelMode: false,
    crossFamily: false,
    diversityRelaxed: false,
    floorHeld: false,
    budgetShortfall: false,
  });
  return {
    status: "blocked",
    taskId: input.task.taskId,
    difficulty,
    level: null,
    modelId: null,
    modelTier: null,
    family: null,
    provider: null,
    connectionId: null,
    currency: input.currency,
    unitCost: 0n,
    expectedCost: 0n,
    sameLevelRetryCost: 0n,
    passProbability: 0,
    rationale,
    singleModelMode: false,
    floor,
    floorHeld: false,
    escalated: false,
    criticalPathBoost: false,
    crossFamily: false,
    budgetShortfall: false,
    blockReason: reason,
    compared: [],
  };
}

function validateInput(input: LevelSelectionInput): void {
  if (!Number.isSafeInteger(input.nowMs) || input.nowMs < 0) {
    throw new CrewLevelsError("bad-task", "nowMs must be a non-negative integer");
  }
  assertSafeCount(input.failedAttempts, "failedAttempts");
  if (input.language.trim().length === 0) {
    throw new CrewLevelsError("bad-task", "language is required");
  }
}

export class ExpectedCostLevelSelector {
  constructor(
    private readonly roster: VersionedModelRoster,
    private readonly calibrator: HistoricalPassRateCalibrator,
    private readonly classifier: TaskDifficultyClassifier = new TaskDifficultyClassifier(),
  ) {}

  select(input: LevelSelectionInput): LevelAssignment {
    validateInput(input);
    const features: CompiledTaskFeatures = {
      ...input.task,
      roleId: input.role,
      language: input.language,
    };
    const assessment = this.classifier.classify(features);
    const floor = minimumWorkerLevel(assessment, input.role);
    const touches = touchTags(features);
    const pool = preparePool(this.roster, input, floor);
    if (pool.blockReason !== null || pool.models.length === 0) {
      return blockedAssignment(
        input,
        assessment.tier,
        floor,
        pool.blockReason ?? "no_eligible_model",
        touches,
      );
    }

    const single = pool.models.length === 1;
    const quotes = quoteLevels(
      pool.models,
      this.calibrator,
      assessment.tier,
      input.language,
      input.tokens,
    );
    const policy = choosePolicy(quotes, input, floor);
    const escalated = escalate(quotes, policy.chosen, input.failedAttempts);
    const chosen = escalated.quote;
    const model = findModel(pool.models, chosen.modelId);
    if (model === null) {
      return blockedAssignment(input, assessment.tier, floor, "no_eligible_model", touches);
    }
    const only = pool.models[0];
    const singleModel = single && only !== undefined;
    const policyLevel = singleModel
      ? levelByRank(
          levelRank(higherLevel(floor, only.tier)) +
            (input.failedAttempts >= HINT_ESCALATION_FAILURES
              ? input.failedAttempts - (HINT_ESCALATION_FAILURES - 1)
              : 0),
        )
      : chosen.level;
    const displayQuote = singleModel
      ? {
          ...chosen,
          level: policyLevel,
        }
      : chosen;
    const crossFamily =
      isDiversityRole(input.role) &&
      input.buildWorkerFamily !== null &&
      model.family !== input.buildWorkerFamily;
    const floorHeld = singleModel
      ? levelRank(only.tier) >= levelRank(floor)
      : policy.floorHeld && levelRank(displayQuote.level) >= levelRank(floor);
    const remaining = remainingBudget(input);
    const budgetShortfall = remaining !== null && displayQuote.expectedCost > remaining;
    const escalatedFlag = singleModel
      ? policyLevel !== higherLevel(floor, only.tier)
      : escalated.escalated;
    const rationale = buildRationale({
      status: "assigned",
      level: displayQuote.level,
      currency: input.currency,
      expectedCost: displayQuote.expectedCost,
      passProbability: displayQuote.passProbability,
      blockReason: null,
      touches,
      safetyFloor: safetyFloorApplied(quotes, floor, displayQuote),
      retryRiskLevel: retryRiskLevel(quotes, displayQuote),
      criticalPathBoost: policy.criticalPathBoost,
      escalated: escalatedFlag,
      singleModelMode: singleModel,
      crossFamily,
      diversityRelaxed: pool.diversityRelaxed,
      floorHeld,
      budgetShortfall,
    });
    return {
      status: "assigned",
      taskId: features.taskId,
      difficulty: assessment.tier,
      level: displayQuote.level,
      modelId: model.modelId,
      modelTier: model.tier,
      family: model.family,
      provider: model.provider,
      connectionId: model.connectionId,
      currency: input.currency,
      unitCost: displayQuote.unitCost,
      expectedCost: displayQuote.expectedCost,
      sameLevelRetryCost: displayQuote.sameLevelRetryCost,
      passProbability: displayQuote.passProbability,
      rationale,
      singleModelMode: singleModel,
      floor,
      floorHeld,
      escalated: escalatedFlag,
      criticalPathBoost: policy.criticalPathBoost,
      crossFamily,
      budgetShortfall,
      blockReason: null,
      compared: quotes,
    };
  }
}
