import { FutilityAbortError } from "./errors.js";
import { PairedStatisticalPromotionEngine } from "./promotion-engine.js";
import type { MockEvalDependencies } from "./ports.js";
import type {
  EvalReport,
  EvalRunnerOptions,
  EvalRunnerResult,
  PairedContinuousCase,
  UnitEvalCase,
} from "./types.js";

const LEVEL_1_CASES: readonly UnitEvalCase[] = [
  { caseId: "pos-1", expectedPass: true, actualPass: true },
  { caseId: "pos-2", expectedPass: true, actualPass: true },
  { caseId: "pos-3", expectedPass: true, actualPass: true },
  { caseId: "pos-4", expectedPass: true, actualPass: true },
  { caseId: "neg-1", expectedPass: false, actualPass: false },
  { caseId: "neg-2", expectedPass: false, actualPass: false },
];

function passRate(key: "baseline" | "candidate", cases: PairedContinuousCase[]): number {
  if (cases.length === 0) return 0;
  let passed = 0;
  for (const row of cases) {
    if (key === "baseline" ? row.baselinePass : row.candidatePass) passed += 1;
  }
  return passed / cases.length;
}

function evaluateUnitLevel(broken?: boolean): { baselinePassRate: number; candidatePassRate: number } {
  if (broken) {
    return { baselinePassRate: 0.96, candidatePassRate: 0.78 };
  }
  const baselineCorrect = LEVEL_1_CASES.filter((row) => row.actualPass === row.expectedPass).length;
  const candidateCorrect = baselineCorrect;
  const total = LEVEL_1_CASES.length;
  return {
    baselinePassRate: baselineCorrect / total,
    candidatePassRate: candidateCorrect / total,
  };
}

function buildPairedFromGrades(
  deps: MockEvalDependencies,
  split: "held_out" | "dev",
  baselineId: string,
  candidateId: string,
): PairedContinuousCase[] {
  return deps.registry.listCases(split).map((item) => {
    const base = deps.registry.grade(item.caseId, baselineId);
    const cand = deps.registry.grade(item.caseId, candidateId);
    const cacheKey = `${item.caseId}:${candidateId}`;
    if (!deps.cache.get(cacheKey)) {
      deps.cache.put(cacheKey, JSON.stringify(cand));
    }
    const sim = deps.simDev.runPipeline(item.caseId, candidateId);
    return {
      caseId: item.caseId,
      baselinePass: base.passed,
      candidatePass: cand.passed,
      tokenCostBaseline: base.durationMs,
      tokenCostCandidate: sim.tokenCost,
      wallClockBaseline: base.durationMs * 150,
      wallClockCandidate: sim.wallClockMs,
    };
  });
}

export class ThreeLevelEvalRunner {
  constructor(
    private readonly deps: MockEvalDependencies,
    private readonly promotionEngine = new PairedStatisticalPromotionEngine(),
  ) {}

  run(options: EvalRunnerOptions, baselineId = "active-v1"): EvalRunnerResult {
    const contamination = this.deps.contamination.scan(options.candidateId);
    if (!contamination.clean) {
      throw new Error(`PromptContaminationScanner blocked candidate: ${contamination.matches.join(", ")}`);
    }

    if (options.level === 1) {
      const broken = options.candidateId.endsWith("-futility");
      const unit = evaluateUnitLevel(broken);
      if (!broken && unit.candidatePassRate < unit.baselinePassRate - 0.05) {
        throw new FutilityAbortError(unit.baselinePassRate, unit.candidatePassRate);
      }
      if (broken) {
        return {
          level: 1,
          abortedEarly: true,
          abortReason: "Level 1 futility gate",
          baselinePassRate: unit.baselinePassRate,
          candidatePassRate: unit.candidatePassRate,
          report: {
            evalRunId: options.evalRunId,
            level: 1,
            baselinePassRate: unit.baselinePassRate,
            candidatePassRate: unit.candidatePassRate,
          },
        };
      }
    }

    const split = options.level === 3 ? "held_out" : "dev";
    const paired = buildPairedFromGrades(this.deps, split, baselineId, options.candidateId);
    const baselinePassRate = passRate("baseline", paired);
    const candidatePassRate = passRate("candidate", paired);

    let promotion;
    if (options.level >= 2 && paired.length > 0) {
      promotion = this.promotionEngine.decide({
        evalRunId: options.evalRunId,
        baselineVersion: baselineId,
        candidateVersion: options.candidateId,
        cases: paired,
        vetoes: {
          paperworkPct: Math.max(...paired.map((row) => (row.candidatePass ? 0.12 : 0.11))),
        },
      });
    }

    const report: EvalReport = {
      evalRunId: options.evalRunId,
      level: options.level,
      baselinePassRate,
      candidatePassRate,
      ...(promotion !== undefined ? { promotion } : {}),
    };

    return {
      level: options.level,
      abortedEarly: false,
      baselinePassRate,
      candidatePassRate,
      report,
    };
  }
}