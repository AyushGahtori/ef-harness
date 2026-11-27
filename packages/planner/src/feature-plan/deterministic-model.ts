import { asRecord, requireString, requireStringArray } from "./canonical.js";
import type { CheckKind, Diversity, RequirementInput } from "./types.js";
import type { OracleModelInput, PlannerModelInput } from "./model-input.js";
import { FEATURE_INTEGRATION_SLOT } from "./types.js";

function safe(value: string): string {
  const cleaned = value.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return cleaned.length > 0 ? cleaned : "item";
}

function slug(featureId: string): string {
  return safe(featureId).toLowerCase();
}

function readPlannerInput(input: unknown): PlannerModelInput {
  const record = asRecord(input, "planner input");
  return record as unknown as PlannerModelInput;
}

function readOracleInput(input: unknown): OracleModelInput {
  const record = asRecord(input, "oracle input");
  return record as unknown as OracleModelInput;
}

export function deterministicFeaturePlan(input: unknown): unknown {
  const plan = readPlannerInput(input);
  const featureId = plan.featureId;
  const leaves = plan.requirements.map((requirement) => leafTask(featureId, requirement, plan));
  const integrationId = `integration-${safe(featureId)}`;
  const journey = journeyCheck(featureId, plan.featureTitle);
  return {
    schema: "feature-planner@1",
    tasks: leaves,
    wiring_tasks: [],
    journey_check: journey,
    feature_integration: {
      id: integrationId,
      goal: `Integrate ${plan.featureTitle}`,
      write_scope: [`src/${slug(featureId)}/wiring.ts`],
      files: [`src/${slug(featureId)}/wiring.ts`],
      touches: ["route"],
      requirements: [],
      depends_on: leaves.map((leaf) => leaf.id),
      level: "Senior",
      behaviors: ["Wire accepted leaves behind the public feature entry"],
      task_type: "feature_integration",
      checks: [journey],
      integration_slot: FEATURE_INTEGRATION_SLOT,
      contract_ids: [],
      entity_ids: [],
    },
  };
}

function leafTask(featureId: string, requirement: RequirementInput, plan: PlannerModelInput): Record<string, unknown> {
  const files =
    requirement.files.length > 0
      ? [...requirement.files]
      : [`src/${slug(featureId)}/${safe(requirement.id)}.ts`];
  const entity = requirement.entityId
    ? plan.entities.find((item) => item.id === requirement.entityId)
    : undefined;
  const touches = new Set<string>(requirement.touches);
  for (const tag of entity?.touches ?? []) touches.add(tag);
  if (touches.size === 0) touches.add("route");
  const example = visibleExample(requirement);
  return {
    id: `task-${safe(featureId)}-${safe(requirement.id)}`,
    goal: `${requirement.title}. ${requirement.oracleSketch}`,
    write_scope: files,
    files,
    touches: [...touches],
    requirements: [requirement.id],
    depends_on: [],
    level: "Junior",
    behaviors: [requirement.ears],
    task_type: "leaf",
    checks: [
      {
        id: `visible-${safe(requirement.id)}`,
        kind: requirement.kind,
        requirement_ids: [requirement.id],
        visibility: "visible",
        entry_point: requirement.entryPoint,
        example,
      },
    ],
    integration_slot: null,
    contract_ids: requirement.contractId ? [requirement.contractId] : [],
    entity_ids: requirement.entityId ? [requirement.entityId] : [],
  };
}

function visibleExample(requirement: RequirementInput): { input: string; expected: string; assertion: string } {
  if (requirement.kind === "ui") {
    return {
      input: "submit form",
      expected: "Saved",
      assertion: "expect(screen.getByRole('button', { name: 'Save' })).toHaveTextContent('Saved')",
    };
  }
  return {
    input: '{"amount":1}',
    expected: "201",
    assertion: "expect(res.status).toBe(201)",
  };
}

function journeyCheck(featureId: string, title: string): Record<string, unknown> {
  return {
    id: `journey-${safe(featureId)}`,
    kind: "ui",
    requirement_ids: [],
    visibility: "visible",
    entry_point: "role=main[name=Feature]",
    example: {
      input: `open ${title}`,
      expected: "ready",
      assertion: "expect(screen.getByRole('main', { name: 'Feature' })).toBeVisible()",
    },
  };
}

export function deterministicOracle(input: unknown): unknown {
  const oracle = readOracleInput(input);
  const heldBack = [];
  for (const requirement of oracle.requirements) {
    if (requirement.trivial) continue;
    heldBack.push(...casesFor(requirement));
  }
  return {
    schema: "oracle-author@1",
    held_back: heldBack,
    rubrics: [],
  };
}

