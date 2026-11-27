export const WORKER_LEVELS = ["junior", "mid", "senior", "principal"] as const;

export type WorkerLevel = (typeof WORKER_LEVELS)[number];

export const DIFFICULTY_TIERS = ["trivial", "standard", "complex", "critical"] as const;

export type DifficultyTier = (typeof DIFFICULTY_TIERS)[number];

export const CREW_PRESETS = ["fastest", "balanced", "cheapest"] as const;

export type CrewPreset = (typeof CREW_PRESETS)[number];

export const CREW_ROLES = [
  "worker",
  "oracle-author@1",
  "entailment-checker@1",
  "reviewer@1",
] as const;

export type CrewRole = (typeof CREW_ROLES)[number];

export const DIVERSITY_ROLES = [
  "oracle-author@1",
  "entailment-checker@1",
  "reviewer@1",
] as const;

export type DiversityRole = (typeof DIVERSITY_ROLES)[number];

export const RISK_TAGS = [
  "auth",
  "payments",
  "concurrency",
  "migrations",
  "security",
] as const;

export type RiskTag = (typeof RISK_TAGS)[number];

export const MIGRATION_KINDS = [
  "none",
  "additive",
  "expand-contract",
  "destructive",
] as const;

export type MigrationKind = (typeof MIGRATION_KINDS)[number];

export const SPEND_KINDS = ["paid-api", "subscription", "local"] as const;

export type SpendKind = (typeof SPEND_KINDS)[number];

export const COST_CURRENCIES = ["micro-usd", "ppm"] as const;

export type CostCurrency = (typeof COST_CURRENCIES)[number];

export const BLOCK_REASONS = [
  "no_eligible_model",
  "capability_unavailable",
  "paid_fallback_not_approved",
  "currency_pool_empty",
] as const;

export type BlockReason = (typeof BLOCK_REASONS)[number];

export const SCOPE_KINDS = [
  "project",
  "feature",
  "task",
  "wave_paperwork",
  "grant",
] as const;

export type ScopeKind = (typeof SCOPE_KINDS)[number];

export const PASS_PROBABILITY_MIN = 0.05;
export const PASS_PROBABILITY_MAX = 0.98;
export const PRIOR_STRENGTH = 10;
export const PROBABILITY_SCALE = 1_000_000n;
export const MICRO_USD_SCALE = 1_000_000n;
export const MICRO_LOCAL_CONTEXT_WINDOW = 16_384;
export const HINT_ESCALATION_FAILURES = 2;
export const BALANCED_CRITICAL_PATH_COST_NUMERATOR = 2n;
export const BALANCED_CRITICAL_PATH_COST_DENOMINATOR = 1n;

export interface FileRankSignal {
  readonly path: string;
  readonly score: number;
}

export interface CompiledTaskFeatures {
  readonly taskId: string;
  readonly fileCount: number;
  readonly mustBandTokens: number;
  readonly riskTags: readonly RiskTag[];
  readonly contractFanIn: number;
  readonly fileRanks: readonly FileRankSignal[];
  readonly priorFailedAttempts: number;
  readonly roleId: CrewRole | null;
  readonly migrationKind: MigrationKind;
  readonly crossFeatureConflictMerge: boolean;
  readonly language: string;
}

export interface ScoreContribution {
  readonly feature: string;
  readonly points: number;
}

export interface DifficultyAssessment {
  readonly taskId: string;
  readonly tier: DifficultyTier;
  readonly score: number;
  readonly contributions: readonly ScoreContribution[];
  readonly criticalMarkers: readonly string[];
  readonly greenfield: boolean;
  readonly language: string;
}

export interface PassPriors {
  readonly trivial: number;
  readonly standard: number;
  readonly complex: number;
  readonly critical: number;
}

