import { JUNIOR_MUST_TOKEN_CEILING, SENIOR_MUST_TOKEN_CEILING } from "./vocabulary.js";
import type {
  BudgetSnapshot,
  CompilationDiagnostic,
  CompilationInput,
  ContradictionEdge,
  NameKind,
  PlanTask,
  TaskLevel,
  TokenAttribution,
} from "./types.js";

export interface MustBandMeasurement {
  readonly taskId: string;
  readonly level: TaskLevel;
  readonly tokens: number;
  readonly attribution: readonly TokenAttribution[];
  readonly ruleIds: readonly string[];
}

export type SplitRecommendation = "split" | "split_or_promote_senior";

export class OversizedMustTaskError extends Error {
  readonly code = "OversizedMustTaskError" as const;
  constructor(
    readonly taskId: string,
    readonly level: TaskLevel,
    readonly mustTokens: number,
    readonly ceiling: number,
    readonly attribution: readonly TokenAttribution[],
    readonly recommendation: SplitRecommendation,
  ) {
    const attributionText = attribution.map((item) => `${item.nodeId}:${item.tokens}`).join(",");
    const message =
      recommendation === "split_or_promote_senior"
        ? `Task ${taskId} MUST band is ${mustTokens} tokens, above the Junior ceiling ${ceiling}. Split into smaller tasks or promote to Senior. attribution=${attributionText}`
        : `Task ${taskId} MUST band is ${mustTokens} tokens, above the ${level} ceiling ${ceiling}. Split the task. attribution=${attributionText}`;
    super(message);
    this.name = "OversizedMustTaskError";
  }
}

export interface OversizedMustAutoSplitGuard {
  assertFits(measurement: MustBandMeasurement): OversizedMustTaskError | null;
}

export class LocalOversizedMustAutoSplitGuard implements OversizedMustAutoSplitGuard {
  assertFits(measurement: MustBandMeasurement): OversizedMustTaskError | null {
    const ceiling =
      measurement.level === "senior" ? SENIOR_MUST_TOKEN_CEILING : JUNIOR_MUST_TOKEN_CEILING;
    if (measurement.tokens <= ceiling) return null;
    const recommendation: SplitRecommendation =
      measurement.level === "junior" && measurement.tokens <= SENIOR_MUST_TOKEN_CEILING
        ? "split_or_promote_senior"
        : "split";
    return new OversizedMustTaskError(
      measurement.taskId,
      measurement.level,
      measurement.tokens,
      ceiling,
      measurement.attribution,
      recommendation,
    );
  }
}

export interface KnowledgePacketSlicer {
  measureMust(task: PlanTask): MustBandMeasurement;
}

export class LocalKnowledgePacketSlicer implements KnowledgePacketSlicer {
  measureMust(task: PlanTask): MustBandMeasurement {
    return {
      taskId: task.id,
      level: task.level,
      tokens: task.mustBandTokens,
      attribution: task.mustTokenAttribution,
      ruleIds: task.mustBandRuleIds,
    };
  }
}

export interface FiveLayerContradictionEngine {
  unresolvedContradictions(input: CompilationInput): readonly ContradictionEdge[];
}

export class LocalFiveLayerContradictionEngine implements FiveLayerContradictionEngine {
  unresolvedContradictions(input: CompilationInput): readonly ContradictionEdge[] {
    return input.contradictions.filter((edge) => !edge.resolved);
  }
}

export interface NameCollision {
  readonly kind: NameKind | "route";
  readonly reason: "duplicate" | "case_collision" | "route_shadow" | "brownfield_shadow";
  readonly left: string;
  readonly right: string;
  readonly leftOwner: string;
  readonly rightOwner: string;
}

export interface NameRegistryRepo {
  detectCollisions(input: CompilationInput): readonly NameCollision[];
}

export interface BudgetLedgerPort {
  remaining(input: CompilationInput): BudgetSnapshot;
}

export class LocalBudgetLedger implements BudgetLedgerPort {
  remaining(input: CompilationInput): BudgetSnapshot {
    return input.budget;
  }
}

export interface IndependentOracleAuthorSealer {
  sealedCheckIds(input: CompilationInput, featureId: string): readonly string[];
}

export class LocalIndependentOracleAuthorSealer implements IndependentOracleAuthorSealer {
  sealedCheckIds(input: CompilationInput, featureId: string): readonly string[] {
    return input.checks
      .filter((check) => check.featureId === featureId && check.visibility === "sealed")
      .map((check) => check.id);
  }
}

export interface JitFeaturePlanner {
  repair(
    input: CompilationInput,
    diagnostics: readonly CompilationDiagnostic[],
  ): CompilationInput | null;
}

export interface GraphCompilerPorts {
  readonly contradictionEngine?: FiveLayerContradictionEngine;
  readonly mustGuard?: OversizedMustAutoSplitGuard;
  readonly slicer?: KnowledgePacketSlicer;
  readonly planner?: JitFeaturePlanner;
  readonly oracleSealer?: IndependentOracleAuthorSealer;
  readonly nameRegistry?: NameRegistryRepo;
  readonly budgetLedger?: BudgetLedgerPort;
}

export function mustCeiling(level: TaskLevel): number {
  return level === "senior" ? SENIOR_MUST_TOKEN_CEILING : JUNIOR_MUST_TOKEN_CEILING;
}
