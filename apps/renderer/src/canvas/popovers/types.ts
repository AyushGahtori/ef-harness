export const HIGHLIGHT_MS = 8_000;
export const POPOVER_WIDTH = 320;
export const POPOVER_HEIGHT = 360;
export const POPOVER_GAP = 8;
export const PAN_ZOOM = 1.2;
export const NAME_LIST_LIMIT = 3;
export const NARROW_TOOLBAR_AT = 12;

export const INK = "#1c1917";
export const PAPER = "#fafaf9";
export const BUTTON_BG = "#e7e5e4";
export const GREEN_FG = "#052e16";
export const GREEN_BG = "#dcfce7";
export const VIOLET_FG = "#3b0764";
export const VIOLET_BG = "#f3e8ff";
export const AMBER_FG = "#7c2d12";
export const AMBER_BG = "#ffedd5";
export const FADED_FG = "#292524";
export const FADED_BG = "#f5f5f4";

export const CANONICAL_NODE_TYPES = [
  "project",
  "decision",
  "requirement",
  "feature",
  "entity",
  "contract",
  "screen_spec",
  "cross_cutting_rule",
  "seam",
  "research_fact",
  "task",
  "check",
  "conflict",
  "brand_asset",
] as const;

export type CanonicalNodeType = (typeof CANONICAL_NODE_TYPES)[number];

export const NODE_TYPE_NAMES = [
  "project",
  "scope",
  "decision",
  "requirement",
  "feature",
  "entity",
  "contract",
  "api_endpoint",
  "screen_spec",
  "cross_cutting_rule",
  "seam",
  "research_fact",
  "task",
  "check",
  "oracle",
  "conflict",
  "brand_asset",
  "brownfield_module",
] as const;

export type NodeTypeName = (typeof NODE_TYPE_NAMES)[number];

export const TYPE_ALIASES: Readonly<Record<NodeTypeName, CanonicalNodeType>> = {
  project: "project",
  scope: "project",
  decision: "decision",
  requirement: "requirement",
  feature: "feature",
  entity: "entity",
  contract: "contract",
  api_endpoint: "contract",
  screen_spec: "screen_spec",
  cross_cutting_rule: "cross_cutting_rule",
  seam: "seam",
  research_fact: "research_fact",
  task: "task",
  check: "check",
  oracle: "check",
  conflict: "conflict",
  brand_asset: "brand_asset",
  brownfield_module: "brand_asset",
};

export const FEATURE_RUNTIMES = [
  "QUEUED",
  "WORKING",
  "LEAVES_MERGED",
  "INTEGRATING",
  "DONE",
] as const;
export type FeatureRuntime = (typeof FEATURE_RUNTIMES)[number];

export const PROJECT_STAGES = ["Prototype", "MVP", "Production"] as const;
export type ProjectStage = (typeof PROJECT_STAGES)[number];

export const SCREEN_STATES = ["empty", "loading", "populated", "error"] as const;
export type ScreenState = (typeof SCREEN_STATES)[number];

export const TASK_LEVELS = ["Jr", "Mid", "Sr"] as const;
export type TaskLevel = (typeof TASK_LEVELS)[number];

export const DECISION_BASES = ["explicit", "derived", "delegated"] as const;
export type DecisionBasis = (typeof DECISION_BASES)[number];

export const BOX_CHAT_INTENTS = [
  "ask",
  "change",
  "correct_misheard",
  "add_child",
  "remove_defer",
  "explain_impact",
  "focus_connected",
] as const;
export type BoxChatIntent = (typeof BOX_CHAT_INTENTS)[number];

export const HIGHLIGHT_KINDS = ["new", "updated", "rechecking", "removed"] as const;
export type HighlightKind = (typeof HIGHLIGHT_KINDS)[number];

export const CHOSEN_FOR_YOU = "Chosen for you (MVP recommended default)";
export const ARCHIVED_POPOVER = "This item was archived/removed";
export const SEALED_ACTIVE_FAMILY = "Independent family";

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface Evidence {
  quote: string;
  locator: string;
}

export interface PremiseLink {
  nodeId: string;
  label: string;
}

export interface GraphEdge {
  from: string;
  to: string;
  type: "depends_on" | "derived_from" | "implements" | "consumes" | "contradicts";
}

