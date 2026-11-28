import type { CanvasNodeKind, CanonicalGraphEdge, CanonicalGraphNode, NodeBasis, ProjectPhase, TaskRuntimeBadge } from "./types.js";

export interface StateDbNodeRow {
  readonly id: string;
  readonly kind: string;
  readonly title: string;
  readonly text: string;
  readonly status: CanonicalGraphNode["status"];
  readonly fields: string;
  readonly version: number;
}

export interface StateDbEdgeRow {
  readonly src: string;
  readonly dst: string;
  readonly type: string;
  readonly valid_to_rev: number | null;
}

const KIND_MAP: Readonly<Record<string, CanvasNodeKind>> = {
  decision: "decision",
  spec_item: "spec_item",
  edge_case: "requirement",
  journey: "requirement",
  requirement: "requirement",
  rule: "rule",
  contract: "contract",
  arch_node: "arch_node",
  feature: "feature",
  task: "task",
  entity: "entity",
  screen_spec: "screen_spec",
  api_endpoint: "api_endpoint",
  brownfield_module: "brownfield_module",
  scope: "scope",
  project: "project",
  integration: "integration",
  seam: "seam",
  conflict: "conflict",
  plan: "scope",
  asset: "brownfield_module",
  source: "brownfield_module",
  research_fact: "arch_node",
  check: "requirement",
};

const TASK_BADGE: Readonly<Record<string, TaskRuntimeBadge>> = {
  working: "working",
  verifying: "verifying",
  held: "held",
  done: "done",
  queued: "queued",
  CODING: "working",
  LEASED: "working",
  STATIC_AUDIT: "working",
  CLEAN_VERIFY: "verifying",
  WAITING_INPUT: "held",
  PARKED: "held",
  ESCALATED: "held",
  EXHAUSTED: "held",
  HUMAN_OWNED: "held",
  ACCEPTED: "done",
  MERGED_TO_FEATURE: "done",
  DRAFTED: "queued",
  READY: "queued",
};

function isBasis(value: unknown): value is NodeBasis {
  return (
    value === "explicit" ||
    value === "derived" ||
    value === "delegated" ||
    value === "defaulted" ||
    value === "proposed" ||
    value === "observed"
  );
}

function isPhase(value: unknown): value is ProjectPhase {
  return value === "discover" || value === "plan" || value === "build" || value === "ship";
}

function isKind(value: unknown): value is CanvasNodeKind {
  return typeof value === "string" && value in KIND_MAP;
}

export function projectStateDbNode(row: StateDbNodeRow): CanonicalGraphNode | null {
  if (row.status === "retired" || row.status === "superseded") return null;
  let fields: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(row.fields);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      fields = parsed as Record<string, unknown>;
    }
  } catch {
    fields = {};
  }
  const override = fields.canvasKind;
  const kind: CanvasNodeKind =
    (isKind(override) ? KIND_MAP[override] : KIND_MAP[row.kind]) ?? "arch_node";
  const basis = isBasis(fields.basis) ? fields.basis : null;
  const taskKey = typeof fields.task_state === "string" ? fields.task_state : fields.taskBadge;
  const taskBadge = typeof taskKey === "string" ? (TASK_BADGE[taskKey] ?? null) : null;
  const layerValue = fields.layer;
  const brownfieldLayer =
    layerValue === "today" || layerValue === "change"
      ? layerValue
      : basis === "observed"
        ? "today"
        : basis === "proposed"
          ? "change"
          : null;
  return {
    id: row.id,
    kind,
    title: row.title,
    text: row.text,
    basis,
    status: row.status,
    phase: isPhase(fields.phase) ? fields.phase : "discover",
    feature: typeof fields.feature === "string" ? fields.feature : null,
    fields,
    taskBadge: kind === "task" ? taskBadge : taskBadge,
    agentId: typeof fields.agentId === "string" ? fields.agentId : null,
    brownfieldLayer,
    skeletonLocked: fields.skeleton_locked === true,
    hasConflict: fields.conflict === true,
  };
}

export function projectStateDbEdge(row: StateDbEdgeRow): CanonicalGraphEdge | null {
  if (row.valid_to_rev !== null) return null;
  return { src: row.src, dst: row.dst, type: row.type };
}
