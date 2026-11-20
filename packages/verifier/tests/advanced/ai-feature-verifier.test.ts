import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  AiFeatureVerifier,
  EvalSetSizeError,
  FakeModelAdapter,
  JudgeFamilyError,
  ReplayCassette,
  ReplayCassetteStaleError,
  StubModel,
  type EvalCase,
  type ModelCompletionRequest,
  type ModelCompletionResult,
  type ModelFamilyProfile,
  type ProductQualityDecisionNode,
  type ShellFeature,
} from "../../src/advanced/index.js";

const openai: ModelFamilyProfile = { id: "gpt-test", family: "openai", provider: "openai" };
const anthropic: ModelFamilyProfile = { id: "claude-test", family: "anthropic", provider: "anthropic" };

const answerSchema = z.object({ answer: z.string() }).strict();

describe("AiFeatureVerifier", () => {
  it("drives a stub model through prompt assembly, malformed JSON, retry, fallback, and cost cap", async () => {
    const judge = new FakeModelAdapter(anthropic, () => {
      throw new Error("judge must not run during the shell");
    });
    const verifier = crossFamilyVerifier({ judgeAdapter: judge });

    const crashing = new StubModel(openai, [{ kind: "malformed_json", text: "{" }]);
    const crashed = await verifier.runShell(feature(throwingParse), { user: "hello" }, crashing);
    expect(crashed.status).toBe("shell_error");
    expect(crashed.judgeSpendMicros).toBe(0);
    expect(crashed.elapsedMs).toBeLessThan(100);
    expect(crashed.attempts).toBe(1);
    expect(judge.calls).toHaveLength(0);
    expect(crashing.calls).toHaveLength(1);

    const retried = new StubModel(openai, [
      { kind: "malformed_json", text: "{" },
      { kind: "valid", json: { answer: "ok" }, costMicros: 1 },
    ]);
    const retriedReport = await verifier.runShell(feature(softParse), { user: "hello" }, retried);
    expect(retriedReport.status).toBe("pass");
    expect(retriedReport.attempts).toBe(2);
    expect(retriedReport.value).toEqual({ answer: "ok" });
    expect(retriedReport.prompt).toContain("user=hello");

    const again = new StubModel(openai, [{ kind: "valid", json: { answer: "ok" }, costMicros: 1 }]);
    const second = await verifier.runShell(feature(softParse), { user: "hello" }, again);
    expect(second.promptHash).toBe(retriedReport.promptHash);

    const exhausted = new StubModel(openai, [{ kind: "empty" }, { kind: "empty" }]);
    const fallback = await verifier.runShell(feature(softParse), { user: "hello" }, exhausted);
    expect(fallback.status).toBe("fallback");
    expect(fallback.attempts).toBe(2);
    expect(fallback.value).toEqual({ answer: "fallback" });

    const capped = new StubModel(openai, [{ kind: "over_budget", costMicros: 1 }]);
    const costCap = await verifier.runShell(feature(softParse), { user: "hello" }, capped);
    expect(costCap.status).toBe("cost_capped");
    expect(costCap.value).toEqual({ answer: "fallback" });
    expect(capped.calls).toHaveLength(1);
    expect(costCap.judgeSpendMicros).toBe(0);

    const expensive = new StubModel(openai, [{ kind: "valid", json: { answer: "ok" }, costMicros: 1_000 }]);
    const overLimit = await verifier.runShell(feature(softParse), { user: "hello" }, expensive);
    expect(overLimit.status).toBe("cost_capped");
    expect(expensive.calls).toHaveLength(1);

    const limited = new StubModel(openai, [
      { kind: "rate_limited" },
      { kind: "valid", json: { answer: "ok" }, costMicros: 1 },
    ]);
    const afterLimit = await verifier.runShell(feature(softParse), { user: "hello" }, limited);
    expect(afterLimit.status).toBe("pass");
    expect(afterLimit.attempts).toBe(2);
    expect(afterLimit.judgeSpendMicros).toBe(0);

    const timedOut = new StubModel(openai, [{ kind: "timeout" }, { kind: "timeout" }]);
    const afterTimeout = await verifier.runShell(feature(softParse), { user: "hello" }, timedOut);
    expect(afterTimeout.status).toBe("fallback");
    expect(afterTimeout.attempts).toBe(2);
    expect(afterTimeout.value).toEqual({ answer: "fallback" });
    expect(afterTimeout.judgeSpendMicros).toBe(0);
  });

  it("checks schema, required facts, citations, length, and forbidden content", () => {
    const verifier = crossFamilyVerifier();
    const spec = {
      schema: z.object({ answer: z.string(), citation: z.string() }).strict(),
      requiredFacts: ["Soup"],
      requiredCitations: ["menu#1"],
      maxChars: 200,
      forbidden: ["free money"],
    };
    expect(verifier.checkOutput({ answer: "Soup is ready", citation: "menu#1" }, spec).passed).toBe(true);
    const hallucinated = verifier.checkOutput({ answer: "Soup is free money", citation: "menu#1" }, spec);
    expect(hallucinated.passed).toBe(false);
    expect(hallucinated.forbiddenHits).toEqual(["free money"]);
    expect(verifier.checkOutput({ answer: "ready", citation: "menu#1" }, spec).missingFacts).toEqual(["Soup"]);
    expect(verifier.checkOutput({ answer: "Soup", citation: "none" }, spec).missingCitations).toEqual(["menu#1"]);
    expect(verifier.checkOutput({ answer: "Soup", citation: "menu#1" }, { ...spec, maxChars: 5 }).lengthOk).toBe(false);
    expect(verifier.checkOutput({ answer: "Soup" }, spec).schemaOk).toBe(false);
  });

  it("scores an eval set as a threshold label and fails when the tightened decision node is missed", async () => {
    const verifier = crossFamilyVerifier();
    const cases = evalCases();
    const loose = await verifier.runJudge(cases, scriptedJudge((caseId) => {
      const failing = caseId === "case-9" || caseId === "case-10";
      return score(caseId, !failing, false);
    }), quality(1, 8));
    const tight = await verifier.runJudge(cases, scriptedJudge((caseId) => {
      const failing = caseId === "case-9" || caseId === "case-10";
      return score(caseId, !failing, false);
    }), quality(2, 10));
    expect(loose.taskStatus).toBe("pass");
    expect(loose.verdict).toMatchObject({
      passedCount: 8,
      totalCount: 10,
      threshold: "8/10",
      criticalFailures: 0,
      scoreLabel: "8/10 (threshold 8/10)",
      passed: true,
      rubricAuthor: "oracle-author@1",
      thresholdVersion: 1,
    });
    expect(tight.taskStatus).toBe("fail");
    expect(tight.verdict?.scoreLabel).toBe("8/10 (threshold 10/10)");
    expect(tight.verdict?.passed).toBe(false);
    expect(tight.verdict?.thresholdVersion).toBe(2);
    expect(JSON.stringify(loose.verdict)).not.toBe("true");
  });

  it("fails the gate when one critical failure overrides a 9/10 aggregate", async () => {
    const report = await crossFamilyVerifier().runJudge(evalCases(), scriptedJudge((caseId) => {
      if (caseId === "case-10") return score(caseId, false, true);
      return score(caseId, true, false);
    }), quality(1, 8));
    expect(report.verdict).toMatchObject({
      passedCount: 9,
      totalCount: 10,
      threshold: "8/10",
      criticalFailures: 1,
      scoreLabel: "9/10 (threshold 8/10)",
      passed: false,
    });
    expect(report.taskStatus).toBe("fail");
    expect(report.qualityGate).toBe("failed");
  });

  it("marks prose rubric output as error after one format-repair retry", async () => {
    const judge = new FakeModelAdapter(anthropic, () => textResult("The answer looks pretty good."));
    const report = await crossFamilyVerifier().runJudge(evalCases(), judge, quality(1, 8));
    expect(report.verdict?.passed).toBe(false);
    expect(report.cases.every((item) => item.status === "error")).toBe(true);
    expect(judge.calls).toHaveLength(20);
    expect(judge.calls.filter((call) => call.role === "format_repair")).toHaveLength(10);
  });

  it("accepts a case when the single format-repair retry returns closed JSON", async () => {
    const judge = new FakeModelAdapter(anthropic, (request) => {
      const caseId = caseIdFrom(request.prompt);
      if (request.role === "format_repair") return textResult(score(caseId, true, false));
      if (caseId === "case-1") {
        return textResult(JSON.stringify({ ...JSON.parse(score(caseId, true, false)), extra: true }));
      }
      return textResult(score(caseId, true, false));
    });
    const report = await crossFamilyVerifier().runJudge(evalCases(), judge, quality(1, 8));
    expect(report.verdict?.passedCount).toBe(10);
    expect(report.verdict?.passed).toBe(true);
    expect(judge.calls.filter((call) => call.role === "format_repair")).toHaveLength(1);
  });

  it("reverses rubric order on alternate samples to counter position bias", async () => {
    const judge = new FakeModelAdapter(anthropic, (request) => textResult(score(caseIdFrom(request.prompt), true, false)));
    const verifier = crossFamilyVerifier({ judgeSamples: 2 });
    const report = await verifier.runJudge(evalCases(), judge, quality(1, 8));
    expect(report.verdict?.sampleCount).toBe(2);
    expect(judge.calls).toHaveLength(20);
    const alternate = judge.calls[1]?.prompt ?? "";
    expect(alternate).toContain("Do not reward longer answers.");
    expect(alternate.indexOf("criterion:safety")).toBeGreaterThanOrEqual(0);
    expect(alternate.indexOf("criterion:safety")).toBeLessThan(alternate.indexOf("criterion:facts"));
  });

  it("leaves quality pending when the judge is rate-limited and allows dependents only when asked", async () => {
    const blocked = new FakeModelAdapter(anthropic, () => textResult("", "rate_limited"));
    const held = await crossFamilyVerifier().runJudge(evalCases(), blocked, quality(1, 8));
    expect(held.taskStatus).toBe("verified_except_quality");
    expect(held.qualityGate).toBe("pending");
    expect(held.dependentsAllowed).toBe(false);
    expect(held.verdict).toBeNull();
    expect(held.taskStatus).not.toBe("pass");

    const allowedJudge = new FakeModelAdapter(anthropic, () => textResult("", "unavailable"));
    const allowed = await crossFamilyVerifier({ developerAllowsDependents: true }).runJudge(
      evalCases(),
      allowedJudge,
      quality(1, 8),
    );
    expect(allowed.taskStatus).toBe("verified_except_quality");
    expect(allowed.dependentsAllowed).toBe(true);
    const surface = await crossFamilyVerifier({ developerAllowsDependents: true }).verify({
      taskId: "T-64",
      commitSha: "abc",
      metadata: {},
      surfaceInput: {
        judge: { cases: evalCases(), adapter: new FakeModelAdapter(anthropic, () => textResult("", "timeout")) },
      },
    });
    expect(surface[0]?.status).toBe("pending");
    expect(surface[0]?.checkId).toBe("T-64:judge");
  });

  it("replays a cassette for zero cost and rejects a stale prompt hash", async () => {
    const cassette = new ReplayCassette();
    const cases = evalCases();
    const liveJudge = scriptedJudge((caseId) => score(caseId, true, false));
    const live = crossFamilyVerifier({ cassette, mode: "live" });
    const recorded = await live.runJudge(cases, liveJudge, quality(1, 8));
    expect(recorded.verdict?.scoreLabel).toBe("10/10 (threshold 8/10)");
    expect(cassette.size).toBeGreaterThan(0);

    const replayJudge = new FakeModelAdapter(anthropic, () => {
      throw new Error("replay must not call the judge");
    });
    const replay = crossFamilyVerifier({ cassette, mode: "replay" });
    const replayed = await replay.runJudge(cases, replayJudge, quality(1, 8));
    expect(replayJudge.calls).toHaveLength(0);
    expect(replayed.costMicros).toBe(0);
    expect(replayed.verdict?.scoreLabel).toBe(recorded.verdict?.scoreLabel);

    const edited = cases.map((item, index) => (index === 0 ? { ...item, output: "edited prompt output" } : item));
    await expect(replay.runJudge(edited, replayJudge, quality(1, 8))).rejects.toBeInstanceOf(ReplayCassetteStaleError);
  });

  it("selects a different judge family and warns when only one family is connected", async () => {
    const swapped = crossFamilyVerifier({
      generator: openai,
      judge: openai,
      connectedFamilies: [openai, anthropic],
    });
    expect(swapped.judgeSelection).toBe("auto_cross_family");
    expect(swapped.judgeProfile.family).toBe("anthropic");
    expect(swapped.warnings).not.toContain("single_family_judge_warning");
    await expect(
      swapped.runJudge(evalCases().slice(0, 1), new FakeModelAdapter(openai, () => textResult("{}"))),
    ).rejects.toBeInstanceOf(JudgeFamilyError);

    const judge = new FakeModelAdapter(openai, () => {
      throw new Error("judge must not run during the shell");
    });
    const single = crossFamilyVerifier({
      generator: openai,
      judge: openai,
      connectedFamilies: [openai],
      judgeAdapter: judge,
    });
    expect(single.warnings).toContain("single_family_judge_warning");
    const shell = await single.runShell(
      feature(softParse),
      { user: "hello" },
      new StubModel(openai, [{ kind: "valid", json: { answer: "ok" }, costMicros: 1 }]),
    );
    expect(shell.warnings).toContain("single_family_judge_warning");
    expect(judge.calls).toHaveLength(0);
  });

  it("rejects an eval set outside the 10 to 30 case range", async () => {
    await expect(
      crossFamilyVerifier().runJudge(evalCases(9), scriptedJudge(() => score("case-1", true, false)), quality(1, 8)),
    ).rejects.toBeInstanceOf(EvalSetSizeError);
  });
});

