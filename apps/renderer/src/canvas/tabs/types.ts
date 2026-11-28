export const MATRIX_CATALOG = [
  { id: "M01", title: "Role × Action Permissions Matrix" },
  { id: "M02", title: "Entity × CRUD & Lifecycle Matrix" },
  { id: "M03", title: "Screen × UI State Matrix" },
  { id: "M04", title: "API Endpoint × Status & Error Matrix" },
  { id: "M05", title: "Form Field × Validation & Boundary Matrix" },
  { id: "M06", title: "State Machine × Transition Matrix" },
  { id: "M07", title: "External Integration × Failure Matrix" },
  { id: "M08", title: "Notification × Trigger, Channel & Opt-Out Matrix" },
  { id: "M09", title: "Concurrency & Race × Shared Resource Matrix" },
  { id: "M10", title: "Data Retention, Privacy & Export Matrix" },
  { id: "M11", title: "Viewport / Device / Accessibility Matrix" },
  { id: "M12", title: "Migration, Seed & Upgrade Matrix" },
] as const;

export type MatrixId = (typeof MATRIX_CATALOG)[number]["id"];

export const PHASE0_STEPS = ["P0.1", "P0.2", "P0.3", "P0.4", "P0.5", "P0.6", "P0.7", "P0.8"] as const;

export type Phase0Step = (typeof PHASE0_STEPS)[number];

export type CrewLevel = "Junior" | "Mid" | "Senior";

export type TierChip = "Jr" | "Mid" | "Sr";

export type CrewPreset = "Fastest" | "Balanced" | "Cheapest";

export type CanvasTheme = "light" | "dark";

export type WorkspaceSurface = "canvas" | "spec" | "plan" | "board" | "vscode";

export type MatrixFillStatus = "pass1" | "pass2" | "pass3" | "proposed" | "conflict" | "na";

export type NodeKind =
  | "decision"
  | "spec_item"
  | "edge_case"
  | "rule"
  | "journey"
  | "contract"
  | "arch_node"
  | "research_fact"
  | "plan"
  | "feature"
  | "task"
  | "check"
  | "waiver"
  | "ccr"
  | "source"
  | "asset"
  | "comment";

export type NodeStatus = "draft" | "active" | "retired" | "superseded";

export interface StoredNode {
  readonly id: string;
  readonly kind: string;
  readonly version: number;
  readonly title: string;
  readonly text: string;
  readonly status: string;
  readonly feature: string | null;
  readonly basis: string | null;
  readonly fields: Readonly<Record<string, unknown>>;
}

export interface NodeDraft {
  readonly id: string;
  readonly kind: NodeKind;
  readonly title: string;
  readonly text?: string;
  readonly status?: NodeStatus;
  readonly fields?: Readonly<Record<string, unknown>>;
}

export interface ConflictItem {
  readonly id: string;
  readonly summary: string;
  readonly cellIds: readonly string[];
  readonly decisionIds: readonly string[];
}

export interface OutlineNode {
  readonly id: string;
  readonly kind: string;
  readonly title: string;
  readonly text: string;
  readonly feature: string | null;
  readonly basis: string | null;
  readonly status: string;
  readonly fields: Readonly<Record<string, unknown>>;
}

export interface FeatureOutline {
  readonly id: string;
  readonly title: string;
  readonly slug: string;
  readonly viewPath: string | null;
  readonly requirements: readonly OutlineNode[];
  readonly contracts: readonly OutlineNode[];
  readonly screens: readonly OutlineNode[];
  readonly seams: readonly OutlineNode[];
  readonly research: readonly OutlineNode[];
  readonly cliCommands: readonly OutlineNode[];
  readonly exitCodes: readonly OutlineNode[];
}

export interface OutlineSnapshot {
  readonly projectKind: "ui" | "cli";
  readonly overview: OutlineNode | null;
  readonly decisions: readonly OutlineNode[];
  readonly chosenForYou: readonly OutlineNode[];
  readonly features: readonly FeatureOutline[];
  readonly rules: readonly OutlineNode[];
  readonly conflicts: readonly ConflictItem[];
  readonly mustAsk: number;
}

export interface MatrixRow {
  readonly id: string;
  readonly matrixId: string;
  readonly title: string;
  readonly text: string;
  readonly recordType: "universal_rule" | "matrix_exception" | "matrix_cell";
  readonly status: MatrixFillStatus;
  readonly axisA: string;
  readonly axisB: string;
}

export interface MatrixPage {
  readonly total: number;
  readonly rows: readonly MatrixRow[];
}

export interface ReviewProposal {
  readonly cellId: string;
  readonly featureId: string;
  readonly featureTitle: string;
  readonly matrixId: string;
  readonly requirementId: string;
  readonly title: string;
  readonly earsText: string;
  readonly oracleSketch: string;
  readonly risk: "medium";
  readonly basis: "proposed";
}

