import { FeaturePlanDatabase, FeaturePlanningSession, FakeModelAdapter } from "../../src/feature-plan/index.js";
import type {
  ContractInput,
  EntityInput,
  FeatureArchitectureConsistency,
  ModelRoster,
  RequirementInput,
  SessionInput,
} from "../../src/feature-plan/index.js";

export const FEATURE_ID = "F-orders";

export function roster(families: ModelRoster["families"] = twoFamilies()): ModelRoster {
  return { families };
}

export function twoFamilies(): ModelRoster["families"] {
  return [
    {
      id: "openai",
      models: [
        { id: "gpt-senior", tier: "senior" },
        { id: "gpt-mini", tier: "mid" },
      ],
    },
    {
      id: "anthropic",
      models: [{ id: "claude-senior", tier: "senior" }],
    },
  ];
}

export function openAiOnly(): ModelRoster["families"] {
  return [
    {
      id: "openai",
      models: [
        { id: "gpt-senior", tier: "senior" },
        { id: "gpt-mini", tier: "mid" },
      ],
    },
  ];
}

export function architecture(passed = true): FeatureArchitectureConsistency {
  return {
    schema: "feature-architect@1",
    featureId: FEATURE_ID,
    passed,
    failures: passed ? [] : ["screen spec missing"],
  };
}

export function cutoffRequirement(files: readonly string[] = ["src/f-orders/REQ-cutoff.ts"]): RequirementInput {
  return {
    id: "REQ-cutoff",
    title: "Cutoff",
    ears: "An order at or before 11:00 is accepted.",
    oracleSketch: "cutoff at 11:00",
    touches: ["route", "scheduling"],
    trivial: false,
    nodeKind: "spec_item",
    kind: "api",
    entryPoint: "POST /api/orders",
    files,
    contractId: "C-orders",
    entityId: "ENT-order",
    ruleId: "R-cutoff",
  };
}

export function noteRequirement(): RequirementInput {
  return {
    id: "REQ-note",
    title: "Note",
    ears: "A note stores a unicode name.",
    oracleSketch: "unicode name",
    touches: ["route"],
    trivial: false,
    nodeKind: "spec_item",
    kind: "api",
    entryPoint: "POST /api/notes",
    files: ["src/f-orders/REQ-note.ts"],
    contractId: "C-orders",
    entityId: null,
    ruleId: null,
  };
}

export function contract(): ContractInput {
  return {
    id: "C-orders",
    title: "Orders API",
    entryPoint: "POST /api/orders",
    schemaName: "Order",
    route: "/api/orders",
  };
}

export function entity(): EntityInput {
  return {
    id: "ENT-order",
    title: "Order",
    touches: ["personal_data"],
  };
}

export function sessionInput(overrides: Partial<SessionInput> = {}): SessionInput {
  const model = overrides.model ?? new FakeModelAdapter();
  return {
    featureId: FEATURE_ID,
    featureTitle: "Orders",
    architecture: architecture(true),
    requirements: [cutoffRequirement(), noteRequirement()],
    contracts: [contract()],
    entities: [entity()],
    roster: roster(),
    buildWorker: { family: "openai", model: "gpt-senior" },
    model,
    now: 1_700_000_000_000,
    worktree: "C:/worktrees/feature-orders",
    ...overrides,
  };
}

export function openSession(input: SessionInput = sessionInput()): {
  db: FeaturePlanDatabase;
  session: FeaturePlanningSession;
  input: SessionInput;
} {
  const db = FeaturePlanDatabase.memory();
  const session = new FeaturePlanningSession(db);
  return { db, session, input };
}
