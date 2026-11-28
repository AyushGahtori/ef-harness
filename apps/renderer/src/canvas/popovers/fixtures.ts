import type {
  BrandAssetNode,
  BrownfieldModuleNode,
  CanvasNode,
  CheckNode,
  ConflictNode,
  ContractNode,
  CrossCuttingRuleNode,
  DecisionNode,
  EntityNode,
  Evidence,
  FeatureNode,
  FeatureRuntime,
  GraphEdge,
  ProjectNode,
  ProjectStage,
  Rect,
  RequirementNode,
  ResearchFactNode,
  ScreenSpecNode,
  SeamNode,
  TaskNode,
} from "./types.js";

export const SEALED_ORACLE_SOURCE = "sealed-oracle-body cutoff-hidden-cases v1";

const quote: Evidence = {
  quote: "Cutoff is 11:00, staff can edit until then",
  locator: "turn 4 · page 2",
};

function at(x: number, y: number): Rect {
  return { x, y, width: 140, height: 56 };
}

export function projectNode(stage: ProjectStage = "MVP", type: "project" | "scope" = "project"): ProjectNode {
  return {
    id: type === "project" ? "project-meal" : "scope-mvp",
    revision: 2,
    type,
    label: type === "project" ? "Meal ordering" : "MVP scope",
    rect: at(40, 40),
    evidence: quote,
    stage,
    readinessDone: type === "project" ? 16 : 18,
    readinessTotal: type === "project" ? 19 : 20,
  };
}

export function explicitDecision(): DecisionNode {
  return {
    id: "D-17",
    revision: 3,
    type: "decision",
    label: "Cutoff Rule R17",
    rect: at(220, 40),
    evidence: quote,
    settledValue: "11:00",
    basis: "explicit",
    verbatimQuote: "Cutoff is 11:00",
    turnLocator: "turn 4 · page 2",
    premises: [],
  };
}

export function derivedDecision(): DecisionNode {
  return {
    id: "D-derived",
    revision: 4,
    type: "decision",
    label: "Derived cutoff window",
    rect: at(220, 120),
    evidence: { quote: "Inferred from the cutoff the kitchen named", locator: "turn 5 · page 1" },
    settledValue: "11:00",
    basis: "derived",
    verbatimQuote: "",
    turnLocator: "",
    premises: [{ nodeId: "R-22", label: "R-22" }],
  };
}

export function delegatedDecision(): DecisionNode {
  return {
    id: "D-delegated",
    revision: 1,
    type: "decision",
    label: "Database default",
    rect: at(220, 200),
    evidence: { quote: "No database was named in discovery", locator: "turn 1 · page 1" },
    settledValue: "SQLite",
    basis: "delegated",
    verbatimQuote: "",
    turnLocator: "",
    premises: [],
  };
}

export function requirementNode(): RequirementNode {
  return {
    id: "R-22",
    revision: 6,
    type: "requirement",
    label: "R-22",
    rect: at(400, 40),
    evidence: quote,
    ears: "When the cutoff passes the system shall reject edits.",
    oracleSketch: "edits after 11:00 are rejected",
    linkedFeature: "Orders",
    linkedTasks: ["T05", "T07"],
    status: "proposed",
  };
}

export function featureNode(runtime: FeatureRuntime = "WORKING", id = "F-Orders", label = "Orders"): FeatureNode {
  return {
    id,
    revision: id === "F-Catering" ? 5 : 4,
    type: "feature",
    label,
    rect: at(40, 140),
    evidence: quote,
    wave: 2,
    runtime,
    tasksDone: 4,
    tasksTotal: 6,
  };
}

export function cateringFeature(): FeatureNode {
  return featureNode("QUEUED", "F-Catering", "Catering Email");
}

export function entityNode(): EntityNode {
  return {
    id: "entity-order",
    revision: 2,
    type: "entity",
    label: "Order",
    rect: at(40, 240),
    evidence: quote,
    fields: ["quantity", "notes"],
    ownerFeature: "Orders",
    touches: ["pii", "money"],
    locked: true,
  };
}

export function contractNode(type: "contract" | "api_endpoint" = "contract"): ContractNode {
  return {
    id: type === "contract" ? "contract-totals" : "endpoint-orders",
    revision: 3,
    type,
    label: type === "contract" ? "kitchen-totals/v1" : "POST /orders",
    rect: at(400, 160),
    evidence: quote,
    method: "POST",
    route: "/orders",
    eventSchema: "kitchen-totals/v1",
    owner: "Orders",
    consumers: [{ nodeId: "F-Orders", label: "Orders" }],
    skeletonLocked: true,
  };
}

export function screenNode(): ScreenSpecNode {
  return {
    id: "screen-kitchen",
    revision: 2,
    type: "screen_spec",
    label: "Kitchen page",
    rect: at(600, 40),
    evidence: quote,
    route: "/kitchen",
    roles: ["staff", "manager"],
    states: ["empty", "loading", "populated", "error"],
    wireframeLabel: "Kitchen page wireframe",
  };
}

