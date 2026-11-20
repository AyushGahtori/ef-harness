import { CrewLevelsError } from "./errors.js";
import { clampPassProbability, probabilityMicro } from "./money.js";
import type { TelemetryRecordView } from "./ports.js";
import {
  type DifficultyTier,
  type PassEstimate,
  type PassPriors,
  PRIOR_STRENGTH,
  isDifficultyTier,
} from "./types.js";
import type { VersionedModelRoster } from "./roster.js";

export interface PassObservation {
  readonly modelId: string;
  readonly difficulty: DifficultyTier;
  readonly language: string;
  readonly passed: boolean;
  readonly phase: "first_pass" | "retry";
}

interface Counts {
  readonly successes: number;
  readonly failures: number;
}

const EMPTY: Counts = { successes: 0, failures: 0 };

export function betaBinomialMean(
  prior: number,
  successes: number,
  failures: number,
): number {
  if (!Number.isSafeInteger(successes) || successes < 0) {
    throw new CrewLevelsError("bad-task", "successes must be a non-negative integer");
  }
  if (!Number.isSafeInteger(failures) || failures < 0) {
    throw new CrewLevelsError("bad-task", "failures must be a non-negative integer");
  }
  const seeded = clampPassProbability(prior);
  const alpha = seeded * PRIOR_STRENGTH;
  const beta = (1 - seeded) * PRIOR_STRENGTH;
  const mean = (alpha + successes) / (alpha + beta + successes + failures);
  return clampPassProbability(mean);
}

function observationKey(modelId: string, difficulty: DifficultyTier, language: string): string {
  return `${modelId}\u0000${difficulty}\u0000${language}`;
}

function priorValue(table: PassPriors, difficulty: DifficultyTier): number {
  switch (difficulty) {
    case "trivial":
      return table.trivial;
    case "standard":
      return table.standard;
    case "complex":
      return table.complex;
    case "critical":
      return table.critical;
  }
}

function addCount(map: Map<string, Counts>, key: string, passed: boolean): void {
  const current = map.get(key) ?? EMPTY;
  map.set(key, {
    successes: current.successes + (passed ? 1 : 0),
    failures: current.failures + (passed ? 0 : 1),
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function passObservationFromMetric(data: unknown): PassObservation | null {
  if (!isRecord(data)) return null;
  const modelId = data.modelId;
  const difficulty = data.difficulty;
  const language = data.language;
  const passed = data.passed;
  const phase = data.phase;
  if (typeof modelId !== "string" || modelId.length === 0) return null;
  if (typeof difficulty !== "string" || !isDifficultyTier(difficulty)) return null;
  if (typeof language !== "string" || language.length === 0) return null;
  if (typeof passed !== "boolean") return null;
  if (phase !== "first_pass" && phase !== "retry") return null;
  return { modelId, difficulty, language, passed, phase };
}

export function passObservationsFromTelemetry(
  records: readonly TelemetryRecordView[],
): PassObservation[] {
  const observations: PassObservation[] = [];
  for (const record of records) {
    if (record.kind !== "metric") continue;
    const parsed = passObservationFromMetric(record.data);
    if (parsed !== null) observations.push(parsed);
  }
  return observations;
}

function estimate(prior: number, counts: Counts): PassEstimate {
  const probability = betaBinomialMean(prior, counts.successes, counts.failures);
  return {
    probability,
    probabilityMicro: probabilityMicro(probability),
    successes: counts.successes,
    failures: counts.failures,
    observations: counts.successes + counts.failures,
    prior: clampPassProbability(prior),
    stronglyShifted: counts.successes + counts.failures >= PRIOR_STRENGTH,
  };
}

export class HistoricalPassRateCalibrator {
  private constructor(
    private readonly priors: ReadonlyMap<string, number>,
    private readonly firstPassCounts: ReadonlyMap<string, Counts>,
    private readonly retryCounts: ReadonlyMap<string, Counts>,
    private readonly fallbackPrior: number,
  ) {}

  static fromObservations(
    priors: ReadonlyMap<string, PassPriors>,
    observations: readonly PassObservation[],
    fallbackPrior = 0.62,
  ): HistoricalPassRateCalibrator {
    const priorMeans = new Map<string, number>();
    for (const [modelId, table] of priors) {
      const tiers: DifficultyTier[] = ["trivial", "standard", "complex", "critical"];
      for (const tier of tiers) {
        priorMeans.set(observationKey(modelId, tier, "*"), priorValue(table, tier));
      }
    }
    const firstPass = new Map<string, Counts>();
    const retry = new Map<string, Counts>();
    for (const observation of observations) {
      const key = observationKey(
        observation.modelId,
        observation.difficulty,
        observation.language,
      );
      if (observation.phase === "first_pass") addCount(firstPass, key, observation.passed);
      else addCount(retry, key, observation.passed);
    }
    return new HistoricalPassRateCalibrator(
      priorMeans,
      firstPass,
      retry,
      clampPassProbability(fallbackPrior),
    );
  }

  static fromRoster(
    roster: VersionedModelRoster,
    observations: readonly PassObservation[],
  ): HistoricalPassRateCalibrator {
    const priors = new Map<string, PassPriors>();
    for (const entry of roster.entries) {
      priors.set(entry.modelId, entry.defaultPassPriors);
    }
    return HistoricalPassRateCalibrator.fromObservations(priors, observations);
  }

  firstPass(modelId: string, difficulty: DifficultyTier, language: string): PassEstimate {
    return this.lookup(this.firstPassCounts, modelId, difficulty, language);
  }

  retry(modelId: string, difficulty: DifficultyTier, language: string): PassEstimate {
    return this.lookup(this.retryCounts, modelId, difficulty, language);
  }

  private lookup(
    counts: ReadonlyMap<string, Counts>,
    modelId: string,
    difficulty: DifficultyTier,
    language: string,
  ): PassEstimate {
    const key = observationKey(modelId, difficulty, language);
    const prior =
      this.priors.get(observationKey(modelId, difficulty, "*")) ?? this.fallbackPrior;
    return estimate(prior, counts.get(key) ?? EMPTY);
  }
}
