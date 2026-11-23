import {
  CALIBRATED_SAMPLE_COUNT,
  CONSERVATIVE_PRIOR_PPM_PER_1K,
  LEARNER_EMA_ALPHA,
  LEARNER_FORGETTING,
  LEARNER_MAX_STEP_FRACTION,
  LEARNER_MIN_COVARIANCE,
  RESERVATION_SAFETY_MARGIN,
} from "./constants.js";
import { PacingError } from "./errors.js";
import { clampPpm, formatFiveHourShare } from "./format.js";
import type {
  LearnerModelSnapshot,
  ModelWeightView,
  QuotaSampleSource,
  SubscriptionWeightFeed,
  WeightPrecision,
  WindowSharePrediction,
} from "./types.js";

export interface WeightObservation {
  readonly connectionId: string;
  readonly modelId: string;
  readonly effectiveTokens: number;
  readonly deltaPpm: number;
  readonly source: QuotaSampleSource;
}

export interface OpaqueResetObservation {
  readonly connectionId: string;
  readonly modelId: string;
  readonly tokensSinceLastReset: number;
  readonly resetAtMs: number;
  readonly previousResetAtMs: number | null;
}

/**
 * Learns k[model] in ppm per 1k effective tokens for one connection.
 * Quota deltas use bounded recursive least-squares blended with EMA.
 * Opaque windows keep the signed prior and a coarse reset estimate, and never divide by zero.
 */
export class ModelAllowanceWeightLearner {
  private readonly connectionId: string;
  private readonly models = new Map<string, LearnerModelSnapshot>();

  constructor(connectionId: string) {
    this.connectionId = connectionId;
  }

  static restore(
    connectionId: string,
    models: Record<string, LearnerModelSnapshot>,
  ): ModelAllowanceWeightLearner {
    const learner = new ModelAllowanceWeightLearner(connectionId);
    for (const [modelId, snapshot] of Object.entries(models)) {
      learner.models.set(modelId, { ...snapshot });
    }
    return learner;
  }

  snapshot(): Record<string, LearnerModelSnapshot> {
    const out: Record<string, LearnerModelSnapshot> = {};
    for (const [modelId, model] of this.models) out[modelId] = { ...model };
    return out;
  }

  seed(modelId: string, priorPpmPer1k: number): void {
    if (!(priorPpmPer1k > 0) || !Number.isFinite(priorPpmPer1k)) {
      throw new PacingError("invalid_prior", "Policy prior k[model] must be a positive finite number.");
    }
    const existing = this.models.get(modelId);
    if (existing && existing.quotaSamples > 0) return;
    this.models.set(modelId, {
      ppmPer1k: priorPpmPer1k,
      priorPpmPer1k,
      covariance: 1,
      quotaSamples: existing?.quotaSamples ?? 0,
      resetSamples: existing?.resetSamples ?? 0,
      precision: "prior",
      lastResetAtMs: existing?.lastResetAtMs ?? null,
      previousResetAtMs: existing?.previousResetAtMs ?? null,
    });
  }

  ensure(modelId: string): LearnerModelSnapshot {
    const existing = this.models.get(modelId);
    if (existing) return existing;
    this.seed(modelId, CONSERVATIVE_PRIOR_PPM_PER_1K);
    const created = this.models.get(modelId);
    if (!created) throw new PacingError("missing_model", "Failed to seed k[model].");
    return created;
  }

  observe(observation: WeightObservation): ModelWeightView {
    if (observation.connectionId !== this.connectionId) {
      throw new PacingError("connection_mismatch", "Weight observation is for a different connection.");
    }
    const model = this.ensure(observation.modelId);
    if (
      observation.source === "usage_limit_reset" ||
      !(observation.effectiveTokens > 0) ||
      !(observation.deltaPpm >= 0)
    ) {
      return this.view(observation.modelId);
    }
    const x = observation.effectiveTokens / 1_000;
    if (!(x > 0)) return this.view(observation.modelId);
    const observed = observation.deltaPpm / x;
    applyBoundedUpdate(model, x, observation.deltaPpm, observed);
    model.quotaSamples += 1;
    model.precision = model.quotaSamples >= CALIBRATED_SAMPLE_COUNT ? "calibrated" : "prior";
    return this.view(observation.modelId);
  }

