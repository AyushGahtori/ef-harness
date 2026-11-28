export const LIFECYCLE_PHASES = ["discover", "plan", "build", "ship"] as const;
export type LifecyclePhase = (typeof LIFECYCLE_PHASES)[number];

export const PHASE_LABEL: Readonly<Record<LifecyclePhase, string>> = {
  discover: "Discover",
  plan: "Plan",
  build: "Build",
  ship: "Ship",
};

export const FIXED_SHELL_REGIONS = ["top-bar", "composer"] as const;
export type FixedShellRegion = (typeof FIXED_SHELL_REGIONS)[number];

export const GOVERNOR_LEVELS = ["green", "yellow", "orange", "red"] as const;
export type GovernorLevel = (typeof GOVERNOR_LEVELS)[number];

export type BuildTabPreference = "office" | "board";

export const CENTER_TABS = [
  "architecture-canvas",
  "plan-preview",
  "spec-tree",
  "office",
  "board",
  "live-preview",
  "landing-summary",
  "pr-ci-loop",
  "deploy-pipeline",
] as const;
export type CenterTab = (typeof CENTER_TABS)[number];

export const CENTER_TAB_LABEL: Readonly<Record<CenterTab, string>> = {
  "architecture-canvas": "Architecture Canvas",
  "plan-preview": "Plan Preview",
  "spec-tree": "Spec Tree",
  office: "Office",
  board: "Board",
  "live-preview": "Live Preview",
  "landing-summary": "Landing Summary",
  "pr-ci-loop": "PR/CI Loop",
  "deploy-pipeline": "Deploy Pipeline",
};

export const BUILD_QUICK_TOGGLE_TABS = ["board", "architecture-canvas", "live-preview"] as const;
export const BUILD_QUICK_TOGGLE_LABELS = ["Board", "Canvas", "Live Preview"] as const;

export const BUILD_TABS = ["office", "board", "architecture-canvas", "live-preview"] as const;
export type BuildCenterTab = (typeof BUILD_TABS)[number];

export const PLAN_TABS = ["plan-preview", "spec-tree"] as const;
export type PlanCenterTab = (typeof PLAN_TABS)[number];

export const SHIP_TABS = ["landing-summary", "pr-ci-loop", "deploy-pipeline"] as const;
export type ShipCenterTab = (typeof SHIP_TABS)[number];

export const LEFT_RAIL_SECTIONS = [
  "chat",
  "questions",
  "stage-chip",
  "honest-readiness-count",
  "calm-inbox",
  "checklist",
  "approvals",
] as const;
export type LeftRailSection = (typeof LEFT_RAIL_SECTIONS)[number];

export const DISCOVER_RAIL_SECTIONS = [
  "chat",
  "questions",
  "stage-chip",
  "honest-readiness-count",
] as const;
export const PLAN_RAIL_SECTIONS = ["chat"] as const;
export const BUILD_RAIL_SECTIONS = ["calm-inbox", "chat"] as const;
export const SHIP_RAIL_SECTIONS = ["checklist", "approvals"] as const;

export type InspectorPanel = "selection" | "diff" | "ci-logs" | "effect-receipts";
export const SHIP_INSPECTOR_PANELS = ["diff", "ci-logs", "effect-receipts"] as const;

export type OfficePresentation = "animated" | "static-seated";
export type BuildFallbackReason = "reduced-motion" | "governor-pressure";
export type InspectorOpenTarget = "box" | "task-or-feature" | "worker" | "run";
export type SelectionKind = "box" | "task" | "feature" | "worker" | "run";

export interface PhaseSelection {
  readonly kind: SelectionKind;
  readonly id: string;
}

export interface PhaseEnvironment {
  readonly projectId: string;
  readonly prefersReducedMotion: boolean;
  readonly governorLevel: GovernorLevel;
  readonly selection: PhaseSelection | null;
}

export interface LeftRailLayout {
  readonly presentation: "expanded" | "compact";
  readonly wide: boolean;
  readonly sections: readonly LeftRailSection[];
  readonly chat: "open" | "collapsed-recent" | "available";
  readonly stageChip: string | null;
  readonly honestReadinessCount: number | null;
}

