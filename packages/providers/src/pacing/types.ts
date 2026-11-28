import type { CHECKPOINT_STOP_ACTIONS } from "./constants.js";

export type PacingState = "normal" | "burn_paced" | "backoff_429" | "window_exhausted";

export type WindowKind = "5h" | "weekly" | "monthly" | "rpm";

export type SlotKind = "background" | "interactive";

export type WeightPrecision = "prior" | "calibrated" | "coarse_reset_estimate";

export type QuotaSampleSource =
  | "rateLimits/read"
  | "account.getQuota"
  | "header_remaining_percent"
  | "usage_limit_reset";

export type UsageLimitReason =
  | "five_hour_window"
  | "weekly_cap"
  | "monthly_cap"
  | "copilot_remaining_zero"
  | "openrouter_credit_zero"
  | "usage_limit_reached";

export type TransientLimitClass = "rpm" | "tpm" | "concurrency" | "rate";

export type CheckpointStopAction = (typeof CHECKPOINT_STOP_ACTIONS)[number];

/** Schema-shaped `global.db.connection_windows` row. cwnd lives beside it in the same atomic record. */
export interface ConnectionWindowRow {
  readonly connection: string;
  readonly windowKind: WindowKind;
  readonly windowStart: number;
  readonly windowEnd: number;
  readonly limitUnits: number | null;
  readonly observedUnits: number | null;
  readonly estimatedUnits: number;
  readonly source: string | null;
  readonly observedAt: number | null;
}

export interface WindowUsage {
  kind: WindowKind;
  windowStartMs: number;
  windowEndMs: number;
  durationMs: number;
  usedPpm: number;
  observedPpm: number | null;
  reservedInFlightPpm: number;
  source: string | null;
  observedAtMs: number | null;
}

export interface BurnSample {
  readonly atMs: number;
  readonly deltaPpm: number;
  readonly windowKind: WindowKind;
}

export interface PacingTelemetry {
  readonly connectionId: string;
  readonly cwnd: number;
  readonly maxCwnd: number;
  readonly windowUsedPpm: number;
  readonly reserveCeilingPpm: number;
  readonly resetAt: number | null;
  readonly pacingState: PacingState;
}

export interface ProviderLimitSignal {
  readonly httpStatus: number | null;
  readonly bodyText: string;
  readonly retryAfterSeconds: number | null;
  readonly remainingPercent: number | null;
  readonly copilotRemaining: number | null;
  readonly openRouterCredit: number | null;
  readonly nowMs: number;
  readonly resetAtMs: number | null;
}

export interface CheckpointStopCardRequest {
  readonly kind: "checkpoint_stop";
  readonly connectionId: string;
  readonly projectId: string;
  readonly reason: "usage_limit_exhausted" | "reserve_ceiling";
  readonly usageLimitReason: UsageLimitReason | null;
  readonly resetAtMs: number | null;
  readonly actions: readonly CheckpointStopAction[];
  readonly retryAllowed: false;
  readonly usedPpm: number;
  readonly ceilingPpm: number;
}

export interface DiskHeadroomCard {
  readonly kind: "disk_headroom";
  readonly freeBytes: number;
  readonly requiredBytes: number;
  readonly message: string;
}

export interface SiwcRemainingHeaderSnapshot {
  readonly remainingPercent: number | null;
  readonly retryAfterSeconds: number | null;
  readonly resetAtMs: number | null;
}

export interface CopilotQuotaSnapshot {
  readonly remaining: number;
  readonly entitled: number | null;
  readonly remainingPercentage: number | null;
  readonly resetDateUtcMs: number | null;
}

export interface OpenRouterCreditSnapshot {
  readonly credit: number;
}

/**
 * Task 106 `SubscriptionWeight` shape.
 * `k[model]` is ppm per 1k tokens; `allowancePpmPer1M` is that weight scaled to 1M tokens.
 */
export interface SubscriptionWeightFeed {
  readonly connectionId: string;
  readonly modelId: string;
  readonly ppmPer1k: number;
  readonly allowancePpmPer1M: bigint;
  readonly precision: WeightPrecision;
  readonly safetyMargin: number;
}

export interface WindowSharePrediction {
  readonly connectionId: string;
  readonly modelId: string;
  readonly effectiveTokens: number;
  readonly expectedPpm: number;
  readonly reservationPpm: number;
  readonly label: string;
  readonly precision: WeightPrecision;
}

export interface ModelWeightView {
  readonly connectionId: string;
  readonly modelId: string;
  readonly ppmPer1k: number;
  readonly precision: WeightPrecision;
  readonly quotaSamples: number;
  readonly resetSamples: number;
  readonly lastResetAtMs: number | null;
  readonly previousResetAtMs: number | null;
}

export interface AimdSnapshot {
  cwnd: number;
  maxCwnd: number;
  cleanCompletions: number;
  cleanWindowStartedAtMs: number;
  cooldownUntilMs: number;
  backoffUntilMs: number;
  lastWaitMs: number;
}