  /**
   * Provider never reported remaining percent. Estimate from the tokens that filled the window
   * between observed usage-limit resets. Zero tokens leave the prior untouched.
   */
  observeUsageLimitReset(observation: OpaqueResetObservation): ModelWeightView {
    if (observation.connectionId !== this.connectionId) {
      throw new PacingError("connection_mismatch", "Reset observation is for a different connection.");
    }
    const model = this.ensure(observation.modelId);
    model.previousResetAtMs = observation.previousResetAtMs;
    model.lastResetAtMs = observation.resetAtMs;
    model.resetSamples += 1;
    if (!(observation.tokensSinceLastReset > 0)) {
      if (model.quotaSamples < CALIBRATED_SAMPLE_COUNT) model.precision = "prior";
      return this.view(observation.modelId);
    }
    const x = observation.tokensSinceLastReset / 1_000;
    const coarse = (1_000_000 * 1_000) / observation.tokensSinceLastReset;
    applyBoundedUpdate(model, x, coarse * x, coarse);
    if (model.quotaSamples < CALIBRATED_SAMPLE_COUNT) model.precision = "coarse_reset_estimate";
    return this.view(observation.modelId);
  }

  view(modelId: string): ModelWeightView {
    const model = this.ensure(modelId);
    return {
      connectionId: this.connectionId,
      modelId,
      ppmPer1k: model.ppmPer1k,
      precision: model.precision,
      quotaSamples: model.quotaSamples,
      resetSamples: model.resetSamples,
      lastResetAtMs: model.lastResetAtMs,
      previousResetAtMs: model.previousResetAtMs,
    };
  }

  reservationPpm(modelId: string, effectiveTokens: number): number {
    if (!(effectiveTokens > 0)) return 0;
    const model = this.ensure(modelId);
    return clampPpm((effectiveTokens / 1_000) * model.ppmPer1k * RESERVATION_SAFETY_MARGIN);
  }

  predictWindowShare(modelId: string, effectiveTokens: number): WindowSharePrediction {
    const model = this.ensure(modelId);
    const expectedPpm =
      effectiveTokens > 0 ? clampPpm((effectiveTokens / 1_000) * model.ppmPer1k) : 0;
    return {
      connectionId: this.connectionId,
      modelId,
      effectiveTokens,
      expectedPpm,
      reservationPpm: this.reservationPpm(modelId, effectiveTokens),
      label: formatFiveHourShare(expectedPpm),
      precision: model.precision,
    };
  }

  feeds(): SubscriptionWeightFeed[] {
    const feeds: SubscriptionWeightFeed[] = [];
    for (const [modelId, model] of this.models) {
      feeds.push({
        connectionId: this.connectionId,
        modelId,
        ppmPer1k: model.ppmPer1k,
        allowancePpmPer1M: BigInt(Math.max(0, Math.round(model.ppmPer1k * 1_000))),
        precision: model.precision,
        safetyMargin: RESERVATION_SAFETY_MARGIN,
      });
    }
    return feeds;
  }
}

function applyBoundedUpdate(
  model: LearnerModelSnapshot,
  x: number,
  y: number,
  observedPer1k: number,
): void {
  const p = model.covariance;
  const gain = (p * x) / (LEARNER_FORGETTING + x * p * x);
  const rls = model.ppmPer1k + gain * (y - model.ppmPer1k * x);
  const ema = model.ppmPer1k + LEARNER_EMA_ALPHA * (observedPer1k - model.ppmPer1k);
  let next = 0.5 * rls + 0.5 * ema;
  const stepCap = Math.abs(model.ppmPer1k) * LEARNER_MAX_STEP_FRACTION;
  next = clamp(next, model.ppmPer1k - stepCap, model.ppmPer1k + stepCap);
  const floorK = Math.max(1, model.priorPpmPer1k * 0.25);
  const ceilK = Math.max(floorK, model.priorPpmPer1k * 4);
  model.ppmPer1k = clamp(next, floorK, ceilK);
  const updated = (p - gain * x * p) / LEARNER_FORGETTING;
  model.covariance = Math.max(LEARNER_MIN_COVARIANCE, updated);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function precisionRank(precision: WeightPrecision): number {
  if (precision === "calibrated") return 2;
  if (precision === "coarse_reset_estimate") return 1;
  return 0;
}
