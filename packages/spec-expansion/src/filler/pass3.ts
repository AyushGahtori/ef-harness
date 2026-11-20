import { EarsOracleValidator } from "./ears-oracle-validator.js";
import { applyRiskFloor } from "./risk-floor.js";
import { parseSpecExpanderOutput } from "./spec-expander-contract.js";
import type {
  ContradictionPair,
  ContradictionRecheckPort,
  FeatureBudget,
  FillDiagnostic,
  OpenCell,
  RiskTier,
  SpecExpanderCell,
  SpecExpanderModel,
} from "./types.js";
import { PASS3_BATCH_LIMIT } from "./types.js";

const REPAIR_INSTRUCTION =
  "Repair only the listed cells. Use one EARS sentence. Name a concrete HTTP status, a UI error banner, or a retry behavior. Include an oracle sketch with an exact input and an observable outcome. Do not invent scope.";

export interface Pass3KnownFill {
  readonly earsText: string;
  readonly pass: 1 | 2;
  readonly sourceId: string;
}

export interface Pass3Input {
  readonly cells: readonly OpenCell[];
  readonly model: SpecExpanderModel;
  readonly premiseIds: readonly string[];
  readonly budget: FeatureBudget;
  readonly forbiddenScopePhrases: readonly string[];
  readonly knownFills: ReadonlyMap<string, Pass3KnownFill>;
  readonly contradiction: ContradictionRecheckPort;
  readonly attempt: string;
}

export interface Pass3CellResult {
  readonly cellId: string;
  readonly featureId: string;
  readonly matrixId: string;
  readonly subject: string;
  readonly title: string;
  readonly touches: readonly string[];
  readonly kind: "auto_accept" | "review" | "must_ask" | "needs_review";
  readonly earsText: string | null;
  readonly oracleSketch: string | null;
  readonly value: string | null;
  readonly risk: RiskTier | null;
  readonly modelRisk: RiskTier | null;
  readonly forcedHigh: boolean;
  readonly premises: readonly string[];
  readonly problems: readonly string[];
  readonly question: string | null;
}

export interface Pass3Result {
  readonly cells: readonly Pass3CellResult[];
  readonly diagnostics: readonly FillDiagnostic[];
  readonly llmCalls: number;
  readonly tokensSpent: number;
}

export class LlmCellExpanderPass3 {
  private readonly validator = new EarsOracleValidator();

  expand(input: Pass3Input): Pass3Result {
    const diagnostics: FillDiagnostic[] = [];
    const results: Pass3CellResult[] = [];
    const usage = new Map<string, { calls: number; tokens: number }>();
    let step = 0;
    const groups = groupCells(input.cells);
    for (const group of groups) {
      for (const batch of chunk(group, PASS3_BATCH_LIMIT)) {
        const expanded = this.expandBatch(input, batch, usage, diagnostics, () => {
          step += 1;
          return step;
        });
        results.push(...expanded);
      }
    }
    return {
      cells: results,
      diagnostics,
      llmCalls: [...usage.values()].reduce((sum, item) => sum + item.calls, 0),
      tokensSpent: [...usage.values()].reduce((sum, item) => sum + item.tokens, 0),
    };
  }

  private expandBatch(
    input: Pass3Input,
    batch: readonly OpenCell[],
    usage: Map<string, { calls: number; tokens: number }>,
    diagnostics: FillDiagnostic[],
    nextStep: () => number,
  ): Pass3CellResult[] {
    const first = this.call(input, batch, false, [], usage, diagnostics, nextStep);
    if (first === null) return batch.map((cell) => halted(cell, "token or call budget exhausted before spec-expander@1"));
    if (first.documentProblems.length > 0 || first.blocked) {
      const reason = first.blocked
        ? `spec-expander@1 blocked: ${first.blockReason ?? "no reason"}`
        : first.documentProblems.join("; ");
      for (const problem of first.documentProblems) {
        diagnostics.push({ code: first.blocked ? "pass3_blocked" : "malformed_output", message: problem });
      }
      const repair = this.call(
        input,
        batch,
        true,
        batch.map((cell) => ({ cell_id: cell.id, problems: [reason] })),
        usage,
        diagnostics,
        nextStep,
      );
      if (repair === null) return batch.map((cell) => halted(cell, "budget exhausted during repair"));
      return this.settle(input, batch, repair, diagnostics, true);
    }
    const settled = this.settle(input, batch, first, diagnostics, false);
    const retryIds = settled.filter((cell) => cell.kind === "needs_review").map((cell) => cell.cellId);
    if (retryIds.length === 0) return settled;
    const retryCells = batch.filter((cell) => retryIds.includes(cell.id));
    const issues = settled
      .filter((cell) => cell.kind === "needs_review")
      .map((cell) => ({ cell_id: cell.cellId, problems: cell.problems }));
    const repair = this.call(input, retryCells, true, issues, usage, diagnostics, nextStep);
    if (repair === null) return settled;
    const repaired = this.settle(input, retryCells, repair, diagnostics, true);
    const repairedIds = new Set(repaired.map((cell) => cell.cellId));
    return settled.map((cell) => repairedIds.has(cell.cellId) ? repaired.find((item) => item.cellId === cell.cellId) ?? cell : cell);
  }

