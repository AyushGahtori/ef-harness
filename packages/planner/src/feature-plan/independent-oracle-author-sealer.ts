import { canonicalJson, sha256 } from "./canonical.js";
import { FeaturePlanError } from "./errors.js";
import { assertNoWorkerCode, assertOracleInputClean, buildOracleAuthorInput } from "./model-input.js";
import { selectOracleAuthor } from "./model-family.js";
import { diversityGap, lintHeldBack, repairReasons } from "./oracle-lint.js";
import { OracleAuthorV1Schema } from "./schema.js";
import type {
  ContractInput,
  DiagnosticEntry,
  HeldBackCase,
  ModelAssignment,
  ModelRoster,
  OracleAuthorDocument,
  PlannerOracleModel,
  RequirementInput,
  SealReceipt,
  VisibleExample,
} from "./types.js";
import type { DiagnosticLog } from "./ports.js";

export interface SealAuthorInput {
  readonly featureId: string;
  readonly requirements: readonly RequirementInput[];
  readonly contracts: readonly ContractInput[];
  readonly visibleExamples: readonly VisibleExample[];
  readonly roster: ModelRoster;
  readonly buildWorker: ModelAssignment;
  readonly model: PlannerOracleModel;
  readonly now: number;
  readonly log: DiagnosticLog;
  readonly compileStarted: boolean;
  readonly workerCode: string | null;
}

export interface AuthoredOracles {
  readonly document: OracleAuthorDocument;
  readonly cases: readonly HeldBackCase[];
  readonly receipt: SealReceipt;
  readonly warnings: readonly DiagnosticEntry[];
}

/**
 * Step 3b oracle-author@1. Authors sealed checks from requirements only,
 * on an independent model family, before graph compile and before workers run.
 */
export class IndependentOracleAuthorSealer {
  author(input: SealAuthorInput): AuthoredOracles {
    if (input.compileStarted) {
      throw new FeaturePlanError(
        "step3b_before_compile",
        "oracle-author@1 must seal hidden checks before graph compile starts",
      );
    }
    assertNoWorkerCode(input.workerCode);
    const selection = selectOracleAuthor(input.roster, input.buildWorker);
    for (const warning of selection.warnings) input.log.warn(warning.code, warning.message);
    const oracleInput = buildOracleAuthorInput({
      featureId: input.featureId,
      requirements: input.requirements,
      contracts: input.contracts,
      visibleExamples: input.visibleExamples,
    });
    assertOracleInputClean(oracleInput);
    const first = OracleAuthorV1Schema.parse(
      input.model.complete({
        role: "oracle-author@1",
        family: selection.assignment.family,
        model: selection.assignment.model,
        input: oracleInput,
        repair: null,
      }),
    );
    const repaired = repairOnce(first, input);
    assertDiversePools(input.requirements, repaired.document.heldBack);
    assertRubrics(repaired.document);
    const cases = repaired.document.heldBack;
    return {
      document: repaired.document,
      cases,
      warnings: selection.warnings,
      receipt: {
        featureId: input.featureId,
        sealedAt: input.now,
        sealedBeforeCompile: true,
        oracleIndependence: selection.independence,
        selectedFamily: selection.assignment.family,
        selectedModel: selection.assignment.model,
        buildWorkerFamily: input.buildWorker.family,
        warnings: selection.warnings,
        repairAttempts: repaired.repairAttempts,
        checkIds: cases.map((item) => item.checkId),
        caseCount: cases.length,
      },
    };
  }
}

function repairOnce(
  document: OracleAuthorDocument,
  input: SealAuthorInput,
): { document: OracleAuthorDocument; repairAttempts: number } {
  const failing = document.heldBack.filter((item) => lintHeldBack(item).length > 0);
  if (failing.length === 0) return { document, repairAttempts: 0 };
  const reasons = repairReasons(failing.flatMap((item) => lintHeldBack(item)));
  const selection = selectOracleAuthor(input.roster, input.buildWorker);
  const repaired = OracleAuthorV1Schema.parse(
    input.model.complete({
      role: "oracle-author@1",
      family: selection.assignment.family,
      model: selection.assignment.model,
      input: {
        held_back: failing.map(toSnake),
        reasons,
      },
      repair: { attempt: 1, reasons },
    }),
  );
  const byId = new Map(repaired.heldBack.map((item) => [item.checkId, item]));
  const merged: OracleAuthorDocument = {
    schema: document.schema,
    heldBack: document.heldBack.map((item) => byId.get(item.checkId) ?? item),
    rubrics: document.rubrics,
  };
  const still = merged.heldBack.filter((item) => lintHeldBack(item).length > 0);
  if (still.length > 0) {
    const sample = still[0];
    throw new FeaturePlanError(
      "oracle_lint",
      `Hidden check ${sample?.checkId ?? ""} stayed weak after 1 repair`,
      {
        repairAttempts: 1,
        checkId: sample?.checkId ?? "",
        issues: sample ? lintHeldBack(sample).map((issue) => issue.code) : [],
      },
    );
  }
  return { document: merged, repairAttempts: 1 };
}

export function assertDiversePools(requirements: readonly RequirementInput[], cases: readonly HeldBackCase[]): void {
  for (const requirement of requirements) {
    if (requirement.trivial) continue;
    const mine = cases.filter((item) => item.requirementIds.includes(requirement.id));
    const present = new Set(mine.map((item) => item.diversity));
    const missing = diversityGap(present);
    if (mine.length < 3 || missing.length > 0) {
      throw new FeaturePlanError(
        "insufficient_oracle_pool",
        `Requirement ${requirement.id} needs at least 3 diverse cases (happy, boundary, and negative) before sealing`,
        { requirementId: requirement.id, count: mine.length, missing },
      );
    }
  }
}

function assertRubrics(document: OracleAuthorDocument): void {
  const ids = new Set(document.heldBack.map((item) => item.checkId));
  for (const rubric of document.rubrics) {
    if (!ids.has(rubric.checkId)) {
      throw new FeaturePlanError("dangling_node", `Rubric references missing check ${rubric.checkId}`, {
        nodeId: rubric.checkId,
      });
    }
  }
}

function toSnake(item: HeldBackCase): Record<string, unknown> {
  return {
    check_id: item.checkId,
    requirement_ids: item.requirementIds,
    input: item.input,
    expected: item.expected,
    rule_id: item.ruleId,
    diversity: item.diversity,
    kind: item.kind,
    entry_point: item.entryPoint,
    assertion: item.assertion,
  };
}

export function sealedDigest(item: HeldBackCase): string {
  return sha256(canonicalJson(item));
}
