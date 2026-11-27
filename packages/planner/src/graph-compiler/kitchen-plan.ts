import type {
  CompilationInput,
  PlanCheck,
  PlanFeature,
  PlannedName,
  PlanRequirement,
  PlanTask,
  RequirementSensitivity,
  TaskKind,
  TaskLevel,
} from "./types.js";

const COMPILED_AT = "2026-11-20T12:00:00.000Z";

function task(fields: {
  readonly id: string;
  readonly featureId: string;
  readonly title: string;
  readonly taskKind?: TaskKind;
  readonly level?: TaskLevel;
  readonly file: string;
  readonly touches: readonly string[];
  readonly rules: readonly string[];
  readonly requirementId: string;
  readonly names?: readonly PlannedName[];
  readonly mutatesSharedContract?: boolean;
  readonly createsMigration?: boolean;
  readonly migrationIntentSlot?: string | null;
}): PlanTask {
  return {
    id: fields.id,
    featureId: fields.featureId,
    title: fields.title,
    taskKind: fields.taskKind ?? "leaf",
    level: fields.level ?? "junior",
    writeScope: [fields.file],
    primaryFiles: [fields.file],
    responsibilities: [fields.title],
    touches: fields.touches,
    mustBandTokens: 400,
    mustTokenAttribution: [{ nodeId: fields.requirementId, tokens: 400 }],
    mustBandRuleIds: fields.rules,
    implements: [fields.requirementId],
    obeys: [],
    handlesEdgeCases: [],
    dependsOn: [],
    names: fields.names ?? [],
    mutatesSharedContract: fields.mutatesSharedContract ?? false,
    createsMigration: fields.createsMigration ?? false,
    migrationIntentSlot: fields.migrationIntentSlot ?? null,
    estimatedMinCostMicroUsd: 1_000,
    generatedScaffold: false,
  };
}

function requirement(fields: {
  readonly id: string;
  readonly featureId: string;
  readonly title: string;
  readonly sensitivities?: readonly RequirementSensitivity[];
  readonly risk?: "low" | "medium" | "high";
}): PlanRequirement {
  return {
    id: fields.id,
    featureId: fields.featureId,
    title: fields.title,
    kind: "spec_item",
    active: true,
    risk: fields.risk ?? "low",
    sensitivities: fields.sensitivities ?? [],
    waived: false,
    waiverApprovedBy: null,
    waiverReason: null,
  };
}

function visible(id: string, featureId: string, requirementId: string): PlanCheck {
  return { id, featureId, requirementIds: [requirementId], visibility: "visible" };
}

function sealed(id: string, featureId: string, requirementId: string): PlanCheck {
  return { id, featureId, requirementIds: [requirementId], visibility: "sealed" };
}

