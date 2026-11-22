export type InspectorTab = "timeline" | "diff" | "checks" | "brief" | "raw";

/** Where the shell mounted this inspector. Pop-out is Task 123. */
export type InspectorHost = "collapsible-shell" | "popout";

export type CrewLevel = "Jr" | "Mid" | "Sr";

export type BoardLane =
  | "Queued"
  | "Working"
  | "Waiting on you"
  | "Held"
  | "Verifying"
  | "Integrating"
  | "Done";

export type AttemptOutcome = "failed" | "pass" | "running" | "queued";

export type CheckLayer =
  | "STATIC_AUDIT"
  | "typecheck"
  | "lint"
  | "unit"
  | "playwright"
  | "reviewer@1"
  | "taste-reviewer@1"
  | "hidden";

export type CheckStatus = "pass" | "fail" | "advisory";

export type DiffLayout = "unified" | "split";

export type RequirementBand = "MUST" | "SHOULD" | "COULD";

export interface InspectorSelectionProps {
  readonly taskId: string;
  readonly host: InspectorHost;
  /** When omitted, the inspector selects the latest attempt. */
  readonly attemptId?: string;
}

export interface WorkerIdentity {
  readonly agentId: string;
  readonly title: string;
  readonly model: string;
  readonly connection: string;
  readonly level: CrewLevel;
  readonly elapsedMs: number;
  readonly spendMicroUsd: number;
  readonly lane: BoardLane;
  readonly holdReason: string | null;
  readonly phase0GateOpen: boolean;
  readonly waitingOn: readonly string[];
  readonly estimatedLevel: CrewLevel;
  readonly estimatedCostMicroUsd: number;
}

export interface TimelineMilestone {
  readonly id: string;
  readonly at: string;
  readonly summary: string;
  readonly command: string | null;
  readonly commandOutput: string | null;
  readonly handoffId: string | null;
  readonly filePath: string | null;
  readonly line: number | null;
}

export interface DiffFileSummary {
  readonly path: string;
  readonly byteSize: number;
  readonly insertions: number;
  readonly deletions: number;
}

export interface DiffHunkBody {
  readonly index: number;
  readonly header: string;
  readonly oldStart: number;
  readonly newStart: number;
  readonly lines: readonly string[];
}

export interface CheckReceipt {
  readonly id: string;
  readonly layer: CheckLayer;
  readonly status: CheckStatus;
  readonly summary: string;
  readonly sealedSource: string | null;
  readonly hideSealedSource: boolean;
  readonly screenshotArtifactId: string | null;
  readonly disputeAvailable: boolean;
}

export interface AttemptSnapshot {
  readonly attemptId: string;
  readonly number: number;
  readonly outcome: AttemptOutcome;
  readonly hint: string | null;
  readonly model: string;
  readonly level: CrewLevel;
  readonly escalatedFrom: CrewLevel | null;
  readonly sliceSha256: string | null;
  readonly logArtifactId: string | null;
  readonly milestones: readonly TimelineMilestone[];
  readonly files: readonly DiffFileSummary[];
  readonly checks: readonly CheckReceipt[];
}

export interface InspectorTaskSnapshot {
  readonly identity: WorkerIdentity;
  readonly attempts: readonly AttemptSnapshot[];
}

export interface BriefRequirement {
  readonly id: string;
  readonly band: RequirementBand;
  readonly version: number;
  readonly text: string;
  /** Set when the live graph moved past the pinned version. Text stays historical. */
  readonly laterVersion: number | null;
}

export interface BriefRule {
  readonly id: string;
  readonly text: string;
}

export interface BriefSkill {
  readonly id: string;
  readonly sha256: string;
}

export interface BriefPull {
  readonly tool: string;
  readonly targetId: string;
}

export interface PinnedBrief {
  readonly sliceSha256: string;
  readonly taskId: string;
  readonly nodeVersions: Readonly<Record<string, number>>;
  readonly mustTokens: number;
  readonly shouldTokens: number;
  readonly couldTokens: number;
  readonly requirements: readonly BriefRequirement[];
  readonly rules: readonly BriefRule[];
  readonly skills: readonly BriefSkill[];
  readonly writeScope: readonly string[];
  readonly pulls: readonly BriefPull[];
  readonly goal: string;
}

export interface HandoffRead {
  readonly handoffId: string;
  readonly tool: string;
  readonly summary: string;
}

export interface HandoffHop {
  readonly handoffId: string;
  readonly fromRole: string;
  readonly toRole: string;
  readonly summary: string;
}

export interface InspectorApplyResult {
  readonly applied: boolean;
}