export interface ReviewGroup {
  readonly featureId: string;
  readonly featureTitle: string;
  readonly matrixId: string;
  readonly proposals: readonly ReviewProposal[];
}

export interface ReviewEdit {
  readonly cellId: string;
  readonly earsText: string;
  readonly oracleSketch: string;
}

export interface ReviewSettleCommand {
  readonly approve?: readonly string[];
  readonly reject?: readonly string[];
  readonly edits?: readonly ReviewEdit[];
}

export interface ReadinessCounts {
  readonly pendingProposals: number;
  readonly conflicts: number;
  readonly mustAsk: number;
  readonly explicitSettled: number;
  readonly isReady: boolean;
}

export interface ReviewSettleResult {
  readonly approved: readonly string[];
  readonly rejected: readonly string[];
  readonly edited: readonly string[];
  readonly readiness: ReadinessCounts;
}

export interface PlannedLeaf {
  readonly id: string;
  readonly title: string;
  readonly featureId: string;
  readonly featureTitle: string;
  readonly band: "phase0" | "wave1";
  readonly step: Phase0Step | null;
  readonly writeScope: readonly string[];
  readonly balancedLevel: CrewLevel;
  readonly safetyFloor: CrewLevel;
  readonly criticalPath: boolean;
  readonly juniorCostMicroUsd: number;
  readonly durationMinutes: number;
}

export interface ProjectedWave {
  readonly id: string;
  readonly title: string;
  readonly wave: number;
  readonly taskMin: number;
  readonly taskMax: number;
  readonly costMinMicroUsd: number;
  readonly costMaxMicroUsd: number;
}

export interface DeferredItem {
  readonly id: string;
  readonly label: string;
  readonly reason: string;
  readonly revisitWave: string;
}

export interface PlanSnapshot {
  readonly mode: "first" | "revision";
  readonly deltaText: string;
  readonly planned: readonly PlannedLeaf[];
  readonly projected: readonly ProjectedWave[];
  readonly chosenForYou: readonly OutlineNode[];
  readonly deferred: readonly DeferredItem[];
  readonly conflicts: readonly ConflictItem[];
  readonly mustAsk: number;
}

export interface PricedLeaf extends PlannedLeaf {
  readonly level: CrewLevel;
  readonly chip: TierChip;
  readonly costMicroUsd: number;
  readonly minutes: number;
}

export interface RuntimeRow {
  readonly taskId: string;
  readonly title: string;
  readonly agentId: string;
  readonly featureId: string;
  readonly featureTitle: string;
  readonly wave: number;
  readonly lane: string;
  readonly tier: string;
  readonly model: string;
  readonly retries: number;
  readonly elapsedMs: number;
  readonly costMicroUsd: number;
  readonly windowUnits: number;
  readonly mergeSha: string;
}

export type RuntimeSortKey =
  | "agent"
  | "feature"
  | "wave"
  | "lane"
  | "tier"
  | "retries"
  | "elapsed"
  | "cost"
  | "sha";

export interface RuntimeQuery {
  readonly sort: RuntimeSortKey;
  readonly direction: "asc" | "desc";
  readonly filter: string;
  readonly offset: number;
  readonly limit: number;
  readonly nowMs: number;
}

export interface RuntimePage {
  readonly total: number;
  readonly rows: readonly RuntimeRow[];
}

export interface RuntimeDraft {
  readonly id: string;
  readonly title: string;
  readonly featureId: string;
  readonly featureTitle: string;
  readonly wave: number;
  readonly lane: string;
  readonly tier: string;
  readonly model: string;
  readonly agentId: string;
  readonly retries: number;
  readonly elapsedMs: number;
  readonly costMicroUsd: number;
  readonly windowUnits: number;
  readonly mergeSha: string;
}

export interface TaskRuntimeDraft {
  readonly taskId: string;
  readonly featureId: string;
  readonly state: string;
  readonly level: string;
}

export interface AttemptDraft {
  readonly id: string;
  readonly taskId: string;
  readonly n: number;
  readonly runtime: string;
  readonly model: string;
  readonly startedAt: number;
  readonly endedAt: number;
}

export interface BudgetDraft {
  readonly scopeId: string;
  readonly currency: "usd" | "allowance:window";
  readonly spentUnits: number;
}

export interface CandidateDraft {
  readonly id: string;
  readonly taskId: string;
  readonly attemptId: string;
  readonly commitSha: string;
  readonly receivedAt: number;
}

export interface InboxDraft {
  readonly id: string;
  readonly kind: string;
  readonly subject: string;
  readonly priority: number;
  readonly status?: "open" | "answered" | "superseded" | "dismissed";
  readonly payload: Readonly<Record<string, unknown>>;
}