export function createKitchenAppWavePlan(): CompilationInput {
  const features: PlanFeature[] = [
    { id: "F-Shared", title: "Shared envelope", dependsOn: [], active: true },
    { id: "F-Menu", title: "Menu", dependsOn: [], active: true },
    { id: "F-Orders", title: "Orders", dependsOn: ["F-Menu"], active: true },
    { id: "F-Kitchen", title: "Kitchen print", dependsOn: ["F-Orders"], active: true },
  ];
  const tasks: PlanTask[] = [
    task({
      id: "T-Contract",
      featureId: "F-Shared",
      title: "Publish the shared error envelope contract",
      taskKind: "integration",
      level: "senior",
      file: "src/contracts/envelope.ts",
      touches: ["route"],
      rules: ["X-11"],
      requirementId: "REQ-SHARED",
      mutatesSharedContract: true,
      names: [{ kind: "exported_symbol", value: "formatEnvelope", method: null }],
    }),
    task({
      id: "T-Menu-Schema",
      featureId: "F-Menu",
      title: "Create the menu table",
      file: "src/menu/schema.ts",
      touches: ["migration"],
      rules: [],
      requirementId: "REQ-MENU-SCHEMA",
      createsMigration: true,
      migrationIntentSlot: "20261120_menu",
      names: [{ kind: "db_table", value: "menu", method: null }],
    }),
    task({
      id: "T-Menu-Api",
      featureId: "F-Menu",
      title: "Serve the menu endpoint",
      file: "src/menu/api.ts",
      touches: ["route", "authz"],
      rules: ["X-01", "X-11"],
      requirementId: "REQ-MENU-API",
      names: [{ kind: "http_route", value: "POST /api/menu", method: null }],
    }),
    task({
      id: "T-Orders-Api",
      featureId: "F-Orders",
      title: "Create an order",
      file: "src/orders/api.ts",
      touches: ["route", "authz", "money"],
      rules: ["X-01", "X-04", "X-11"],
      requirementId: "REQ-ORDERS",
      names: [{ kind: "http_route", value: "POST /api/orders", method: null }],
    }),
    task({
      id: "T-Refund",
      featureId: "F-Orders",
      title: "Refund an order for an admin",
      file: "src/orders/refund.ts",
      touches: ["route", "authz", "money"],
      rules: ["X-01", "X-04", "X-11"],
      requirementId: "REQ-12",
      names: [{ kind: "http_route", value: "POST /api/orders/refund", method: null }],
    }),
    task({
      id: "T-Orders-Ui",
      featureId: "F-Orders",
      title: "Show the order form",
      file: "src/orders/ui.tsx",
      touches: ["interactive_ui", "form_input"],
      rules: ["X-02", "X-11", "X-13"],
      requirementId: "REQ-ORDERS-UI",
      names: [{ kind: "exported_symbol", value: "OrdersPage", method: null }],
    }),
    task({
      id: "T-Kitchen-Print",
      featureId: "F-Kitchen",
      title: "Print today's kitchen totals",
      file: "src/kitchen/print.ts",
      touches: ["route", "interactive_ui", "time_display"],
      rules: ["X-03", "X-11", "X-13"],
      requirementId: "REQ-KITCHEN",
      names: [{ kind: "page_route", value: "/kitchen", method: null }],
    }),
  ];
  const requirements: PlanRequirement[] = [
    requirement({ id: "REQ-SHARED", featureId: "F-Shared", title: "Errors use the shared envelope" }),
    requirement({ id: "REQ-MENU-SCHEMA", featureId: "F-Menu", title: "Menu rows persist" }),
    requirement({ id: "REQ-MENU-API", featureId: "F-Menu", title: "Cooks can read the menu" }),
    requirement({ id: "REQ-ORDERS", featureId: "F-Orders", title: "Staff can create an order" }),
    requirement({
      id: "REQ-12",
      featureId: "F-Orders",
      title: "Admin-only refund endpoint",
      risk: "high",
      sensitivities: ["auth", "payments"],
    }),
    requirement({ id: "REQ-ORDERS-UI", featureId: "F-Orders", title: "Staff can submit the order form" }),
    requirement({ id: "REQ-KITCHEN", featureId: "F-Kitchen", title: "Kitchen shows locked totals" }),
  ];
  const checks: PlanCheck[] = [
    visible("CHK-SHARED", "F-Shared", "REQ-SHARED"),
    sealed("CHK-SHARED-SEALED", "F-Shared", "REQ-SHARED"),
    visible("CHK-MENU-SCHEMA", "F-Menu", "REQ-MENU-SCHEMA"),
    visible("CHK-MENU-API", "F-Menu", "REQ-MENU-API"),
    sealed("CHK-MENU-SEALED", "F-Menu", "REQ-MENU-API"),
    visible("CHK-ORDERS", "F-Orders", "REQ-ORDERS"),
    visible("CHK-REFUND", "F-Orders", "REQ-12"),
    sealed("CHK-ORDERS-SEALED", "F-Orders", "REQ-12"),
    visible("CHK-ORDERS-UI", "F-Orders", "REQ-ORDERS-UI"),
    visible("CHK-KITCHEN", "F-Kitchen", "REQ-KITCHEN"),
    sealed("CHK-KITCHEN-SEALED", "F-Kitchen", "REQ-KITCHEN"),
  ];
  return {
    tasks,
    features,
    requirements,
    checks,
    contradictions: [],
    brownfieldNames: [{ kind: "http_route", value: "GET /api/health", owner: "legacy-health", method: null }],
    mustAsk: [{ id: "Q-CUTOFF", blocking: true, settled: true }],
    budget: { remainingProjectMicroUsd: 20_000_000, remainingWaveMicroUsd: 5_000_000 },
    waivers: [],
    sharedContractOwnerTaskIds: ["T-Contract"],
    platform: "windows",
    planEpoch: 7,
    compiledAt: COMPILED_AT,
  };
}
