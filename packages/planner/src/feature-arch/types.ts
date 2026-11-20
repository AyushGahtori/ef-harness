/** Local stand-ins for sibling contracts that are not on this branch. */
export const LOCAL_PORTS = {
  featureArchitectV1Schema: "local-port:task-009",
  skeletonLockEnforcer: "local-port:task-083",
  deterministicArchConsistencyGate: "local-port:task-083",
  mermaidParser: "local-port:task-083-mermaid",
  seamTemplates: "local-port:task-077",
  m03ScreenStates: "local-port:task-079",
  layoutTemplates: "local-port:task-094",
  paperworkBudget: "local-port:task-090",
  knowledgeGraph: "local-port:task-017",
  nameRegistry: "local-port:task-019",
  boxChatSignoff: "local-port:task-154-156",
} as const;

export const FEATURE_ARCHITECT_CONTRACT_ID = "feature-architect@1" as const;
export const FEATURE_SHARD_TOKEN_CEILING = 3_000;
export const FEATURE_ARCH_PAPERWORK_SHARE = 0.05;

export const NODE_KINDS = [
  "decision",
  "spec_item",
  "edge_case",
  "rule",
  "journey",
  "contract",
  "arch_node",
  "research_fact",
  "plan",
  "feature",
  "task",
  "check",
  "waiver",
  "ccr",
  "source",
  "asset",
  "comment",
] as const;

export type NodeKind = (typeof NODE_KINDS)[number];

export const EDGE_TYPES = [
  "implements",
  "verifies",
  "consumes_contract",
  "produces_contract",
  "obeys",
  "handles_edge_case",
  "derived_from",
  "depends_on",
  "waives",
  "belongs_to",
  "documents",
  "cites",
  "comments_on",
  "supersedes",
] as const;

export type EdgeType = (typeof EDGE_TYPES)[number];

export type Basis =
  | "explicit"
  | "derived"
  | "delegated"
  | "defaulted"
  | "proposed"
  | "observed";

export type Surface = "web" | "api" | "cli" | "headless";

export type CollisionPolicy = "reject" | "hoist-shared" | "split-modules";

export interface ArchIssue {
  code: string;
  message: string;
  featureId?: string;
  nodeId?: string;
}

export interface ColumnSpec {
  name: string;
  type: string;
  nullable: boolean;
}

export interface LockedTable {
  name: string;
  locked: boolean;
  columns: ColumnSpec[];
}

export interface SkeletonSnapshot {
  locked: boolean;
  tables: LockedTable[];
}

export type SchemaDelta =
  | { op: "add_table"; table: string; columns: ColumnSpec[] }
  | { op: "add_column"; table: string; column: ColumnSpec }
  | { op: "drop_column"; table: string; column: string }
  | { op: "rename_column"; table: string; from: string; to: string }
  | { op: "change_type"; table: string; column: string; toType: string }
  | { op: "drop_table"; table: string };

export interface CcrProposal {
  id: string;
  class: "breaking";
  target: string;
  mutation: string;
  reason: string;
  routedTo: "task-112";
}

export interface LockReport {
  ok: boolean;
  violations: ArchIssue[];
  ccrProposals: CcrProposal[];
}

export interface ComponentNode {
  id: string;
  primitive: string;
  label?: string;
  variant?: "primary" | "secondary" | "danger";
  columns?: string[];
  focusable?: boolean;
  children?: ComponentNode[];
}

export interface ScreenLabel {
  id: string;
  text: string;
}

export interface ScreenEndpoint {
  id: string;
  kind: "fetch" | "mutation";
  method: string;
  path: string;
}

export interface ScreenSpec {
  id: string;
  slug: string;
  featureId: string;
  title: string;
  route: string;
  roles: string[];
  templateId: string;
  components: ComponentNode[];
  states: string[];
  labels: ScreenLabel[];
  copyConstraints: string[];
  keyboardOrder: string[];
  endpoints: ScreenEndpoint[];
  tags: string[];
}

export interface ScreenContext {
  featureId: string;
  featureSlug: string;
  surface: Surface;
  tags: readonly string[];
  observedPrimitives?: readonly string[];
}

export interface EndpointSpec {
  id: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  request: string;
  response: string;
  errors: string[];
}

export interface CliCommandSpec {
  name: string;
  summary: string;
}

export interface SeamBindingInput {
  templateId: string;
  sharedName: string;
  peer: string;
  sharedKind?: "entity" | "endpoint" | "event";
}

export interface TransitionSpec {
  from: string;
  to: string;
  event: string;
}

export interface RuleInput {
  id: string;
  text: string;
  crossCutting: boolean;
  localReason?: string;
}

export interface RealityReference {
  kind: "export" | "module" | "table_column" | "component";
  staleName: string;
  file?: string;
  table?: string;
}

