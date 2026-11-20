import { FeaturePlanError } from "./errors.js";
import { isTouchTag, type TouchTag } from "./touches.js";
import {
  asRecord,
  assertExactKeys,
  assertId,
  optionalString,
  requireString,
  requireStringArray,
} from "./canonical.js";
import {
  FEATURE_INTEGRATION_SLOT,
  FEATURE_PLANNER_SCHEMA,
  ORACLE_AUTHOR_SCHEMA,
  type CheckExample,
  type CheckKind,
  type Diversity,
  type FeaturePlanDocument,
  type HeldBackCase,
  type OracleAuthorDocument,
  type OracleRubric,
  type PlannedCheck,
  type PlannedTask,
  type TaskLevel,
  type TaskType,
} from "./types.js";

const CHECK_KINDS = new Set<CheckKind>(["api", "ui", "unit"]);
const DIVERSITY = new Set<Diversity>(["happy", "boundary", "negative", "adversarial"]);
const LEVELS = new Set<TaskLevel>(["Junior", "Mid", "Senior"]);
const TASK_TYPES = new Set<TaskType>(["leaf", "wiring", "feature_integration"]);

const PLAN_KEYS = ["schema", "tasks", "wiring_tasks", "journey_check", "feature_integration"] as const;
const TASK_KEYS = [
  "id",
  "goal",
  "write_scope",
  "files",
  "touches",
  "requirements",
  "depends_on",
  "level",
  "behaviors",
  "task_type",
  "checks",
  "integration_slot",
  "contract_ids",
  "entity_ids",
] as const;
const CHECK_KEYS = ["id", "kind", "requirement_ids", "visibility", "entry_point", "example"] as const;
const EXAMPLE_KEYS = ["input", "expected", "assertion"] as const;
const ORACLE_KEYS = ["schema", "held_back", "rubrics"] as const;
const HELD_KEYS = [
  "check_id",
  "requirement_ids",
  "input",
  "expected",
  "rule_id",
  "diversity",
  "kind",
  "entry_point",
  "assertion",
] as const;
const RUBRIC_KEYS = ["check_id", "criteria", "threshold"] as const;

/**
 * Local port for Task 009 `FeaturePlannerV1Schema`.
 * Closed object matching prompt-contracts.md feature-planner@1 output,
 * plus the Feature Integration slot required by Task 091.
 */
export const FeaturePlannerV1Schema = {
  schemaId: FEATURE_PLANNER_SCHEMA,
  parse(input: unknown, featureId: string): FeaturePlanDocument {
    const record = asRecord(input, "feature-planner@1");
    assertExactKeys(record, PLAN_KEYS, "feature-planner@1");
    if (record.schema !== FEATURE_PLANNER_SCHEMA) {
      throw new FeaturePlanError("invalid_model_output", "schema must be feature-planner@1");
    }
    const tasks = parseTasks(record.tasks, "tasks");
    const wiring = parseTasks(record.wiring_tasks, "wiring_tasks");
    const integration = parseTask(asRecord(record.feature_integration, "feature_integration"), "feature_integration");
    const journey = parseCheck(asRecord(record.journey_check, "journey_check"), "journey_check");
    if (journey.visibility !== "visible") {
      throw new FeaturePlanError("invalid_model_output", "journey_check must be visible");
    }
    return {
      schema: FEATURE_PLANNER_SCHEMA,
      featureId,
      tasks: [...tasks, ...wiring],
      integration,
      journeyCheck: journey,
    };
  },
};

/**
 * Local port for Task 009 `OracleAuthorV1Schema`.
 * Held-back cases and rubrics only. Task decomposition is not a field.
 */
export const OracleAuthorV1Schema = {
  schemaId: ORACLE_AUTHOR_SCHEMA,
  parse(input: unknown): OracleAuthorDocument {
    const record = asRecord(input, "oracle-author@1");
    assertExactKeys(record, ORACLE_KEYS, "oracle-author@1");
    if (record.schema !== ORACLE_AUTHOR_SCHEMA) {
      throw new FeaturePlanError("invalid_model_output", "schema must be oracle-author@1");
    }
    if (!Array.isArray(record.held_back)) {
      throw new FeaturePlanError("invalid_model_output", "held_back must be an array");
    }
    if (!Array.isArray(record.rubrics)) {
      throw new FeaturePlanError("invalid_model_output", "rubrics must be an array");
    }
    return {
      schema: ORACLE_AUTHOR_SCHEMA,
      heldBack: record.held_back.map((item, index) => parseHeldBack(item, index)),
      rubrics: record.rubrics.map((item, index) => parseRubric(item, index)),
    };
  },
};

function parseTasks(value: unknown, label: string): PlannedTask[] {
  if (!Array.isArray(value)) {
    throw new FeaturePlanError("invalid_model_output", `${label} must be an array`);
  }
  return value.map((item, index) => parseTask(asRecord(item, `${label}[${index}]`), `${label}[${index}]`));
}

