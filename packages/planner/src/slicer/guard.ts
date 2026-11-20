import { ATTEMPT_COST_USD, LEVEL_BUDGETS, type OversizedMustDetails, type SplitRecommendation, type TokenAttribution, type WorkerLevel } from "./types.js";
import { compareText, formatTokenK } from "./tokens.js";

export class OversizedMustTaskError extends Error {
  readonly code = "OversizedMustTaskError" as const;
  readonly taskId: string;
  readonly level: WorkerLevel;
  readonly mustTokens: number;
  readonly ceiling: number;
  readonly attribution: readonly TokenAttribution[];
  readonly recommendations: readonly SplitRecommendation[];
  readonly summary: string;

  constructor(details: OversizedMustDetails) {
    super(
      `OversizedMustTaskError: ${details.taskId} MUST band is ${details.mustTokens} tokens, above the ${details.level} ceiling ${details.ceiling}`,
    );
    this.name = "OversizedMustTaskError";
    this.taskId = details.taskId;
    this.level = details.level;
    this.mustTokens = details.mustTokens;
    this.ceiling = details.ceiling;
    this.attribution = details.attribution;
    this.recommendations = details.recommendations;
    this.summary = details.summary;
  }
}

export interface MustTokenSource {
  readonly id: string;
  readonly title: string;
  readonly tokens: number;
}

export class OversizedMustAutoSplitGuard {
  inspect(input: {
    readonly taskId: string;
    readonly level: WorkerLevel;
    readonly sources: readonly MustTokenSource[];
  }): OversizedMustTaskError | null {
    const mustTokens = input.sources.reduce((sum, source) => sum + source.tokens, 0);
    const ceiling = LEVEL_BUDGETS[input.level].mustRefusal;
    if (mustTokens <= ceiling) return null;
    const attribution = [...input.sources]
      .filter((source) => source.tokens > 0)
      .sort((left, right) => right.tokens - left.tokens || compareText(left.id, right.id))
      .map((source) => ({
        id: source.id,
        title: source.title,
        tokens: source.tokens,
        label: `${source.title}: ${formatTokenK(source.tokens)}`,
      }));
    const recommendations = recommend(input.level, mustTokens);
    const summary = recommendations.map((entry) => `${entry.action} ($${entry.estimatedUsd.toFixed(2)})`).join(" OR ");
    return new OversizedMustTaskError({
      taskId: input.taskId,
      level: input.level,
      mustTokens,
      ceiling,
      attribution,
      recommendations,
      summary,
    });
  }
}

function recommend(level: WorkerLevel, mustTokens: number): SplitRecommendation[] {
  const juniorPieces = Math.max(2, Math.ceil(mustTokens / LEVEL_BUDGETS.junior.mustRefusal));
  const seniorFits = mustTokens <= LEVEL_BUDGETS.senior.mustRefusal;
  if (level === "junior" && seniorFits) {
    return [
      {
        action: juniorPieces === 2 ? "Split into 2 Junior tasks" : `Split into ${juniorPieces} Junior tasks`,
        estimatedUsd: roundUsd(juniorPieces * ATTEMPT_COST_USD.junior),
      },
      { action: "Assign Senior level", estimatedUsd: ATTEMPT_COST_USD.senior },
    ];
  }
  const seniorPieces = Math.max(2, Math.ceil(mustTokens / LEVEL_BUDGETS.senior.mustRefusal));
  return [
    {
      action: juniorPieces === 2 ? "Split into 2 Junior tasks" : `Split into ${juniorPieces} Junior tasks`,
      estimatedUsd: roundUsd(juniorPieces * ATTEMPT_COST_USD.junior),
    },
    {
      action: `Split into ${seniorPieces} Senior tasks`,
      estimatedUsd: roundUsd(seniorPieces * ATTEMPT_COST_USD.senior),
    },
  ];
}

function roundUsd(value: number): number {
  return Math.round(value * 100) / 100;
}
