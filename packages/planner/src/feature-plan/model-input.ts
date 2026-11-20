import { FeaturePlanError } from "./errors.js";
import type { PlanContext } from "./ports.js";
import type { ContractInput, RequirementInput, VisibleExample } from "./types.js";

const FORBIDDEN_ORACLE_KEYS = new Set([
  "tasks",
  "task_split",
  "write_scope",
  "worker_code",
  "implementation",
  "diff",
  "files",
]);

export interface PlannerModelInput {
  readonly featureId: string;
  readonly featureTitle: string;
  readonly requirements: readonly RequirementInput[];
  readonly contracts: readonly ContractInput[];
  readonly entities: readonly { readonly id: string; readonly title: string; readonly touches: readonly string[] }[];
  readonly impactedRequirementIds: readonly string[];
  readonly limits: { readonly minFiles: 1; readonly maxFiles: 5; readonly maxBehaviors: 1; readonly integrationSlot: "096" };
}

export interface OracleRequirementView {
  readonly id: string;
  readonly title: string;
  readonly ears: string;
  readonly oracleSketch: string;
  readonly trivial: boolean;
  readonly nodeKind: RequirementInput["nodeKind"];
  readonly kind: RequirementInput["kind"];
  readonly entryPoint: string;
  readonly ruleId: string | null;
  readonly contractRoute: string | null;
  readonly schemaName: string | null;
}

export interface OracleModelInput {
  readonly featureId: string;
  readonly requirements: readonly OracleRequirementView[];
  readonly visibleExamples: readonly VisibleExample[];
}

export function buildPlannerModelInput(context: PlanContext, requirements: readonly RequirementInput[]): PlannerModelInput {
  return {
    featureId: context.featureId,
    featureTitle: context.featureTitle,
    requirements,
    contracts: context.contracts,
    entities: context.entities.map((entity) => ({
      id: entity.id,
      title: entity.title,
      touches: entity.touches,
    })),
    impactedRequirementIds: requirements.map((requirement) => requirement.id),
    limits: { minFiles: 1, maxFiles: 5, maxBehaviors: 1, integrationSlot: "096" },
  };
}

/**
 * oracle-author@1 sees requirements, EARS, oracle sketches, contracts, and
 * visible examples. It does not see the task split or worker code.
 */
export function buildOracleAuthorInput(input: {
  readonly featureId: string;
  readonly requirements: readonly RequirementInput[];
  readonly contracts: readonly ContractInput[];
  readonly visibleExamples: readonly VisibleExample[];
}): OracleModelInput {
  const routes = new Map(input.contracts.map((contract) => [contract.id, contract]));
  const view: OracleModelInput = {
    featureId: input.featureId,
    requirements: input.requirements.map((requirement) => {
      const contract = requirement.contractId ? routes.get(requirement.contractId) : undefined;
      return {
        id: requirement.id,
        title: requirement.title,
        ears: requirement.ears,
        oracleSketch: requirement.oracleSketch,
        trivial: requirement.trivial,
        nodeKind: requirement.nodeKind,
        kind: requirement.kind,
        entryPoint: requirement.entryPoint,
        ruleId: requirement.ruleId,
        contractRoute: contract?.route ?? null,
        schemaName: contract?.schemaName ?? null,
      };
    }),
    visibleExamples: input.visibleExamples.map((example) => ({
      requirementId: example.requirementId,
      kind: example.kind,
      entryPoint: example.entryPoint,
      input: example.input,
      expected: example.expected,
      assertion: example.assertion,
    })),
  };
  assertOracleInputClean(view);
  return view;
}

export function assertOracleInputClean(value: unknown, path = "input"): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertOracleInputClean(item, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_ORACLE_KEYS.has(key)) {
      throw new FeaturePlanError(
        "oracle_input_contaminated",
        `oracle-author@1 input includes ${key}; sealed checks are authored from requirements, never from the task split or worker code`,
        { path: `${path}.${key}` },
      );
    }
    assertOracleInputClean(child, `${path}.${key}`);
  }
}

export function visibleExamplesFrom(requirements: readonly RequirementInput[], checks: readonly {
  readonly requirementIds: readonly string[];
  readonly kind: VisibleExample["kind"];
  readonly entryPoint: string;
  readonly example: { readonly input: string; readonly expected: string; readonly assertion: string };
}[]): VisibleExample[] {
  const allowed = new Set(requirements.map((requirement) => requirement.id));
  const examples: VisibleExample[] = [];
  for (const check of checks) {
    for (const requirementId of check.requirementIds) {
      if (!allowed.has(requirementId)) continue;
      examples.push({
        requirementId,
        kind: check.kind,
        entryPoint: check.entryPoint,
        input: check.example.input,
        expected: check.example.expected,
        assertion: check.example.assertion,
      });
    }
  }
  return examples;
}

export function assertNoWorkerCode(workerCode: string | null): void {
  if (workerCode && workerCode.trim().length > 0) {
    throw new FeaturePlanError(
      "oracle_input_contaminated",
      "oracle-author@1 refuses worker code; hidden checks are authored from canonical requirements only",
    );
  }
}