function crossFamilyVerifier(overrides: Partial<ConstructorParameters<typeof AiFeatureVerifier>[0]> = {}) {
  return new AiFeatureVerifier({
    generator: openai,
    judge: anthropic,
    connectedFamilies: [openai, anthropic],
    threshold: quality(1, 8),
    ...overrides,
  });
}

function quality(version: number, minPassed: number, total = 10): ProductQualityDecisionNode {
  return { id: "product.quality", version, minPassed, total, maxCriticalFailures: 0 };
}

function feature(parse: ShellFeature["parse"]): ShellFeature {
  return {
    id: "summarize",
    maxRetries: 1,
    costLimitMicros: 100,
    outputSchema: answerSchema,
    assemblePrompt(input) {
      return `schema=Answer\nuser=${input.user}`;
    },
    parse,
    fallback() {
      return { answer: "fallback" };
    },
  };
}

function throwingParse(raw: string): { ok: true; value: unknown } {
  return { ok: true, value: JSON.parse(raw) as unknown };
}

function softParse(raw: string): { ok: true; value: unknown } | { ok: false; reason: string } {
  try {
    return { ok: true, value: JSON.parse(raw) as unknown };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, reason: message };
  }
}

function evalCases(count = 10): EvalCase[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `case-${index + 1}`,
    input: `input ${index + 1}`,
    output: `output ${index + 1}`,
    rubric: [
      { id: "facts", text: "Required facts are present" },
      { id: "safety", text: "No forbidden content", critical: true },
    ],
  }));
}

function score(caseId: string, passed: boolean, criticalFailure: boolean): string {
  return JSON.stringify({
    caseId,
    passed,
    criticalFailure,
    criteria: [
      { id: "facts", met: passed },
      { id: "safety", met: !criticalFailure },
    ],
  });
}

function textResult(
  text: string,
  stopReason: ModelCompletionResult["stopReason"] = "stop",
  costMicros = 1,
): ModelCompletionResult {
  return {
    text,
    inputTokens: 1,
    outputTokens: text.length,
    costMicros,
    stopReason,
    latencyMs: 0,
  };
}

function scriptedJudge(body: (caseId: string, request: ModelCompletionRequest) => string): FakeModelAdapter {
  return new FakeModelAdapter(anthropic, (request) => textResult(body(caseIdFrom(request.prompt), request)));
}

function caseIdFrom(prompt: string): string {
  const match = /^caseId: (.+)$/m.exec(prompt);
  const caseId = match?.[1];
  if (!caseId) throw new Error("prompt is missing caseId");
  return caseId;
}
