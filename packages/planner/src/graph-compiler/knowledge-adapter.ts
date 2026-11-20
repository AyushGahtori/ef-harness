import type { BudgetSnapshot, CompilationInput, TargetPlatform } from "./types.js";
import type {
  BrownfieldName,
  CompilationWaiver,
  ContradictionEdge,
  MustAskCriterion,
  NameKind,
  PlanCheck,
  PlanFeature,
  PlannedName,
  PlanRequirement,
  PlanTask,
  RequirementKind,
  RequirementSensitivity,
  TokenAttribution,
} from "./types.js";

export class KnowledgeGraphProjectionError extends Error {
  readonly code = "KNOWLEDGE_GRAPH_PROJECTION" as const;
  constructor(message: string) {
    super(message);
    this.name = "KnowledgeGraphProjectionError";
  }
}

export interface KnowledgeGraphNode {
  readonly id: string;
  readonly kind: string;
  readonly title: string;
  readonly status: string;
  readonly feature: string | null;
  readonly fields: Readonly<Record<string, unknown>>;
}

export interface KnowledgeGraphEdge {
  readonly src: string;
  readonly type: string;
  readonly dst: string;
  readonly resolved: boolean;
}

export interface KnowledgeGraphRepo {
  listNodes(): readonly KnowledgeGraphNode[];
  listEdges(): readonly KnowledgeGraphEdge[];
}

export interface KnowledgeGraphCompileContext {
  readonly budget: BudgetSnapshot;
  readonly waivers: readonly CompilationWaiver[];
  readonly mustAsk: readonly MustAskCriterion[];
  readonly brownfieldNames: readonly BrownfieldName[];
  readonly sharedContractOwnerTaskIds: readonly string[];
  readonly platform: TargetPlatform;
  readonly planEpoch: number;
  readonly compiledAt: string;
}

const REQUIREMENT_KINDS = new Set<RequirementKind>(["spec_item", "edge_case", "rule", "journey"]);

export function compilationInputFromKnowledgeGraph(
  repo: KnowledgeGraphRepo,
  context: KnowledgeGraphCompileContext,
): CompilationInput {
  const nodes = repo.listNodes();
  const edges = repo.listEdges();
  const outgoing = new Map<string, KnowledgeGraphEdge[]>();
  for (const edge of edges) {
    const list = outgoing.get(edge.src) ?? [];
    list.push(edge);
    outgoing.set(edge.src, list);
  }
  const destinations = (src: string, type: string): string[] =>
    (outgoing.get(src) ?? []).filter((edge) => edge.type === type).map((edge) => edge.dst);

  const features: PlanFeature[] = [];
  const tasks: PlanTask[] = [];
  const requirements: PlanRequirement[] = [];
  const checks: PlanCheck[] = [];
  for (const node of nodes) {
    if (node.kind === "feature") {
      features.push({
        id: node.id,
        title: node.title,
        dependsOn: destinations(node.id, "depends_on"),
        active: node.status === "active",
      });
      continue;
    }
    if (node.kind === "task") {
      tasks.push(taskFromNode(node, destinations));
      continue;
    }
    if (REQUIREMENT_KINDS.has(node.kind as RequirementKind)) {
      requirements.push(requirementFromNode(node));
      continue;
    }
    if (node.kind === "check") checks.push(checkFromNode(node, destinations(node.id, "verifies")));
  }
  const contradictions: ContradictionEdge[] = edges
    .filter((edge) => edge.type === "contradicts")
    .map((edge) => ({ src: edge.src, dst: edge.dst, resolved: edge.resolved }));
  return {
    tasks,
    features,
    requirements,
    checks,
    contradictions,
    brownfieldNames: context.brownfieldNames,
    mustAsk: context.mustAsk,
    budget: context.budget,
    waivers: context.waivers,
    sharedContractOwnerTaskIds: context.sharedContractOwnerTaskIds,
    platform: context.platform,
    planEpoch: context.planEpoch,
    compiledAt: context.compiledAt,
  };
}

function taskFromNode(
  node: KnowledgeGraphNode,
  destinations: (src: string, type: string) => string[],
): PlanTask {
  const featureId = node.feature ?? destinations(node.id, "belongs_to")[0] ?? "";
  if (featureId === "") {
    throw new KnowledgeGraphProjectionError(`Task ${node.id} has no feature.`);
  }
  return {
    id: node.id,
    featureId,
    title: node.title,
    taskKind: readEnum(node, "task_kind", ["leaf", "integration", "scaffold", "wiring", "sweep"]),
    level: readEnum(node, "level", ["junior", "senior"]),
    writeScope: readStrings(node, "write_scope"),
    primaryFiles: readStrings(node, "primary_files"),
    responsibilities: readStrings(node, "responsibilities"),
    touches: readStrings(node, "touches"),
    mustBandTokens: readNumber(node, "must_band_tokens"),
    mustTokenAttribution: readAttribution(node),
    mustBandRuleIds: readStrings(node, "must_band_rule_ids"),
    implements: destinations(node.id, "implements"),
    obeys: destinations(node.id, "obeys"),
    handlesEdgeCases: destinations(node.id, "handles_edge_case"),
    dependsOn: destinations(node.id, "depends_on"),
    names: readNames(node),
    mutatesSharedContract: readBoolean(node, "mutates_shared_contract"),
    createsMigration: readBoolean(node, "creates_migration"),
    migrationIntentSlot: readNullableString(node, "migration_intent_slot"),
    estimatedMinCostMicroUsd: readNumber(node, "estimated_min_cost_micro_usd"),
    generatedScaffold: readBoolean(node, "generated_scaffold"),
  };
}

