import { CrewLevelsError } from "./errors.js";
import { assertSafeCount } from "./money.js";
import {
  type CompiledTaskFeatures,
  type CrewRole,
  type DifficultyAssessment,
  type DifficultyTier,
  type RiskTag,
  type ScoreContribution,
  type WorkerTier,
  isRiskTag,
} from "./types.js";

const RISK_ORDER: readonly RiskTag[] = [
  "auth",
  "payments",
  "concurrency",
  "migrations",
  "security",
];

function banded(
  value: number,
  cuts: readonly { readonly below: number; readonly points: number }[],
  above: number,
): number {
  for (const cut of cuts) {
    if (value < cut.below) return cut.points;
  }
  return above;
}

function uniqueTags(tags: readonly RiskTag[]): RiskTag[] {
  const seen = new Set<RiskTag>();
  const ordered: RiskTag[] = [];
  for (const tag of RISK_ORDER) {
    if (tags.includes(tag) && !seen.has(tag)) {
      seen.add(tag);
      ordered.push(tag);
    }
  }
  return ordered;
}

function maxFileRank(features: CompiledTaskFeatures): number {
  let max = 0;
  for (const rank of features.fileRanks) {
    if (!Number.isFinite(rank.score) || rank.score < 0) {
      throw new CrewLevelsError("bad-task", "file_rank scores must be finite and >= 0");
    }
    if (rank.score > max) max = rank.score;
  }
  return max;
}

function tierForScore(score: number): DifficultyTier {
  if (score <= 2) return "trivial";
  if (score <= 5) return "standard";
  if (score <= 9) return "complex";
  return "critical";
}

function validateFeatures(features: CompiledTaskFeatures): void {
  if (features.taskId.trim().length === 0) {
    throw new CrewLevelsError("bad-task", "taskId is required");
  }
  assertSafeCount(features.fileCount, "fileCount");
  assertSafeCount(features.mustBandTokens, "mustBandTokens");
  assertSafeCount(features.contractFanIn, "contractFanIn");
  assertSafeCount(features.priorFailedAttempts, "priorFailedAttempts");
  if (features.language.trim().length === 0) {
    throw new CrewLevelsError("bad-task", "language is required");
  }
}

export class TaskDifficultyClassifier {
  classify(features: CompiledTaskFeatures): DifficultyAssessment {
    validateFeatures(features);
    const tags = uniqueTags(features.riskTags);
    const densityDivisor = Math.max(features.fileCount, 1);
    const density = features.mustBandTokens / densityDivisor;
    const rank = maxFileRank(features);
    const contributions: ScoreContribution[] = [
      {
        feature: "file_count",
        points: banded(
          features.fileCount,
          [
            { below: 2, points: 0 },
            { below: 4, points: 1 },
            { below: 9, points: 2 },
          ],
          4,
        ),
      },
      {
        feature: "must_density",
        points: banded(
          density,
          [
            { below: 500, points: 0 },
            { below: 1500, points: 1 },
            { below: 3000, points: 2 },
          ],
          4,
        ),
      },
      { feature: "risk_tags", points: tags.length * 2 },
      {
        feature: "migration",
        points:
          features.migrationKind === "destructive"
            ? 4
            : features.migrationKind === "expand-contract"
              ? 3
              : features.migrationKind === "additive"
                ? 1
                : 0,
      },
      {
        feature: "conflict_merge",
        points: features.crossFeatureConflictMerge ? 4 : 0,
      },
      {
        feature: "contract_fan_in",
        points: banded(
          features.contractFanIn,
          [
            { below: 2, points: 0 },
            { below: 4, points: 1 },
            { below: 9, points: 2 },
          ],
          4,
        ),
      },
      {
        feature: "file_rank",
        points: banded(
          rank,
          [
            { below: 0.0000001, points: 0 },
            { below: 0.05, points: 1 },
            { below: 0.2, points: 2 },
          ],
          rank <= 0 ? 0 : 4,
        ),
      },
      {
        feature: "retry_history",
        points: banded(
          features.priorFailedAttempts,
          [
            { below: 1, points: 0 },
            { below: 2, points: 1 },
            { below: 3, points: 2 },
          ],
          4,
        ),
      },
    ];

    let score = 0;
    for (const contribution of contributions) score += contribution.points;

    const criticalMarkers: string[] = [];
    if (tags.includes("auth")) criticalMarkers.push("auth");
    if (tags.includes("payments")) criticalMarkers.push("payments");
    if (tags.includes("migrations")) criticalMarkers.push("migrations");
    if (features.migrationKind === "destructive") {
      criticalMarkers.push("destructive-migration");
    }
    if (features.migrationKind === "expand-contract") {
      criticalMarkers.push("expand-contract-migration");
    }
    if (features.crossFeatureConflictMerge) {
      criticalMarkers.push("cross-feature-conflict-merge");
    }
    if (features.roleId === "oracle-author@1") criticalMarkers.push("oracle-author@1");

    if (criticalMarkers.length > 0 && score < 10) {
      contributions.push({ feature: "critical_marker", points: 10 - score });
      score = 10;
    } else if (
      criticalMarkers.length === 0 &&
      (tags.includes("concurrency") || tags.includes("security")) &&
      score < 6
    ) {
      contributions.push({ feature: "complex_marker", points: 6 - score });
      score = 6;
    }

    return {
      taskId: features.taskId,
      tier: tierForScore(score),
      score,
      contributions,
      criticalMarkers,
      greenfield: features.fileRanks.length === 0 || rank <= 0,
      language: features.language,
    };
  }
}

export function minimumWorkerLevel(
  assessment: DifficultyAssessment,
  role: CrewRole,
): WorkerTier {
  if (
    role === "oracle-author@1" ||
    assessment.tier === "critical" ||
    assessment.criticalMarkers.length > 0
  ) {
    return "Senior";
  }
  return "Junior";
}

export function assertClosedRiskTags(tags: readonly string[]): RiskTag[] {
  const accepted: RiskTag[] = [];
  for (const tag of tags) {
    if (isRiskTag(tag) && !accepted.includes(tag)) accepted.push(tag);
  }
  return accepted;
}
