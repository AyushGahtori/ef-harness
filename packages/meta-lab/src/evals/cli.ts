import { createMockEvalDependencies } from "./ports.js";
import { buildPromotionScorecard } from "./scorecard.js";
import { ThreeLevelEvalRunner } from "./runner.js";
import type { EvalLevel, PromotionExitCode } from "./types.js";

export interface MetaLabEvalCliOptions {
  readonly candidateId: string;
  readonly level: EvalLevel;
  readonly evalRunId?: string;
  readonly json?: boolean;
}

export interface MetaLabEvalCliResult {
  readonly exitCode: PromotionExitCode;
  readonly summary: string;
  readonly payload: Record<string, unknown>;
}

export function runMetaLabEvalCli(options: MetaLabEvalCliOptions): MetaLabEvalCliResult {
  const evalRunId = options.evalRunId ?? `eval-${options.candidateId}-${options.level}`;
  const deps = createMockEvalDependencies(options.candidateId);
  const runner = new ThreeLevelEvalRunner(deps);
  const result = runner.run({
    candidateId: options.candidateId,
    level: options.level,
    evalRunId,
    suiteDigest: deps.registry.suiteDigest,
    split: options.level === 3 ? "held_out" : "dev",
  });

  const promotion = result.report.promotion;
  const exitCode: PromotionExitCode = promotion?.exitCode ?? (result.abortedEarly ? 1 : 2);
  const summary = promotion?.reason ?? result.abortReason ?? "Evaluation complete";

  const payload: Record<string, unknown> = {
    candidateId: options.candidateId,
    level: options.level,
    evalRunId,
    abortedEarly: result.abortedEarly,
    baselinePassRate: result.baselinePassRate,
    candidatePassRate: result.candidatePassRate,
    promotion,
  };

  if (promotion) {
    const scorecard = buildPromotionScorecard(
      {
        evalRunId,
        baselineVersion: "active-v1",
        candidateVersion: options.candidateId,
        cases: [],
        vetoes: {},
      },
      promotion,
    );
    payload.scorecard = options.json ? scorecard.json : scorecard.markdown;
  }

  return { exitCode, summary, payload };
}

export function parseMetaLabEvalArgv(argv: readonly string[]): MetaLabEvalCliOptions | undefined {
  let candidateId: string | undefined;
  let level: EvalLevel = 1;
  let evalRunId: string | undefined;
  let json = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--candidate") {
      candidateId = argv[i + 1];
      i += 1;
    } else if (arg === "--level") {
      const raw = Number(argv[i + 1]);
      if (raw === 1 || raw === 2 || raw === 3) level = raw;
      i += 1;
    } else if (arg === "--eval-run-id") {
      evalRunId = argv[i + 1];
      i += 1;
    } else if (arg === "--json") {
      json = true;
    }
  }
  if (!candidateId) return undefined;
  return evalRunId !== undefined
    ? { candidateId, level, evalRunId, json }
    : { candidateId, level, json };
}