export interface ModelRosterEntry {
  readonly modelId: string;
  readonly family: string;
  readonly provider: string;
  readonly connectionId: string;
  readonly tier: WorkerLevel;
  readonly contextWindow: number;
  readonly supportsTools: boolean;
  readonly supportsStructuredJson: boolean;
  readonly supportsVision: boolean;
  readonly spendKind: SpendKind;
  readonly inputMicroUsdPer1M: bigint;
  readonly outputMicroUsdPer1M: bigint;
  readonly cachedInputMicroUsdPer1M: bigint;
  readonly allowancePpmPer1M: bigint;
  readonly defaultPassPriors: PassPriors;
  readonly deprecatedAfter: number | null;
  readonly pinned: boolean;
}

export interface TokenEstimate {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cachedInputTokens: number;
}

export interface PassEstimate {
  readonly probability: number;
  readonly probabilityMicro: bigint;
  readonly successes: number;
  readonly failures: number;
  readonly observations: number;
  readonly prior: number;
  readonly stronglyShifted: boolean;
}

export interface LevelQuote {
  readonly level: WorkerLevel;
  readonly modelId: string;
  readonly family: string;
  readonly unitCost: bigint;
  readonly expectedCost: bigint;
  readonly sameLevelRetryCost: bigint;
  readonly passProbability: number;
  readonly currency: CostCurrency;
}

export interface LevelAssignment {
  readonly status: "assigned" | "blocked";
  readonly taskId: string;
  readonly difficulty: DifficultyTier;
  readonly level: WorkerLevel | null;
  readonly modelId: string | null;
  readonly modelTier: WorkerLevel | null;
  readonly family: string | null;
  readonly provider: string | null;
  readonly connectionId: string | null;
  readonly currency: CostCurrency;
  readonly unitCost: bigint;
  readonly expectedCost: bigint;
  readonly sameLevelRetryCost: bigint;
  readonly passProbability: number;
  readonly rationale: string;
  readonly singleModelMode: boolean;
  readonly floor: WorkerLevel;
  readonly floorHeld: boolean;
  readonly escalated: boolean;
  readonly criticalPathBoost: boolean;
  readonly crossFamily: boolean;
  readonly budgetShortfall: boolean;
  readonly blockReason: BlockReason | null;
  readonly compared: readonly LevelQuote[];
}

export function isWorkerLevel(value: string): value is WorkerLevel {
  return (WORKER_LEVELS as readonly string[]).includes(value);
}

export function isDifficultyTier(value: string): value is DifficultyTier {
  return (DIFFICULTY_TIERS as readonly string[]).includes(value);
}

export function isRiskTag(value: string): value is RiskTag {
  return (RISK_TAGS as readonly string[]).includes(value);
}

export function isCrewRole(value: string): value is CrewRole {
  return (CREW_ROLES as readonly string[]).includes(value);
}

export function isDiversityRole(role: CrewRole): role is DiversityRole {
  return (DIVERSITY_ROLES as readonly string[]).includes(role);
}

export function levelRank(level: WorkerLevel): number {
  switch (level) {
    case "junior":
      return 0;
    case "mid":
      return 1;
    case "senior":
      return 2;
    case "principal":
      return 3;
  }
}

export function levelByRank(rank: number): WorkerLevel {
  if (rank <= 0) return "junior";
  if (rank === 1) return "mid";
  if (rank === 2) return "senior";
  return "principal";
}

export function levelLabel(level: WorkerLevel): string {
  switch (level) {
    case "junior":
      return "Junior";
    case "mid":
      return "Mid";
    case "senior":
      return "Senior";
    case "principal":
      return "Principal";
  }
}

export function higherLevel(left: WorkerLevel, right: WorkerLevel): WorkerLevel {
  return levelRank(left) >= levelRank(right) ? left : right;
}

export function entryCurrency(entry: ModelRosterEntry): CostCurrency {
  return entry.spendKind === "subscription" ? "ppm" : "micro-usd";
}

export function isMicroLocal(entry: ModelRosterEntry): boolean {
  return (
    entry.spendKind === "local" && entry.contextWindow < MICRO_LOCAL_CONTEXT_WINDOW
  );
}
