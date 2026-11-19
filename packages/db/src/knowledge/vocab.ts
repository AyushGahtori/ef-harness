/**
 * Seeded lookup rows from schema/state.sql.
 * Local binding of Task 010 `NODE_KINDS` / `EDGE_TYPES` until that barrel is wired.
 */

export const NODE_KINDS = [
  { kind: "decision", isRequirement: false },
  { kind: "spec_item", isRequirement: true },
  { kind: "edge_case", isRequirement: true },
  { kind: "rule", isRequirement: true },
  { kind: "journey", isRequirement: true },
  { kind: "contract", isRequirement: false },
  { kind: "arch_node", isRequirement: false },
  { kind: "research_fact", isRequirement: false },
  { kind: "plan", isRequirement: false },
  { kind: "feature", isRequirement: false },
  { kind: "task", isRequirement: false },
  { kind: "check", isRequirement: false },
  { kind: "waiver", isRequirement: false },
  { kind: "ccr", isRequirement: false },
  { kind: "source", isRequirement: false },
  { kind: "asset", isRequirement: false },
  { kind: "comment", isRequirement: false },
] as const;

export const EDGE_TYPES = [
  { type: "implements", invalidates: true },
  { type: "verifies", invalidates: true },
  { type: "consumes_contract", invalidates: true },
  { type: "produces_contract", invalidates: true },
  { type: "obeys", invalidates: true },
  { type: "handles_edge_case", invalidates: true },
  { type: "derived_from", invalidates: true },
  { type: "depends_on", invalidates: true },
  { type: "waives", invalidates: true },
  { type: "belongs_to", invalidates: false },
  { type: "documents", invalidates: false },
  { type: "cites", invalidates: false },
  { type: "comments_on", invalidates: false },
  { type: "supersedes", invalidates: false },
] as const;

export const SETTLED_BASES = [
  "explicit",
  "derived",
  "delegated",
  "defaulted",
  "proposed",
  "observed",
] as const;

export const CHANGE_CLASSES = [
  "cosmetic",
  "clarifying",
  "compatible",
  "breaking",
  "created",
  "retired",
] as const;

export const CHANGE_SET_ORIGINS = [
  "chat",
  "markdown_edit",
  "research",
  "planner",
  "sweep",
  "undo",
  "intake",
  "kernel",
  "import",
] as const;

export const NODE_STATUSES = ["draft", "active", "retired", "superseded"] as const;

export const TURN_AUTHORS = ["developer", "harness"] as const;

export const EVIDENCE_SOURCE_KINDS = ["turn", "source", "repo", "research"] as const;

export const UPDATE_CLASSES = ["cosmetic", "clarifying", "compatible", "breaking"] as const;

export type NodeKindName = (typeof NODE_KINDS)[number]["kind"];
export type EdgeTypeName = (typeof EDGE_TYPES)[number]["type"];
export type SettledBasis = (typeof SETTLED_BASES)[number];
export type ChangeClass = (typeof CHANGE_CLASSES)[number];
export type ChangeSetOrigin = (typeof CHANGE_SET_ORIGINS)[number];
export type NodeStatus = (typeof NODE_STATUSES)[number];
export type TurnAuthor = (typeof TURN_AUTHORS)[number];
export type EvidenceSourceKind = (typeof EVIDENCE_SOURCE_KINDS)[number];
export type UpdateClass = (typeof UPDATE_CLASSES)[number];

const nodeKindSet = new Set<string>(NODE_KINDS.map((row) => row.kind));
const edgeTypeSet = new Set<string>(EDGE_TYPES.map((row) => row.type));
const basisSet = new Set<string>(SETTLED_BASES);
const originSet = new Set<string>(CHANGE_SET_ORIGINS);
const statusSet = new Set<string>(NODE_STATUSES);
const updateClassSet = new Set<string>(UPDATE_CLASSES);
const turnAuthorSet = new Set<string>(TURN_AUTHORS);
const evidenceSourceSet = new Set<string>(EVIDENCE_SOURCE_KINDS);

export function isNodeKind(value: string): value is NodeKindName {
  return nodeKindSet.has(value);
}

export function isEdgeType(value: string): value is EdgeTypeName {
  return edgeTypeSet.has(value);
}

export function isSettledBasis(value: string): value is SettledBasis {
  return basisSet.has(value);
}

export function isChangeSetOrigin(value: string): value is ChangeSetOrigin {
  return originSet.has(value);
}

export function isNodeStatus(value: string): value is NodeStatus {
  return statusSet.has(value);
}

export function isUpdateClass(value: string): value is UpdateClass {
  return updateClassSet.has(value);
}

export function isTurnAuthor(value: string): value is TurnAuthor {
  return turnAuthorSet.has(value);
}

export function isEvidenceSourceKind(value: string): value is EvidenceSourceKind {
  return evidenceSourceSet.has(value);
}