export interface FeatureInput {
  id: string;
  slug: string;
  title: string;
  surface: Surface;
  requirements: string[];
  specItems: { id: string; text: string }[];
  edgeCases: { id: string; text: string }[];
  writePaths: string[];
  schemaDeltas: SchemaDelta[];
  endpoints: EndpointSpec[];
  cliCommands: CliCommandSpec[];
  seams: SeamBindingInput[];
  transitions: TransitionSpec[];
  failureModes: string[];
  journey: string[];
  screens: readonly unknown[];
  tags: string[];
  dependsOn: string[];
  references: RealityReference[];
  sequenceMermaid: string;
  stateMermaid: string;
  rules: RuleInput[];
}

export interface CatalogRequirement {
  id: string;
  text: string;
}

export interface NameRegistration {
  kind: string;
  name: string;
  ownerId: string;
}

export interface SynthesisRequest {
  mergedWave: number;
  targetWave: number;
  waveTokenBudget: number;
  integrationRoot?: string;
  features: FeatureInput[];
  skeleton: SkeletonSnapshot;
  requirements: CatalogRequirement[];
  collisionPolicy?: CollisionPolicy;
  knownFeatureIds?: string[];
  existingNames?: NameRegistration[];
}

export interface ObservedExport {
  file: string;
  name: string;
  signature: string;
  kind: "value" | "type";
}

export interface ObservedColumn {
  name: string;
  type: string;
  nullable: boolean;
}

export interface ObservedTable {
  name: string;
  file: string;
  columns: ObservedColumn[];
}

export interface ObservedComponent {
  name: string;
  file: string;
}

export interface ObservedReality {
  root: string;
  files: string[];
  exports: ObservedExport[];
  tables: ObservedTable[];
  components: ObservedComponent[];
}

export interface AnchorSubstitution {
  featureId: string;
  kind: RealityReference["kind"];
  staleName: string;
  actualName: string;
  file: string;
}

export interface GraphNode {
  id: string;
  kind: NodeKind;
  version: 1;
  title: string;
  text: string;
  fields: Record<string, unknown>;
  status: "active";
  contentHash: string;
}

export interface GraphEdge {
  src: string;
  type: EdgeType;
  dst: string;
}

export interface HandlingEntry {
  spec_item_or_edge_case: string;
  node_id: string;
}

export interface FeatureArchitectV1 {
  flows: { id: string; steps: string[] }[];
  screens: ScreenSpec[];
  state_machines: {
    id: string;
    mermaid: string;
    transitions: TransitionSpec[];
    failureModes: string[];
  }[];
  internal_contracts: {
    id: string;
    request: string;
    response: string;
    errors: string[];
  }[];
  handling: HandlingEntry[];
  hoisted_rules: {
    id: string;
    text: string;
    classification: "local" | "cross_cutting";
    reason?: string;
  }[];
}

export type FeatureArchitectParse =
  | { ok: true; value: FeatureArchitectV1 | { blocked: true; reason: string; missing_ids?: string[] } }
  | { ok: false; issues: string[] };

export interface OverflowFlag {
  code: "horizontal_overflow";
  viewport: "desktop" | "mobile";
  widthPx: 1440 | 375;
  reason: "table_columns" | "label_text";
  detail: string;
}

export interface WireframeView {
  viewport: "desktop" | "mobile";
  widthPx: 1440 | 375;
  svg: string;
  ascii: string;
  overflow: OverflowFlag[];
}

export interface WireframePair {
  screenId: string;
  desktop: WireframeView;
  mobile: WireframeView;
}

export interface ShardFile {
  path: string;
  canonicalNodeIds: string[];
  continuesNodeId?: string;
  body: string;
  tokens: number;
}

export interface ShardSet {
  shards: ShardFile[];
  ceiling: number;
  duplicatedNodeIds: string[];
  overCeiling: string[];
}

export interface ScreenRevision {
  screenId: string;
  hash: string;
  spec: ScreenSpec;
  wireframes: WireframePair;
}

export type BoxChatEdit =
  | { op: "set_label"; labelId: string; text: string }
  | { op: "set_route"; route: string }
  | { op: "set_roles"; roles: string[] }
  | { op: "set_states"; states: string[] };

export interface SynthesisResult {
  status: "accepted" | "rejected";
  persisted: boolean;
  issues: ArchIssue[];
  wave: number;
  anchored: AnchorSubstitution[];
  observed: ObservedReality | null;
  architectOutputs: FeatureArchitectV1[];
  nodes: GraphNode[];
  edges: GraphEdge[];
  shards: ShardFile[];
  wireframes: WireframePair[];
  screenSpecs: ScreenSpec[];
  signoff: ScreenRevision[];
  paperworkTokens: number;
  paperworkCeiling: number;
  ccrProposals: CcrProposal[];
  sharedWritePaths: { path: string; owner: "phase0-foundation" }[];
}