function requirementFromNode(node: KnowledgeGraphNode): PlanRequirement {
  const featureId = node.feature ?? "";
  if (featureId === "") throw new KnowledgeGraphProjectionError(`Requirement ${node.id} has no feature.`);
  return {
    id: node.id,
    featureId,
    title: node.title,
    kind: node.kind as RequirementKind,
    active: node.status === "active",
    risk: readEnum(node, "risk", ["low", "medium", "high"]),
    sensitivities: readStrings(node, "sensitivities").filter(isSensitivity),
    waived: readBoolean(node, "waived"),
    waiverApprovedBy: readNullableString(node, "waiver_approved_by"),
    waiverReason: readNullableString(node, "waiver_reason"),
  };
}

function checkFromNode(node: KnowledgeGraphNode, requirementIds: readonly string[]): PlanCheck {
  const featureId = node.feature ?? "";
  if (featureId === "") throw new KnowledgeGraphProjectionError(`Check ${node.id} has no feature.`);
  return {
    id: node.id,
    featureId,
    requirementIds,
    visibility: readEnum(node, "visibility", ["visible", "sealed"]),
  };
}

function readStrings(node: KnowledgeGraphNode, key: string): string[] {
  const value = node.fields[key];
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new KnowledgeGraphProjectionError(`Node ${node.id} field ${key} must be a string array.`);
  }
  return value;
}

function readNumber(node: KnowledgeGraphNode, key: string): number {
  const value = node.fields[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new KnowledgeGraphProjectionError(`Node ${node.id} field ${key} must be a finite number.`);
  }
  return value;
}

function readBoolean(node: KnowledgeGraphNode, key: string): boolean {
  const value = node.fields[key];
  if (value === undefined) return false;
  if (typeof value !== "boolean") {
    throw new KnowledgeGraphProjectionError(`Node ${node.id} field ${key} must be a boolean.`);
  }
  return value;
}

function readNullableString(node: KnowledgeGraphNode, key: string): string | null {
  const value = node.fields[key];
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    throw new KnowledgeGraphProjectionError(`Node ${node.id} field ${key} must be a string or null.`);
  }
  return value;
}

function readEnum<T extends string>(node: KnowledgeGraphNode, key: string, allowed: readonly T[]): T {
  const value = node.fields[key];
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new KnowledgeGraphProjectionError(
      `Node ${node.id} field ${key} must be one of ${allowed.join(", ")}.`,
    );
  }
  return value as T;
}

function readAttribution(node: KnowledgeGraphNode): TokenAttribution[] {
  const value = node.fields.must_token_attribution;
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new KnowledgeGraphProjectionError(`Node ${node.id} field must_token_attribution must be an array.`);
  }
  return value.map((item) => {
    if (!item || typeof item !== "object") {
      throw new KnowledgeGraphProjectionError(`Node ${node.id} has a malformed token attribution.`);
    }
    const record = item as Record<string, unknown>;
    if (typeof record.nodeId !== "string" || typeof record.tokens !== "number") {
      throw new KnowledgeGraphProjectionError(`Node ${node.id} has a malformed token attribution.`);
    }
    return { nodeId: record.nodeId, tokens: record.tokens };
  });
}

function readNames(node: KnowledgeGraphNode): PlannedName[] {
  const value = node.fields.names;
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new KnowledgeGraphProjectionError(`Node ${node.id} field names must be an array.`);
  }
  return value.map((item) => {
    if (!item || typeof item !== "object") {
      throw new KnowledgeGraphProjectionError(`Node ${node.id} has a malformed name.`);
    }
    const record = item as Record<string, unknown>;
    if (typeof record.kind !== "string" || typeof record.value !== "string") {
      throw new KnowledgeGraphProjectionError(`Node ${node.id} has a malformed name.`);
    }
    const method = record.method;
    return {
      kind: record.kind as NameKind,
      value: record.value,
      method: typeof method === "string" ? method : null,
    };
  });
}

function isSensitivity(value: string): value is RequirementSensitivity {
  return value === "auth" || value === "payments" || value === "pii";
}