export interface PlanCenterSurface {
  readonly title: "Plan Preview & Spec Tree";
  readonly plannedPhase0: "Planned Phase 0";
  readonly wave1: "Wave 1";
  readonly projectedWaves: "Projected Waves 2+";
  readonly crewPresetSelector: "Crew Preset";
  readonly chosenForYouLedger: "Chosen for you";
  readonly startBuild: {
    readonly label: "Start build";
    readonly prominent: true;
  };
}

export const PLAN_CENTER_SURFACE: PlanCenterSurface = {
  title: "Plan Preview & Spec Tree",
  plannedPhase0: "Planned Phase 0",
  wave1: "Wave 1",
  projectedWaves: "Projected Waves 2+",
  crewPresetSelector: "Crew Preset",
  chosenForYouLedger: "Chosen for you",
  startBuild: { label: "Start build", prominent: true },
};

export interface ShipCenterSurface {
  readonly landingSummary: "Landing Summary";
  readonly prCiLoop: "PR/CI Loop";
  readonly deployPipeline: "Deploy Pipeline";
}

export const SHIP_CENTER_SURFACE: ShipCenterSurface = {
  landingSummary: "Landing Summary",
  prCiLoop: "PR/CI Loop",
  deployPipeline: "Deploy Pipeline",
};

export interface CenterLayout {
  readonly primaryTab: CenterTab;
  readonly focusedTabs: readonly CenterTab[];
  readonly quickToggleTabs: readonly CenterTab[];
  readonly quickToggleLabels: readonly string[];
  readonly planSurface: PlanCenterSurface | null;
  readonly shipSurface: ShipCenterSurface | null;
  readonly officePresentation: OfficePresentation | null;
  readonly fallbackReasons: readonly BuildFallbackReason[];
}

export interface InspectorLayout {
  readonly collapsed: boolean;
  readonly opensOn: InspectorOpenTarget;
  readonly panels: readonly InspectorPanel[];
  readonly selectedId: string | null;
  readonly transition: "smooth" | "instant";
}

export interface AppliedPhasePreset {
  readonly phase: LifecyclePhase;
  readonly projectId: string;
  readonly fixedRegions: readonly FixedShellRegion[];
  readonly leftRail: LeftRailLayout;
  readonly center: CenterLayout;
  readonly inspector: InspectorLayout;
  readonly userOverridesApplied: boolean;
  readonly llmCalls: 0;
}

export interface PhaseUserOverride {
  readonly leftRailPresentation?: "expanded" | "compact";
  readonly centerTab?: CenterTab;
  readonly inspectorCollapsed?: boolean;
}

export interface DiscoverRailPort {
  stageChip(): string;
  honestReadinessCount(): number;
}

export interface PlanPreviewPort {
  describeCenter(): PlanCenterSurface;
}

export interface PresetPorts {
  readonly discover: DiscoverRailPort;
  readonly plan: PlanPreviewPort;
}

export type PhaseTransitionReason =
  | "discovery-ready-for-plan"
  | "completion-wave-ready-for-ship"
  | "phase-changed";

export interface PhaseTransition {
  readonly id: string;
  readonly from: LifecyclePhase;
  readonly to: LifecyclePhase;
  readonly reason: PhaseTransitionReason;
}

export interface UserActivity {
  readonly composerFocused: boolean;
  readonly typing: boolean;
  readonly inspecting: boolean;
  readonly activeTab: CenterTab;
  readonly composerText: string;
}

export interface BannerPresentation {
  readonly visible: true;
  readonly blocking: false;
  readonly placement: "top-of-center";
  readonly ariaLive: "polite";
  readonly message: string;
  readonly switchLabel: string;
  readonly stayLabel: "Stay here";
  readonly acceptKey: "Enter";
  readonly focusStolen: false;
  readonly activeTabChanged: false;
  readonly llmCalls: 0;
  readonly transition: PhaseTransition;
}

export interface ShellLayoutSnapshot {
  readonly phase: LifecyclePhase | null;
  readonly activeTab: CenterTab | null;
}

export interface ShellLayoutContextPort {
  applyPreset(preset: AppliedPhasePreset, reason: "initial" | "user-switch"): void;
  currentPhase(): LifecyclePhase | null;
  currentTab(): CenterTab | null;
}