export interface SlotSnapshot {
  backgroundInFlight: number;
  interactiveInFlight: number;
}

export interface LearnerModelSnapshot {
  ppmPer1k: number;
  priorPpmPer1k: number;
  covariance: number;
  quotaSamples: number;
  resetSamples: number;
  precision: WeightPrecision;
  lastResetAtMs: number | null;
  previousResetAtMs: number | null;
}

export interface AutoResumeSnapshot {
  optIn: boolean;
  resetAtMs: number | null;
  wakeAtMs: number | null;
}

export interface OpenGrant {
  grantId: string;
  projectId: string;
  taskId: string;
  modelId: string;
  role: string;
  slot: SlotKind;
  reservedPpm: number;
  ledgerReservationId: string;
}

/**
 * One global connection record. Projects share this row; it is never stored in a project `state.db`.
 * AIMD, burn samples, and `k[model]` sit in the same record because `connection_windows` has no
 * cwnd columns. The window fields map onto the frozen schema columns.
 */
export interface PersistedConnection {
  connectionId: string;
  provider: string;
  reserveFraction: number;
  connectionMaxCap: number;
  hardwareCap: number;
  aimd: AimdSnapshot;
  slots: SlotSnapshot;
  windows: WindowUsage[];
  burnSamples: BurnSample[];
  weights: Record<string, LearnerModelSnapshot>;
  autoResume: AutoResumeSnapshot;
  pacingState: PacingState;
  stopCardOpen: boolean;
  windDownEmitted: boolean;
  ceilingCardOpen: boolean;
  admittedDispatches: number;
  deniedWhileExhausted: number;
  grantCounter: number;
  grants: Record<string, OpenGrant>;
}

export interface ConnectionRegistration {
  readonly connectionId: string;
  readonly provider: string;
  readonly reserveFraction: number;
  readonly connectionMaxCap: number;
  readonly hardwareCap: number;
  readonly windows: readonly {
    readonly kind: WindowKind;
    readonly windowStartMs: number;
    readonly windowEndMs: number;
  }[];
  readonly priors: readonly {
    readonly modelId: string;
    readonly ppmPer1k: number;
  }[];
}

export interface DispatchRequest {
  readonly connectionId: string;
  readonly taskId: string;
  readonly modelId: string;
  readonly effectiveTokens: number;
  readonly role: string;
  readonly priority: "interactive" | "background";
}

export type SlotDecision =
  | {
      readonly ok: true;
      readonly grantId: string;
      readonly reservedPpm: number;
      readonly slot: SlotKind;
      readonly pacingState: PacingState;
    }
  | {
      readonly ok: false;
      readonly reason: string;
      readonly pacingState: PacingState;
      readonly retryAllowed: boolean;
      readonly retryAtMs: number | null;
      readonly boardMessage: string | null;
    };

export interface TurnCompletion {
  readonly connectionId: string;
  readonly grantId: string;
  readonly actualPpm: number;
  readonly effectiveTokens: number;
  readonly modelId: string;
  readonly deltaPpm: number | null;
  readonly quotaSource: QuotaSampleSource | null;
}

export interface LimitClassification {
  readonly kind: "none" | "transient_429" | "usage_limit_exhausted";
  readonly retryAfterMs: number | null;
  readonly limitClass: TransientLimitClass | null;
  readonly reason: UsageLimitReason | null;
  readonly resetAtMs: number | null;
  readonly retryAllowed: boolean;
}

export interface AppliedLimit {
  readonly classification: LimitClassification;
  readonly cwnd: number;
  readonly waitMs: number | null;
  readonly retryAllowed: boolean;
  readonly buildStopped: boolean;
  readonly boardMessage: string | null;
  readonly stopCard: CheckpointStopCardRequest | null;
}

export type AutoResumeAction = "idle" | "waiting" | "stay_parked" | "resume";

export interface AutoResumeDecision {
  readonly action: AutoResumeAction;
  readonly reason: string;
  readonly wakeAtMs: number | null;
  readonly cwnd: number | null;
  readonly diskCard: DiskHeadroomCard | null;
}

export interface FiveHourSimulationReport {
  readonly startedCwnd: number;
  readonly peakCwnd: number;
  readonly minCwndAfter429: number;
  readonly saw429Halving: boolean;
  readonly finalUsedPpm: number;
  readonly ceilingPpm: number;
  readonly tasksDispatched: number;
  readonly tasksCompleted: number;
  readonly tasksRemaining: number;
  readonly learnedPpmPer1k: number;
  readonly truePpmPer1k: number;
  readonly priorPpmPer1k: number;
  readonly providerCalls: number;
  readonly providerCallsAfterCwndZero: number;
  readonly crossedReserve: boolean;
  readonly windowMs: number;
}