export function ruleNode(id = "rule-x01", ruleId = "X-01"): CrossCuttingRuleNode {
  return {
    id,
    revision: 2,
    type: "cross_cutting_rule",
    label: ruleId,
    rect: at(600, 160),
    evidence: quote,
    ruleId,
    imperative: "Reject orders after cutoff.",
    tagScope: "any",
    tags: ["orders", "time"],
    matchedTaskCount: 6,
  };
}

export function seamNode(): SeamNode {
  return {
    id: "seam-print",
    revision: 1,
    type: "seam",
    label: "Print seam",
    rect: at(760, 40),
    evidence: quote,
    features: ["Orders", "Kitchen"],
    surfaces: ["print", "status"],
    templateContract: "kitchen-totals/v1",
    failureModes: ["timeout", "duplicate submit"],
  };
}

export function researchNode(): ResearchFactNode {
  return {
    id: "fact-layout",
    revision: 1,
    type: "research_fact",
    label: "Layered layout fact",
    rect: at(760, 160),
    evidence: quote,
    claim: "Layered layout keeps dependency edges readable.",
    docQuote: "ELK computes layered layouts for directed graphs.",
    sourceUrl: "https://example.com/docs/elk",
    docVersion: "v1.2.0",
    dtsVerified: true,
  };
}

export function taskNode(): TaskNode {
  return {
    id: "task-a0014",
    revision: 8,
    type: "task",
    label: "T03 · Kitchen print",
    rect: at(40, 360),
    evidence: quote,
    agentId: "A0014",
    shortTitle: "Kitchen print",
    level: "Sr",
    lane: "build",
    hold: "re-verify",
    writeScope: ["apps/renderer/src/canvas/popovers/**"],
  };
}

export function sealedCheckNode(): CheckNode {
  return {
    id: "check-sealed",
    revision: 2,
    type: "check",
    label: "Cutoff oracle",
    rect: at(220, 360),
    evidence: { quote: "Receipt sealed before the wave started", locator: "turn 9 · page 1" },
    sealed: true,
    featureBuilding: true,
    caseCount: 4,
    family: "Independent family",
    pending: true,
    verdict: "pending",
    verdictAt: "2026-11-23T10:00:00Z",
    visibleSummary: "Visible summary must stay hidden while sealed",
    sealedSource: SEALED_ORACLE_SOURCE,
  };
}

export function idleSealedOracle(): CheckNode {
  return {
    ...sealedCheckNode(),
    id: "oracle-idle",
    type: "oracle",
    label: "Idle sealed oracle",
    featureBuilding: false,
    pending: false,
    verdict: "pass",
  };
}

export function visibleCheckNode(): CheckNode {
  return {
    ...sealedCheckNode(),
    id: "check-visible",
    type: "check",
    label: "Visible cutoff check",
    sealed: false,
    featureBuilding: false,
    pending: false,
    verdict: "pass",
    verdictAt: "2026-11-23T10:04:00Z",
    visibleSummary: "Four visible examples passed",
  };
}

export function conflictNode(): ConflictNode {
  return {
    id: "conflict-cutoff",
    revision: 1,
    type: "conflict",
    label: "Cutoff conflict",
    rect: at(400, 360),
    evidence: quote,
    left: { nodeId: "D-17", label: "Cutoff Rule R17" },
    right: { nodeId: "R-22", label: "R-22" },
    unsatCore: "cutoff < open and cutoff > close",
    counterexample: "cutoff 10:30 violates both windows",
  };
}

export function brandNode(): BrandAssetNode {
  return {
    id: "asset-mark",
    revision: 1,
    type: "brand_asset",
    label: "Kitchen mark",
    rect: at(600, 360),
    evidence: quote,
    thumbnailLabel: "Kitchen mark",
    licenseStatus: "cleared for product UI",
  };
}

export function moduleNode(): BrownfieldModuleNode {
  return {
    id: "module-auth",
    revision: 7,
    type: "brownfield_module",
    label: "src/auth",
    rect: at(760, 360),
    evidence: { quote: "Observed module card from the current repo", locator: "file src/auth/index.ts" },
    level: "L2",
    fileRank: 12,
    exports: ["signIn", "signOut"],
    callers: ["src/router.ts"],
  };
}

export function primaryNodes(): CanvasNode[] {
  return [
    projectNode(),
    explicitDecision(),
    requirementNode(),
    featureNode(),
    entityNode(),
    contractNode(),
    screenNode(),
    ruleNode(),
    seamNode(),
    researchNode(),
    taskNode(),
    sealedCheckNode(),
    conflictNode(),
    brandNode(),
  ];
}

export function canvasNodes(): CanvasNode[] {
  return [
    ...primaryNodes(),
    projectNode("Production", "scope"),
    derivedDecision(),
    delegatedDecision(),
    cateringFeature(),
    contractNode("api_endpoint"),
    ruleNode("rule-up03", "UP-03"),
    idleSealedOracle(),
    visibleCheckNode(),
    moduleNode(),
  ];
}

export function canvasEdges(): GraphEdge[] {
  return [
    { from: "F-Orders", to: "D-17", type: "depends_on" },
    { from: "F-Orders", to: "entity-order", type: "consumes" },
    { from: "conflict-cutoff", to: "D-17", type: "contradicts" },
    { from: "D-derived", to: "R-22", type: "derived_from" },
  ];
}