function casesFor(requirement: OracleModelInput["requirements"][number]): Record<string, unknown>[] {
  const hay = `${requirement.ears} ${requirement.oracleSketch}`.toLowerCase();
  if (hay.includes("11:00") || hay.includes("cutoff")) {
    return [
      held(requirement, "happy", { at: "10:59" }, "201", "expect(res.status).toBe(201)"),
      held(requirement, "boundary", { at: "11:00" }, "201", "expect(res.status).toBe(201)"),
      held(requirement, "negative", { at: "11:01" }, "422", "expect(res.status).toBe(422)"),
    ];
  }
  if (requirement.kind === "ui") {
    return [
      held(requirement, "happy", { name: "Ada" }, "Saved", "expect(screen.getByRole('button', { name: 'Save' })).toHaveTextContent('Saved')"),
      held(requirement, "boundary", { name: "" }, "Saved", "expect(screen.getByRole('status', { name: 'Empty' })).toHaveTextContent('Empty')"),
      held(requirement, "adversarial", { name: "other-tenant" }, "Forbidden", "expect(screen.getByRole('alert', { name: 'Forbidden' })).toHaveTextContent('Forbidden')"),
    ];
  }
  if (hay.includes("authz") || hay.includes("idor") || hay.includes("tenant")) {
    return [
      held(requirement, "happy", { tenant: "self", id: "order-1" }, "200", "expect(res.status).toBe(200)"),
      held(requirement, "boundary", { tenant: "self", id: "" }, "404", "expect(res.status).toBe(404)"),
      held(requirement, "adversarial", { tenant: "other", id: "order-1" }, "403", "expect(res.status).toBe(403)"),
    ];
  }
  if (hay.includes("money") || hay.includes("amount")) {
    return [
      held(requirement, "happy", { amount: 1 }, "201", "expect(res.status).toBe(201)"),
      held(requirement, "boundary", { amount: 0 }, "201", "expect(res.status).toBe(201)"),
      held(requirement, "negative", { amount: -1 }, "422", "expect(res.status).toBe(422)"),
    ];
  }
  const boundary = hay.includes("unicode") ? { name: "café" } : { q: "" };
  return [
    held(requirement, "happy", { name: "Ada" }, "201", "expect(res.status).toBe(201)"),
    held(requirement, "boundary", boundary, "201", "expect(res.status).toBe(201)"),
    held(requirement, "negative", { submit: "duplicate" }, "409", "expect(res.status).toBe(409)"),
  ];
}

function held(
  requirement: OracleModelInput["requirements"][number],
  diversity: Diversity,
  body: unknown,
  expected: string,
  assertion: string,
): Record<string, unknown> {
  return {
    check_id: `sealed-${safe(requirement.id)}-${diversity}`,
    requirement_ids: [requirement.id],
    input: JSON.stringify({ sketch: requirement.oracleSketch, body }),
    expected,
    rule_id: requirement.ruleId,
    diversity,
    kind: requirement.kind,
    entry_point: requirement.entryPoint,
    assertion,
  };
}

export function deterministicOracleRepair(input: unknown): unknown {
  const record = asRecord(input, "oracle repair");
  const heldBack = Array.isArray(record.held_back) ? record.held_back : [];
  return {
    schema: "oracle-author@1",
    held_back: heldBack.map((item, index) => cleanCase(item, index)),
    rubrics: [],
  };
}

function cleanCase(value: unknown, index: number): Record<string, unknown> {
  const record = asRecord(value, `repair[${index}]`);
  const kind = requireString(record.kind, "kind") as CheckKind;
  const checkId = requireString(record.check_id, "check_id");
  const requirementIds = requireStringArray(record.requirement_ids, "requirement_ids");
  const diversity = requireString(record.diversity, "diversity");
  const ruleId = record.rule_id === null || typeof record.rule_id === "string" ? record.rule_id : null;
  if (kind === "ui") {
    return {
      check_id: checkId,
      requirement_ids: requirementIds,
      input: "submit form",
      expected: "Saved",
      rule_id: ruleId,
      diversity,
      kind,
      entry_point: "role=button[name=Save]",
      assertion: "expect(screen.getByRole('button', { name: 'Save' })).toHaveTextContent('Saved')",
    };
  }
  const entry = typeof record.entry_point === "string" ? record.entry_point : "";
  const keepEntry = entry.includes("/api/") && !entry.includes("stripe") && !entry.includes("/internal/");
  return {
    check_id: checkId,
    requirement_ids: requirementIds,
    input: '{"amount":1}',
    expected: "201",
    rule_id: ruleId,
    diversity,
    kind,
    entry_point: keepEntry ? entry : "POST /api/orders",
    assertion: "expect(res.status).toBe(201)",
  };
}