  private settle(
    input: Pass3Input,
    batch: readonly OpenCell[],
    parsed: ReturnType<typeof parseSpecExpanderOutput>,
    diagnostics: FillDiagnostic[],
    finalAttempt: boolean,
  ): Pass3CellResult[] {
    const byId = new Map(parsed.cells.map((cell) => [cell.cell_id, cell]));
    const results: Pass3CellResult[] = [];
    const conflicts: ContradictionPair[] = [];
    for (const cell of batch) {
      const returned = byId.get(cell.id);
      const structural = parsed.cellProblems.get(cell.id) ?? [];
      if (structural.length > 0) {
        results.push(needsReview(cell, structural, returned ?? null));
        continue;
      }
      if (!returned) {
        results.push(needsReview(cell, ["omitted from the spec-expander@1 batch"], null));
        continue;
      }
      const verdict = this.validator.validate({
        earsText: returned.ears_text,
        oracleSketch: returned.oracle_sketch,
        premises: returned.premises,
        allowedPremiseIds: input.premiseIds,
        forbiddenScopePhrases: input.forbiddenScopePhrases,
        cellId: returned.cell_id,
        knownCellIds: batch.map((item) => item.id),
      });
      if (!verdict.ok) {
        results.push(needsReview(cell, [...verdict.problems], returned));
        continue;
      }
      results.push(routeCell(cell, returned));
    }
    for (const extra of parsed.cells) {
      if (batch.some((cell) => cell.id === extra.cell_id)) continue;
      const known = input.knownFills.get(extra.cell_id);
      if (known) {
        diagnostics.push({
          code: "conflict_with_pass1",
          cellId: extra.cell_id,
          message: `Pass ${String(known.pass)} cell ${extra.cell_id} is immutable to Pass 3`,
        });
        conflicts.push({
          leftId: known.sourceId,
          rightId: extra.cell_id,
          leftText: known.earsText,
          rightText: extra.ears_text,
        });
        continue;
      }
      diagnostics.push({
        code: "scope_invention",
        cellId: extra.cell_id,
        message: `spec-expander@1 returned cell ${extra.cell_id} outside the batch`,
      });
    }
    if (conflicts.length > 0) {
      input.contradiction.recheck({
        reason: "pass3_conflict",
        requirementIds: conflicts.map((pair) => pair.leftId),
        pairs: conflicts,
      });
    }
    if (!finalAttempt) return results;
    return results.map((result) => {
      if (result.kind !== "needs_review") return result;
      const unresolved = unresolvedCode(result.problems);
      diagnostics.push({
        code: unresolved,
        cellId: result.cellId,
        message: `still unresolved after one repair: ${result.problems.join("; ")}`,
      });
      return result;
    });
  }

