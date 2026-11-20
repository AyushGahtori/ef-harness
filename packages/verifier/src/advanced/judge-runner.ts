import { ReplayCassette } from "./cassette.js";
import { EvalSetSizeError } from "./errors.js";
import { sha256Hex } from "./hash.js";
import type { ModelProtocolAdapter, ModelStopReason } from "./ports.js";
import { parseRubricScore, type RubricScore } from "./rubric-schema.js";
import { assertThreshold, type ProductQualityDecisionNode } from "./threshold.js";
import { formatScoreLabel, formatThreshold, type AiEvalVerdict } from "./verdict.js";

export interface RubricCriterion {
  readonly id: string;
  readonly text: string;
  readonly critical?: boolean;
}

export interface EvalCase {
  readonly id: string;
  readonly input: string;
  readonly output: string;
  readonly rubric: readonly RubricCriterion[];
}

export interface CaseResult {
  readonly id: string;
  readonly status: "pass" | "fail" | "error";
  readonly criticalFailure: boolean;
  readonly samples: number;
}

export type UnavailableReason = Extract<ModelStopReason, "rate_limited" | "timeout" | "unavailable" | "over_budget">;

export interface JudgeRunReport {
  readonly taskStatus: "pass" | "fail" | "verified_except_quality";
  readonly qualityGate: "passed" | "failed" | "pending";
  readonly dependentsAllowed: boolean;
  readonly verdict: AiEvalVerdict | null;
  readonly costMicros: number;
  readonly cases: readonly CaseResult[];
  readonly warnings: readonly string[];
  readonly unavailableReason?: UnavailableReason;
}

export interface JudgeEvalRequest {
  readonly cases: readonly EvalCase[];
  readonly judge: ModelProtocolAdapter;
  readonly threshold: ProductQualityDecisionNode;
  readonly samples: number;
  readonly mode: "live" | "replay";
  readonly cassette?: ReplayCassette;
  readonly warnings: readonly string[];
  readonly generatorFamily: string;
  readonly judgeFamily: string;
  readonly developerAllowsDependents: boolean;
}

const UNAVAILABLE = new Set<ModelStopReason>(["rate_limited", "timeout", "unavailable", "over_budget"]);

export async function runJudgeEval(request: JudgeEvalRequest): Promise<JudgeRunReport> {
  assertThreshold(request.threshold);
  assertEvalSet(request.cases, request.threshold);
  if (!Number.isInteger(request.samples) || request.samples < 1) {
    throw new Error("judgeSamples must be a positive integer");
  }
  if (request.mode === "replay" && !request.cassette) {
    throw new Error("replay mode requires a cassette");
  }
  let costMicros = 0;
  const cases: CaseResult[] = [];
  for (const evalCase of request.cases) {
    const sampled = await scoreCase(evalCase, request, (amount) => {
      costMicros += amount;
    });
    if ("unavailable" in sampled) {
      return pendingReport(request, sampled.unavailable, costMicros, cases);
    }
    cases.push(sampled.result);
  }
  return finalReport(request, cases, costMicros);
}

function assertEvalSet(cases: readonly EvalCase[], threshold: ProductQualityDecisionNode): void {
  if (cases.length < 10 || cases.length > 30) {
    throw new EvalSetSizeError(cases.length);
  }
  if (cases.length !== threshold.total) {
    throw new Error(
      `threshold version ${threshold.version} total ${threshold.total} does not match eval set size ${cases.length}`,
    );
  }
  const ids = new Set<string>();
  for (const evalCase of cases) {
    if (ids.has(evalCase.id)) throw new Error(`duplicate eval case ${evalCase.id}`);
    ids.add(evalCase.id);
    if (evalCase.rubric.length === 0) throw new Error(`eval case ${evalCase.id} has no rubric`);
  }
}