function parseTask(record: Record<string, unknown>, label: string): PlannedTask {
  assertExactKeys(record, TASK_KEYS, label);
  const taskType = parseEnum(record.task_type, TASK_TYPES, `${label}.task_type`) as TaskType;
  const integrationSlot = record.integration_slot;
  let slot: typeof FEATURE_INTEGRATION_SLOT | null = null;
  if (taskType === "feature_integration") {
    if (integrationSlot !== FEATURE_INTEGRATION_SLOT) {
      throw new FeaturePlanError(
        "missing_integration_slot",
        "Feature integration slot must be Task 096",
        { integrationSlot: integrationSlot ?? null },
      );
    }
    slot = FEATURE_INTEGRATION_SLOT;
  } else if (integrationSlot !== null) {
    throw new FeaturePlanError("invalid_model_output", `${label} must not carry an integration slot`);
  }
  const behaviors = requireStringArray(record.behaviors, `${label}.behaviors`);
  if (behaviors.length !== 1) {
    throw new FeaturePlanError(
      "multiple_behaviors",
      `${label} declares ${behaviors.length} behaviors; each task has exactly one verifiable behavior`,
      { count: behaviors.length },
    );
  }
  const behavior = behaviors[0];
  if (!behavior) {
    throw new FeaturePlanError("multiple_behaviors", `${label} is missing its behavior`);
  }
  const checks = parseChecks(record.checks, `${label}.checks`);
  for (const check of checks) {
    if (check.visibility !== "visible") {
      throw new FeaturePlanError(
        "held_back_in_planner",
        "feature-planner@1 cannot author held-back checks",
        { checkId: check.id },
      );
    }
  }
  return {
    id: assertId(requireString(record.id, `${label}.id`), `${label}.id`),
    goal: requireString(record.goal, `${label}.goal`),
    writeScope: requireStringArray(record.write_scope, `${label}.write_scope`),
    files: requireStringArray(record.files, `${label}.files`),
    touches: parseTouches(record.touches, `${label}.touches`),
    requirementIds: requireStringArray(record.requirements, `${label}.requirements`).map((id) => assertId(id, id)),
    dependsOn: requireStringArray(record.depends_on, `${label}.depends_on`).map((id) => assertId(id, id)),
    level: parseEnum(record.level, LEVELS, `${label}.level`) as TaskLevel,
    behaviors: [behavior],
    taskType,
    integrationSlot: slot,
    contractIds: requireStringArray(record.contract_ids, `${label}.contract_ids`).map((id) => assertId(id, id)),
    entityIds: requireStringArray(record.entity_ids, `${label}.entity_ids`).map((id) => assertId(id, id)),
    checks,
  };
}

function parseChecks(value: unknown, label: string): PlannedCheck[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new FeaturePlanError("missing_visible_check", `${label} needs at least one visible check`);
  }
  return value.map((item, index) => parseCheck(asRecord(item, `${label}[${index}]`), `${label}[${index}]`));
}

function parseCheck(record: Record<string, unknown>, label: string): PlannedCheck {
  assertExactKeys(record, CHECK_KEYS, label);
  if (record.visibility !== "visible") {
    throw new FeaturePlanError("held_back_in_planner", `${label} must be visible`, { visibility: record.visibility });
  }
  return {
    id: assertId(requireString(record.id, `${label}.id`), `${label}.id`),
    kind: parseEnum(record.kind, CHECK_KINDS, `${label}.kind`) as CheckKind,
    requirementIds: requireStringArray(record.requirement_ids, `${label}.requirement_ids`).map((id) => assertId(id, id)),
    visibility: "visible",
    entryPoint: requireString(record.entry_point, `${label}.entry_point`),
    example: parseExample(asRecord(record.example, `${label}.example`), `${label}.example`),
  };
}

function parseExample(record: Record<string, unknown>, label: string): CheckExample {
  assertExactKeys(record, EXAMPLE_KEYS, label);
  return {
    input: requireString(record.input, `${label}.input`),
    expected: requireString(record.expected, `${label}.expected`),
    assertion: requireString(record.assertion, `${label}.assertion`),
  };
}

function parseHeldBack(value: unknown, index: number): HeldBackCase {
  const record = asRecord(value, `held_back[${index}]`);
  assertExactKeys(record, HELD_KEYS, `held_back[${index}]`);
  return {
    checkId: assertId(requireString(record.check_id, "check_id"), "check_id"),
    requirementIds: requireStringArray(record.requirement_ids, "requirement_ids").map((id) => assertId(id, id)),
    input: requireString(record.input, "input"),
    expected: requireString(record.expected, "expected"),
    ruleId: optionalString(record.rule_id, "rule_id"),
    diversity: parseEnum(record.diversity, DIVERSITY, "diversity") as Diversity,
    kind: parseEnum(record.kind, CHECK_KINDS, "kind") as CheckKind,
    entryPoint: requireString(record.entry_point, "entry_point"),
    assertion: requireString(record.assertion, "assertion"),
  };
}

function parseRubric(value: unknown, index: number): OracleRubric {
  const record = asRecord(value, `rubrics[${index}]`);
  assertExactKeys(record, RUBRIC_KEYS, `rubrics[${index}]`);
  return {
    checkId: assertId(requireString(record.check_id, "check_id"), "check_id"),
    criteria: requireString(record.criteria, "criteria"),
    threshold: requireString(record.threshold, "threshold"),
  };
}

function parseTouches(value: unknown, label: string): TouchTag[] {
  const raw = requireStringArray(value, label);
  const tags: TouchTag[] = [];
  for (const tag of raw) {
    if (!isTouchTag(tag)) {
      throw new FeaturePlanError("closed_tag", `${label} contains a tag outside the closed vocabulary`, { tag });
    }
    tags.push(tag);
  }
  return tags;
}

function parseEnum(value: unknown, allowed: ReadonlySet<string>, label: string): string {
  if (typeof value !== "string" || !allowed.has(value)) {
    throw new FeaturePlanError("invalid_model_output", `${label} is not an allowed value`, { value: value ?? null });
  }
  return value;
}
