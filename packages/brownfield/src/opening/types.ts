export const BROWNFIELD_QUICK_PROMPTS = [
  {
    id: "add_feature",
    label: "Add a new feature",
    description: "Fits cleanly into existing architecture and conventions",
    defaultWorkKind: "new_feature" as const,
    routeHint: null,
  },
  {
    id: "change_flow",
    label: "Change or extend an existing flow",
    description: "Modifies an existing screen or API safely",
    defaultWorkKind: "flow_change" as const,
    routeHint: null,
  },
  {
    id: "fix_bug",
    label: "Fix a bug or mystery issue",
    description: "Routes into Bug Scrubber / mystery investigation",
    defaultWorkKind: "bug_fix" as const,
    routeHint: "bug_scrubber" as const,
  },
  {
    id: "performance_fix",
    label: "Make something faster (Performance fix)",
    description: "Activates mandatory measurable baseline interview",
    defaultWorkKind: "performance_fix" as const,
    routeHint: null,
  },
  {
    id: "sweep",
    label: "Clean up or refactor across files (Sweep)",
    description: "Routes into Safe Sweep",
    defaultWorkKind: "sweep" as const,
    routeHint: "safe_sweep" as const,
  },
] as const;

export type BrownfieldQuickPromptId = (typeof BROWNFIELD_QUICK_PROMPTS)[number]["id"];

export type BrownfieldWorkKind =
  | "bug_fix"
  | "performance_fix"
  | "new_feature"
  | "flow_change"
  | "sweep";

export type WorkItemDbKind = "project" | "change" | "fix" | "feature_request";

export interface BrownfieldWorkItemDraft {
  readonly ordinal: number;
  readonly kind: BrownfieldWorkKind;
  readonly title: string;
  readonly userPrompt: string;
  readonly recommendedOrder: number;
}

export interface BrownfieldWorkItemRow {
  readonly id: string;
  readonly dbKind: WorkItemDbKind;
  readonly kind: BrownfieldWorkKind;
  readonly title: string;
  readonly status: "discovering" | "ready" | "planned" | "done" | "abandoned";
  readonly createdAtMs: number;
}

export type StackCriterionId =
  | "stack.language"
  | "stack.framework"
  | "stack.db_engine"
  | "stack.auth_library"
  | "stack.css_system"
  | "stack.test_runner";

export interface ObservedCriterionSettlement {
  readonly criterionId: StackCriterionId;
  readonly value: string;
  readonly basis: "observed";
  readonly evidence: readonly string[];
}

export interface ScopeFenceModule {
  readonly modulePath: string;
  readonly access: "in_scope" | "read_only";
}

export interface ConventionsCard {
  readonly markdown: string;
  readonly estimatedTokens: number;
  readonly basis: "observed";
}

export type CanvasLayer = "today" | "change";

export interface CanvasModuleOverlay {
  readonly id: string;
  readonly label: string;
  readonly layer: CanvasLayer;
  readonly emphasis: "dimmed_slate" | "highlighted_delta";
  readonly paths: readonly string[];
}

export interface BrownfieldConfirmationCard {
  readonly headline: string;
  readonly observedStackSummary: string;
  readonly affectedModules: readonly string[];
  readonly staleDocsIgnored: readonly string[];
  readonly untouchedSubsystems: readonly string[];
  readonly staleDocNotes: readonly string[];
}

export interface TodayChangeCanvasProjection {
  readonly confirmation: BrownfieldConfirmationCard;
  readonly overlays: readonly CanvasModuleOverlay[];
}

export interface PerfSurfaceSpec {
  readonly surface: string;
  readonly datasetSize: number;
  readonly datasetUnit: "rows" | "items";
}

export interface SqlExplainFinding {
  readonly planLine: string;
  readonly usesSequentialScan: boolean;
  readonly indexName: string | null;
}

export interface PerfBaselineCapture {
  readonly timingMsP95: number;
  readonly explain: readonly SqlExplainFinding[];
  readonly capturedAtMs: number;
  readonly engine: "sqlite" | "postgres";
}

export interface PerfTargetThreshold {
  readonly maxP95Ms: number;
  readonly forbidSequentialScanOn: string | null;
  readonly requiredIndexScan: string | null;
}

export interface PerfInterviewState {
  readonly workItemId: string;
  readonly surface: PerfSurfaceSpec | null;
  readonly baseline: PerfBaselineCapture | null;
  readonly target: PerfTargetThreshold | null;
  readonly phase: "needs_surface" | "needs_baseline" | "needs_target" | "complete";
  readonly readyForPlanning: boolean;
}

export interface ContributorDocHint {
  readonly path: string;
  readonly sanitizedExcerpt: string;
  readonly trusted: false;
  readonly injectionPatternsStripped: number;
}

export interface BrownfieldOpeningSummary {
  readonly isNonemptyRepo: true;
  readonly skipsGreenfieldStackQuestions: true;
  readonly quickPrompts: typeof BROWNFIELD_QUICK_PROMPTS;
  readonly l0StackSummary: string;
  readonly testCount: number;
  readonly zeroTestSafetyNetRecommended: boolean;
  readonly observedSettlements: readonly ObservedCriterionSettlement[];
  readonly scopeFence: readonly ScopeFenceModule[];
  readonly conventions: ConventionsCard | null;
  readonly contributorHints: readonly ContributorDocHint[];
}

export function mapBrownfieldKindToDb(kind: BrownfieldWorkKind): WorkItemDbKind {
  switch (kind) {
    case "bug_fix":
      return "fix";
    case "new_feature":
      return "feature_request";
    case "performance_fix":
    case "flow_change":
    case "sweep":
      return "change";
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}

export function estimateTokens(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return Math.max(1, Math.ceil(trimmed.length / 4));
}