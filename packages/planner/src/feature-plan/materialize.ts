import type { HeldBackCase, RelationSource } from "./types.js";
import type {
  ContractInput,
  EntityInput,
  FeaturePlanDocument,
  PlannedTask,
  RequirementInput,
} from "./types.js";

export interface MaterializeInput {
  readonly featureId: string;
  readonly featureTitle: string;
  readonly requirements: readonly RequirementInput[];
  readonly contracts: readonly ContractInput[];
  readonly entities: readonly EntityInput[];
  readonly plan: FeaturePlanDocument;
  readonly sealed: readonly HeldBackCase[];
  readonly includeTaskIds: ReadonlySet<string> | null;
  readonly includeRequirementIds: ReadonlySet<string> | null;
}

export function materialize(input: MaterializeInput): RelationSource[] {
  const full = input.includeTaskIds === null && input.includeRequirementIds === null;
  const sources: RelationSource[] = [];
  if (full) {
    sources.push(featureNode(input.featureId, input.featureTitle));
    for (const contract of input.contracts) sources.push(contractNode(contract, input.featureId));
    for (const entity of input.entities) sources.push(entityNode(entity, input.featureId));
  }
  for (const requirement of input.requirements) {
    if (input.includeRequirementIds && !input.includeRequirementIds.has(requirement.id)) continue;
    sources.push(requirementNode(requirement, input.featureId));
  }
  const tasks = taskList(input.plan).filter((task) => input.includeTaskIds === null || input.includeTaskIds.has(task.id));
  for (const task of tasks) {
    sources.push(taskNode(task, input.featureId));
    for (const check of task.checks) sources.push(visibleCheckNode(check, input.featureId));
  }
  if (full || input.includeTaskIds?.has(input.plan.integration.id)) {
    const journeyAlready = sources.some((source) => source.id === input.plan.journeyCheck.id);
    if (!journeyAlready) sources.push(visibleCheckNode(input.plan.journeyCheck, input.featureId));
  }
  for (const sealed of input.sealed) {
    const requirementId = sealed.requirementIds[0];
    if (!requirementId) continue;
    if (input.includeRequirementIds && !input.includeRequirementIds.has(requirementId)) continue;
    sources.push(sealedCheckNode(sealed, input.featureId));
  }
  return sources;
}

function taskList(plan: FeaturePlanDocument): PlannedTask[] {
  const integrationIncluded = plan.tasks.some((task) => task.id === plan.integration.id);
  return integrationIncluded ? [...plan.tasks] : [...plan.tasks, plan.integration];
}

function featureNode(featureId: string, title: string): RelationSource {
  return {
    id: featureId,
    kind: "feature",
    title,
    text: title,
    featureId,
    fields: { title },
  };
}

function requirementNode(requirement: RequirementInput, featureId: string): RelationSource {
  return {
    id: requirement.id,
    kind: requirement.nodeKind,
    title: requirement.title,
    text: requirement.ears,
    featureId,
    fields: {
      ears: requirement.ears,
      oracle_sketch: requirement.oracleSketch,
      touches: requirement.touches,
      trivial: requirement.trivial,
      check_kind: requirement.kind,
      entry_point: requirement.entryPoint,
      rule_id: requirement.ruleId,
      belongs_to: [featureId],
    },
  };
}

function contractNode(contract: ContractInput, featureId: string): RelationSource {
  return {
    id: contract.id,
    kind: "contract",
    title: contract.title,
    text: contract.route,
    featureId,
    fields: {
      entry_point: contract.entryPoint,
      schema_name: contract.schemaName,
      route: contract.route,
      belongs_to: [featureId],
    },
  };
}

function entityNode(entity: EntityInput, featureId: string): RelationSource {
  return {
    id: entity.id,
    kind: "arch_node",
    title: entity.title,
    text: entity.title,
    featureId,
    fields: {
      touches: entity.touches,
      belongs_to: [featureId],
    },
  };
}

function taskNode(task: PlannedTask, featureId: string): RelationSource {
  const fields: Record<string, unknown> = {
    goal: task.goal,
    write_scope: task.writeScope,
    files: task.files,
    touches: task.touches,
    level: task.level,
    task_type: task.taskType,
    behavior: task.behaviors[0],
    feature: featureId,
    implements: task.requirementIds,
    depends_on: task.dependsOn,
    belongs_to: [featureId],
    consumes_contract: task.contractIds,
    touches_entity: task.entityIds,
  };
  if (task.integrationSlot) fields.integration_slot = task.integrationSlot;
  return {
    id: task.id,
    kind: "task",
    title: task.goal,
    text: task.behaviors[0],
    featureId,
    fields,
  };
}

function visibleCheckNode(
  check: {
    readonly id: string;
    readonly kind: string;
    readonly requirementIds: readonly string[];
    readonly entryPoint: string;
    readonly example: { readonly input: string; readonly expected: string; readonly assertion: string };
  },
  featureId: string,
): RelationSource {
  return {
    id: check.id,
    kind: "check",
    title: check.id,
    text: check.example.assertion,
    featureId,
    fields: {
      visibility: "visible",
      kind: check.kind,
      entry_point: check.entryPoint,
      assertion: check.example.assertion,
      input: check.example.input,
      expected: check.example.expected,
      feature: featureId,
      verifies: check.requirementIds,
      belongs_to: [featureId],
    },
  };
}

function sealedCheckNode(check: HeldBackCase, featureId: string): RelationSource {
  return {
    id: check.checkId,
    kind: "check",
    title: "Sealed check",
    text: "",
    featureId,
    fields: {
      visibility: "held_back",
      sealed: true,
      diversity: check.diversity,
      feature: featureId,
      verifies: check.requirementIds,
      belongs_to: [featureId],
    },
  };
}