export interface GraphDelta {
  added: readonly string[];
  updated: readonly string[];
  impacted: readonly string[];
  removed: readonly string[];
}

export interface NodeBase {
  id: string;
  revision: number;
  label: string;
  rect: Rect;
  evidence: Evidence;
}

export interface ProjectNode extends NodeBase {
  type: "project" | "scope";
  stage: ProjectStage;
  readinessDone: number;
  readinessTotal: number;
}

export interface DecisionNode extends NodeBase {
  type: "decision";
  settledValue: string;
  basis: DecisionBasis;
  verbatimQuote: string;
  turnLocator: string;
  premises: readonly PremiseLink[];
}

export interface RequirementNode extends NodeBase {
  type: "requirement";
  ears: string;
  oracleSketch: string;
  linkedFeature: string;
  linkedTasks: readonly string[];
  status: string;
}

export interface FeatureNode extends NodeBase {
  type: "feature";
  wave: number;
  runtime: FeatureRuntime;
  tasksDone: number;
  tasksTotal: number;
}

export interface EntityNode extends NodeBase {
  type: "entity";
  fields: readonly string[];
  ownerFeature: string;
  touches: readonly string[];
  locked: boolean;
}

export interface ContractNode extends NodeBase {
  type: "contract" | "api_endpoint";
  method: string;
  route: string;
  eventSchema: string;
  owner: string;
  consumers: readonly PremiseLink[];
  skeletonLocked: boolean;
}

export interface ScreenSpecNode extends NodeBase {
  type: "screen_spec";
  route: string;
  roles: readonly string[];
  states: readonly ScreenState[];
  wireframeLabel: string;
}

export interface CrossCuttingRuleNode extends NodeBase {
  type: "cross_cutting_rule";
  ruleId: string;
  imperative: string;
  tagScope: "any" | "all";
  tags: readonly string[];
  matchedTaskCount: number;
}

export interface SeamNode extends NodeBase {
  type: "seam";
  features: readonly string[];
  surfaces: readonly string[];
  templateContract: string;
  failureModes: readonly string[];
}

export interface ResearchFactNode extends NodeBase {
  type: "research_fact";
  claim: string;
  docQuote: string;
  sourceUrl: string;
  docVersion: string;
  dtsVerified: boolean;
}

export interface TaskNode extends NodeBase {
  type: "task";
  agentId: string;
  shortTitle: string;
  level: TaskLevel;
  lane: string;
  hold: string;
  writeScope: readonly string[];
}

export interface CheckNode extends NodeBase {
  type: "check" | "oracle";
  sealed: boolean;
  featureBuilding: boolean;
  caseCount: number;
  family: string;
  pending: boolean;
  verdict: string;
  verdictAt: string;
  visibleSummary: string;
  sealedSource: string;
}

export interface ConflictNode extends NodeBase {
  type: "conflict";
  left: PremiseLink;
  right: PremiseLink;
  unsatCore: string;
  counterexample: string;
}

export interface BrandAssetNode extends NodeBase {
  type: "brand_asset";
  thumbnailLabel: string;
  licenseStatus: string;
}

export interface BrownfieldModuleNode extends NodeBase {
  type: "brownfield_module";
  level: "L1" | "L2";
  fileRank: number;
  exports: readonly string[];
  callers: readonly string[];
}

export type CanvasNode =
  | ProjectNode
  | DecisionNode
  | RequirementNode
  | FeatureNode
  | EntityNode
  | ContractNode
  | ScreenSpecNode
  | CrossCuttingRuleNode
  | SeamNode
  | ResearchFactNode
  | TaskNode
  | CheckNode
  | ConflictNode
  | BrandAssetNode
  | BrownfieldModuleNode;

export type PopoverAction =
  | {
      id: string;
      label: string;
      kind: "intent";
      intent: BoxChatIntent;
      tokens: number;
    }
  | {
      id: string;
      label: string;
      kind: "sibling";
      sibling: string;
      method: string;
      tokens: number;
    }
  | { id: string; label: string; kind: "pin"; tokens: number }
  | { id: string; label: string; kind: "close"; tokens: number };

export interface PopoverField {
  label: string;
  value: string;
}