  private call(
    input: Pass3Input,
    batch: readonly OpenCell[],
    repair: boolean,
    issues: readonly { readonly cell_id: string; readonly problems: readonly string[] }[],
    usage: Map<string, { calls: number; tokens: number }>,
    diagnostics: FillDiagnostic[],
    nextStep: () => number,
  ): ReturnType<typeof parseSpecExpanderOutput> | null {
    if (batch.length === 0) return parseSpecExpanderOutput('{"cells":[]}');
    const featureId = batch[0]?.featureId ?? "";
    const matrixId = batch[0]?.matrixId ?? "";
    const spent = usage.get(featureId) ?? { calls: 0, tokens: 0 };
    const prompt = JSON.stringify({
      contract: "spec-expander@1",
      repair,
      feature_id: featureId,
      matrix_id: matrixId,
      premise_ids: input.premiseIds,
      instruction: repair
        ? REPAIR_INSTRUCTION
        : "Fill only these cells. One EARS sentence, a concrete oracle sketch, and risk low, medium, or high.",
      issues,
      cells: batch.map((cell) => ({
        cell_id: cell.id,
        subject: cell.subject,
        title: cell.title,
        touches: cell.touches,
        matrix_id: cell.matrixId,
        feature_id: cell.featureId,
      })),
    });
    const reserved = Math.ceil(prompt.length / 4);
    if (spent.calls + 1 > input.budget.maxCallsPerFeature || spent.tokens + reserved > input.budget.maxTokensPerFeature) {
      for (const cell of batch) {
        diagnostics.push({
          code: "budget_exceeded",
          cellId: cell.id,
          message: `feature ${featureId} hit the spec-expander call or token cap`,
        });
      }
      return null;
    }
    const completion = input.model.complete({
      attempt: input.attempt,
      step: nextStep(),
      prompt,
    });
    usage.set(featureId, {
      calls: spent.calls + 1,
      tokens: spent.tokens + completion.actualTokens,
    });
    return parseSpecExpanderOutput(completion.text);
  }
}

function routeCell(cell: OpenCell, returned: SpecExpanderCell): Pass3CellResult {
  const floor = applyRiskFloor({
    modelRisk: returned.risk,
    touches: cell.touches,
    matrixId: cell.matrixId,
    subject: cell.subject,
  });
  const base = {
    cellId: cell.id,
    featureId: cell.featureId,
    matrixId: cell.matrixId,
    subject: cell.subject,
    title: cell.title,
    touches: cell.touches,
    earsText: returned.ears_text,
    oracleSketch: returned.oracle_sketch,
    value: returned.value,
    modelRisk: returned.risk,
    forcedHigh: floor.forcedHigh,
    premises: [...returned.premises],
    problems: [] as string[],
  };
  if (returned.status === "asked" || floor.risk === "high") {
    const why = floor.forcedHigh
      ? `Deterministic risk floor promoted model risk ${returned.risk} to high because the cell touches ${floor.matchedTags.join(", ")}.`
      : "The cell is high impact and cannot be auto-accepted.";
    return {
      ...base,
      kind: "must_ask",
      risk: "high",
      question: `Blocking Discovery question for ${cell.title}. ${why} Proposed text: ${returned.ears_text}`,
    };
  }
  if (floor.risk === "medium") {
    return { ...base, kind: "review", risk: "medium", question: null };
  }
  return { ...base, kind: "auto_accept", risk: "low", question: null };
}

function needsReview(cell: OpenCell, problems: readonly string[], returned: SpecExpanderCell | null): Pass3CellResult {
  return {
    cellId: cell.id,
    featureId: cell.featureId,
    matrixId: cell.matrixId,
    subject: cell.subject,
    title: cell.title,
    touches: cell.touches,
    kind: "needs_review",
    earsText: returned?.ears_text ?? null,
    oracleSketch: returned?.oracle_sketch ?? null,
    value: returned?.value ?? null,
    risk: returned?.risk ?? null,
    modelRisk: returned?.risk ?? null,
    forcedHigh: false,
    premises: returned ? [...returned.premises] : [],
    problems,
    question: null,
  };
}

function unresolvedCode(problems: readonly string[]): FillDiagnostic["code"] {
  if (problems.some((problem) => problem.startsWith("omitted"))) return "omitted_cell";
  if (problems.some((problem) => problem.includes("unauthorized scope"))) return "scope_invention";
  if (problems.some((problem) => problem.includes("budget"))) return "budget_exceeded";
  return "vague_after_repair";
}

function halted(cell: OpenCell, message: string): Pass3CellResult {
  return needsReview(cell, [message], null);
}

function groupCells(cells: readonly OpenCell[]): OpenCell[][] {
  const groups = new Map<string, OpenCell[]>();
  const sorted = [...cells].sort((left, right) => left.id.localeCompare(right.id));
  for (const cell of sorted) {
    const key = `${cell.featureId}\u0000${cell.matrixId}`;
    const list = groups.get(key);
    if (list) list.push(cell);
    else groups.set(key, [cell]);
  }
  return [...groups.entries()].sort((left, right) => left[0].localeCompare(right[0])).map((entry) => entry[1]);
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size));
  }
  return batches;
}