async function scoreCase(
  evalCase: EvalCase,
  request: JudgeEvalRequest,
  addCost: (amount: number) => void,
): Promise<{ result: CaseResult } | { unavailable: UnavailableReason }> {
  let criticalFailure = false;
  let passVotes = 0;
  for (let sampleIndex = 0; sampleIndex < request.samples; sampleIndex += 1) {
    const prompt = buildJudgePrompt(evalCase, sampleIndex);
    const first = await obtain(request, prompt, "judge", sampleIndex, addCost);
    if ("unavailable" in first) return first;
    let parsed = parseRubricScore(first.text, evalCase.id);
    if (!parsed.ok) {
      const repairPrompt = buildRepairPrompt(prompt, parsed.error);
      const repaired = await obtain(request, repairPrompt, "format_repair", sampleIndex, addCost);
      if ("unavailable" in repaired) return repaired;
      parsed = parseRubricScore(repaired.text, evalCase.id);
    }
    if (!parsed.ok) {
      return {
        result: { id: evalCase.id, status: "error", criticalFailure: false, samples: request.samples },
      };
    }
    if (parsed.score.criticalFailure) criticalFailure = true;
    if (samplePasses(parsed.score)) passVotes += 1;
  }
  const passed = !criticalFailure && passVotes > request.samples / 2;
  return {
    result: {
      id: evalCase.id,
      status: passed ? "pass" : "fail",
      criticalFailure,
      samples: request.samples,
    },
  };
}

function samplePasses(score: RubricScore): boolean {
  return score.passed && !score.criticalFailure;
}

type Obtained = { text: string } | { unavailable: UnavailableReason };

async function obtain(
  request: JudgeEvalRequest,
  prompt: string,
  role: "judge" | "format_repair",
  sampleIndex: number,
  addCost: (amount: number) => void,
): Promise<Obtained> {
  const inputHash = sha256Hex(prompt);
  if (request.mode === "replay") {
    const cassette = request.cassette;
    if (!cassette) throw new Error("replay mode requires a cassette");
    return { text: cassette.replay(inputHash) };
  }
  const result = await request.judge.complete({
    role,
    prompt,
    inputHash,
    sampleIndex,
  });
  if (UNAVAILABLE.has(result.stopReason)) {
    return { unavailable: result.stopReason as UnavailableReason };
  }
  addCost(result.costMicros);
  request.cassette?.record(inputHash, result.text);
  return { text: result.text };
}

export function buildJudgePrompt(evalCase: EvalCase, sampleIndex: number): string {
  const criteria = [...evalCase.rubric];
  if (sampleIndex % 2 === 1) criteria.reverse();
  return [
    "Score only the rubric criteria. Do not reward longer answers.",
    "Return closed JSON matching the rubric score schema.",
    `caseId: ${evalCase.id}`,
    `sample: ${sampleIndex}`,
    `input: ${evalCase.input}`,
    `output: ${evalCase.output}`,
    ...criteria.map((criterion) => `criterion:${criterion.id}:${criterion.text}`),
  ].join("\n");
}

function buildRepairPrompt(original: string, error: string): string {
  return [
    original,
    "format-repair: the previous response was not closed rubric JSON.",
    `validator: ${error}`,
    "Return one JSON object with keys caseId, passed, criticalFailure, criteria.",
  ].join("\n");
}

function pendingReport(
  request: JudgeEvalRequest,
  unavailableReason: UnavailableReason,
  costMicros: number,
  cases: readonly CaseResult[],
): JudgeRunReport {
  return {
    taskStatus: "verified_except_quality",
    qualityGate: "pending",
    dependentsAllowed: request.developerAllowsDependents,
    verdict: null,
    costMicros,
    cases,
    warnings: request.warnings,
    unavailableReason,
  };
}

function finalReport(request: JudgeEvalRequest, cases: readonly CaseResult[], costMicros: number): JudgeRunReport {
  const passedCount = cases.filter((item) => item.status === "pass").length;
  const errorCount = cases.filter((item) => item.status === "error").length;
  const criticalFailures = cases.filter((item) => item.criticalFailure).length;
  const totalCount = cases.length;
  const threshold = formatThreshold(request.threshold.minPassed, request.threshold.total);
  const scoreLabel = formatScoreLabel(passedCount, totalCount, request.threshold.minPassed, request.threshold.total);
  const passed =
    passedCount >= request.threshold.minPassed && criticalFailures === 0 && errorCount === 0;
  const verdict: AiEvalVerdict = {
    passedCount,
    totalCount,
    threshold,
    criticalFailures,
    scoreLabel,
    passed,
    errorCount,
    rubricAuthor: "oracle-author@1",
    thresholdVersion: request.threshold.version,
    judgeFamily: request.judgeFamily,
    generatorFamily: request.generatorFamily,
    sampleCount: request.samples,
    warnings: request.warnings,
  };
  return {
    taskStatus: passed ? "pass" : "fail",
    qualityGate: passed ? "passed" : "failed",
    dependentsAllowed: passed,
    verdict,
    costMicros,
    cases,
    warnings: request.warnings,
  };
}