export interface PopoverModel {
  archived: boolean;
  nodeId: string | null;
  canonical: CanonicalNodeType | null;
  title: string;
  fields: readonly PopoverField[];
  links: readonly PremiseLink[];
  actions: readonly PopoverAction[];
  thumbnailAlt: string | null;
}

export interface ToolbarAction {
  id: string;
  label: string;
  intent: BoxChatIntent | "clear";
  tokens: number;
  combined: boolean;
}

export interface ActiveHighlight {
  nodeId: string;
  kind: HighlightKind;
  badge: "+ New" | "Updated" | "Re-checking" | "Removed / Deferred";
  tone: "green" | "violet" | "amber" | "faded";
  pulse: boolean;
  outline: boolean;
  strike: boolean;
  opacity: number;
  offscreen: boolean;
  staticContrast: boolean;
}

export interface Placement {
  x: number;
  y: number;
  width: number;
  height: number;
  flippedX: boolean;
  flippedY: boolean;
}

export interface PanZoomTarget {
  nodeId: string;
  x: number;
  y: number;
  zoom: number;
}

export interface VProps {
  id?: string;
  role?: string;
  ariaLabel?: string;
  href?: string;
  alt?: string;
  fg?: string;
  bg?: string;
  tabIndex?: number;
  minTargetPx?: number;
  attrs?: Readonly<Record<string, string>>;
}

export type VChild = string | VNode;

export interface VNode {
  type: string;
  props: VProps;
  children: readonly VChild[];
}

export interface AxeViolation {
  id: string;
  impact: "serious" | "critical";
  message: string;
}

export interface AxeReport {
  violations: readonly AxeViolation[];
  seriousOrCritical: readonly AxeViolation[];
}

export interface SummaryNoun {
  singular: string;
  plural: string;
  order: number;
}

export class UnknownCanvasNodeTypeError extends Error {
  readonly typeName: string;

  constructor(typeName: string) {
    super(`Unsupported canvas node type: ${typeName}`);
    this.name = "UnknownCanvasNodeTypeError";
    this.typeName = typeName;
  }
}

export function canonicalType(typeName: string): CanonicalNodeType {
  if (!isNodeTypeName(typeName)) throw new UnknownCanvasNodeTypeError(typeName);
  return TYPE_ALIASES[typeName];
}

export function isNodeTypeName(value: string): value is NodeTypeName {
  return (NODE_TYPE_NAMES as readonly string[]).includes(value);
}

export function selectionSummaryNoun(typeName: NodeTypeName): SummaryNoun {
  switch (typeName) {
    case "project":
    case "scope":
      return { singular: "Project", plural: "Projects", order: 10 };
    case "decision":
      return { singular: "Decision", plural: "Decisions", order: 1 };
    case "requirement":
      return { singular: "Requirement", plural: "Requirements", order: 3 };
    case "feature":
      return { singular: "Feature", plural: "Features", order: 0 };
    case "entity":
      return { singular: "Entity", plural: "Entities", order: 4 };
    case "contract":
    case "api_endpoint":
      return { singular: "Contract", plural: "Contracts", order: 5 };
    case "screen_spec":
      return { singular: "Screen", plural: "Screens", order: 6 };
    case "cross_cutting_rule":
      return { singular: "Rule", plural: "Rules", order: 2 };
    case "seam":
      return { singular: "Seam", plural: "Seams", order: 7 };
    case "research_fact":
      return { singular: "Fact", plural: "Facts", order: 8 };
    case "task":
      return { singular: "Task", plural: "Tasks", order: 9 };
    case "check":
    case "oracle":
      return { singular: "Check", plural: "Checks", order: 11 };
    case "conflict":
      return { singular: "Conflict", plural: "Conflicts", order: 12 };
    case "brand_asset":
      return { singular: "Asset", plural: "Assets", order: 13 };
    case "brownfield_module":
      return { singular: "Module", plural: "Modules", order: 14 };
    default: {
      const unexpected: never = typeName;
      throw new UnknownCanvasNodeTypeError(unexpected);
    }
  }
}

export function zeroTokenIntent(intent: BoxChatIntent): boolean {
  return intent === "ask" || intent === "explain_impact" || intent === "focus_connected";
}
