import { defaultPresetPorts } from "./local-ports.js";
import { PhasePreferenceMemory } from "./phase-preference-memory.js";
import {
  BUILD_QUICK_TOGGLE_LABELS,
  BUILD_QUICK_TOGGLE_TABS,
  BUILD_RAIL_SECTIONS,
  BUILD_TABS,
  DISCOVER_RAIL_SECTIONS,
  FIXED_SHELL_REGIONS,
  PLAN_RAIL_SECTIONS,
  PLAN_TABS,
  SHIP_CENTER_SURFACE,
  SHIP_INSPECTOR_PANELS,
  SHIP_RAIL_SECTIONS,
  SHIP_TABS,
  type AppliedPhasePreset,
  type BuildCenterTab,
  type BuildFallbackReason,
  type CenterLayout,
  type CenterTab,
  type InspectorLayout,
  type LeftRailLayout,
  type LifecyclePhase,
  type OfficePresentation,
  type PhaseEnvironment,
  type PhaseSelection,
  type PhaseUserOverride,
  type PresetPorts,
  type SelectionKind,
} from "./types.js";

const OPENS_ON = {
  discover: "box",
  plan: "task-or-feature",
  build: "worker",
  ship: "run",
} as const;

function pressure(level: PhaseEnvironment["governorLevel"]): boolean {
  return level === "orange" || level === "red";
}

function hasOverride(override: PhaseUserOverride): boolean {
  return (
    override.leftRailPresentation !== undefined ||
    override.centerTab !== undefined ||
    override.inspectorCollapsed !== undefined
  );
}

function withRailPresentation(base: LeftRailLayout, override: PhaseUserOverride): LeftRailLayout {
  const presentation = override.leftRailPresentation;
  if (presentation === undefined) return base;
  return {
    ...base,
    presentation,
    wide: presentation === "expanded",
  };
}

function selectionOpens(phase: LifecyclePhase, selection: PhaseSelection | null): boolean {
  if (!selection) return false;
  const kind: SelectionKind = selection.kind;
  if (phase === "discover") return kind === "box";
  if (phase === "plan") return kind === "task" || kind === "feature";
  if (phase === "build") return kind === "worker";
  return kind === "run";
}

function isBuildTab(tab: CenterTab): tab is BuildCenterTab {
  return (BUILD_TABS as readonly string[]).includes(tab);
}

function orderTabs(primary: CenterTab, tabs: readonly CenterTab[]): readonly CenterTab[] {
  return [primary, ...tabs.filter((tab) => tab !== primary)];
}

export class PhaseLayoutPresetManager {
  private readonly memory: PhasePreferenceMemory;
  private readonly ports: PresetPorts;

  constructor(options?: { memory?: PhasePreferenceMemory; ports?: PresetPorts }) {
    this.memory = options?.memory ?? new PhasePreferenceMemory();
    this.ports = options?.ports ?? defaultPresetPorts();
  }

  apply(phase: LifecyclePhase, environment: PhaseEnvironment): AppliedPhasePreset {
    const override = this.memory.override(environment.projectId, phase);
    return {
      phase,
      projectId: environment.projectId,
      fixedRegions: FIXED_SHELL_REGIONS,
      leftRail: withRailPresentation(this.leftRail(phase), override),
      center: this.center(phase, environment, override),
      inspector: this.inspector(phase, environment, override),
      userOverridesApplied: hasOverride(override),
      llmCalls: 0,
    };
  }

  customize(projectId: string, phase: LifecyclePhase, patch: PhaseUserOverride): void {
    if (patch.centerTab !== undefined && !tabAllowed(phase, patch.centerTab)) {
      throw new Error(`Tab ${patch.centerTab} is not part of the ${phase} preset`);
    }
    this.memory.merge(projectId, phase, patch);
    if (phase === "build" && (patch.centerTab === "office" || patch.centerTab === "board")) {
      this.memory.setPreferredBuildTab(projectId, patch.centerTab);
    }
  }

  /** Explicit Office/Board choice. Remembered across sessions and builds. */
  setBuildTab(projectId: string, tab: "office" | "board"): void {
    this.memory.setPreferredBuildTab(projectId, tab);
    this.memory.merge(projectId, "build", { centerTab: tab });
  }

  private leftRail(phase: LifecyclePhase): LeftRailLayout {
    if (phase === "discover") {
      const readiness = this.ports.discover.honestReadinessCount();
      return {
        presentation: "expanded",
        wide: true,
        sections: DISCOVER_RAIL_SECTIONS,
        chat: "open",
        stageChip: this.ports.discover.stageChip(),
        honestReadinessCount: readiness,
      };
    }
    if (phase === "plan") {
      return {
        presentation: "compact",
        wide: false,
        sections: PLAN_RAIL_SECTIONS,
        chat: "open",
        stageChip: null,
        honestReadinessCount: null,
      };
    }
    if (phase === "build") {
      return {
        presentation: "expanded",
        wide: false,
        sections: BUILD_RAIL_SECTIONS,
        chat: "collapsed-recent",
        stageChip: null,
        honestReadinessCount: null,
      };
    }
    return {
      presentation: "expanded",
      wide: false,
      sections: SHIP_RAIL_SECTIONS,
      chat: "available",
      stageChip: null,
      honestReadinessCount: null,
    };
  }

  private center(
    phase: LifecyclePhase,
    environment: PhaseEnvironment,
    override: PhaseUserOverride,
  ): CenterLayout {
    if (phase === "discover") {
      return {
        primaryTab: "architecture-canvas",
        focusedTabs: ["architecture-canvas"],
        quickToggleTabs: [],
        quickToggleLabels: [],
        planSurface: null,
        shipSurface: null,
        officePresentation: null,
        fallbackReasons: [],
      };
    }
    if (phase === "plan") {
      const surface = this.ports.plan.describeCenter();
      const primary = planPrimary(override.centerTab);
      return {
        primaryTab: primary,
        focusedTabs: orderTabs(primary, PLAN_TABS),
        quickToggleTabs: [],
        quickToggleLabels: [],
        planSurface: surface,
        shipSurface: null,
        officePresentation: null,
        fallbackReasons: [],
      };
    }
    if (phase === "build") {
      return this.buildCenter(environment, override);
    }
    const primary = shipPrimary(override.centerTab);
    return {
      primaryTab: primary,
      focusedTabs: orderTabs(primary, SHIP_TABS),
      quickToggleTabs: [],
      quickToggleLabels: [],
      planSurface: null,
      shipSurface: SHIP_CENTER_SURFACE,
      officePresentation: null,
      fallbackReasons: [],
    };
  }

  private buildCenter(environment: PhaseEnvironment, override: PhaseUserOverride): CenterLayout {
    const explicit = buildExplicit(override.centerTab);
    const preferred = this.memory.preferredBuildTab(environment.projectId);
    const reasons: BuildFallbackReason[] = [];
    if (environment.prefersReducedMotion) reasons.push("reduced-motion");
    if (pressure(environment.governorLevel)) reasons.push("governor-pressure");
    const constrained = reasons.length > 0;

    let primary: CenterTab = "office";
    let officePresentation: OfficePresentation | null = "animated";
    let fallbackReasons: readonly BuildFallbackReason[] = [];

    if (explicit === "architecture-canvas" || explicit === "live-preview") {
      primary = explicit;
      officePresentation = null;
    } else if (explicit === "board" || (explicit === undefined && preferred === "board")) {
      primary = "board";
      officePresentation = null;
    } else if (explicit === "office" || preferred === "office") {
      primary = "office";
      officePresentation = constrained ? "static-seated" : "animated";
    } else if (constrained) {
      primary = "board";
      officePresentation = null;
      fallbackReasons = reasons;
    }

    return {
      primaryTab: primary,
      focusedTabs: [primary],
      quickToggleTabs: BUILD_QUICK_TOGGLE_TABS,
      quickToggleLabels: BUILD_QUICK_TOGGLE_LABELS,
      planSurface: null,
      shipSurface: null,
      officePresentation,
      fallbackReasons,
    };
  }

  private inspector(
    phase: LifecyclePhase,
    environment: PhaseEnvironment,
    override: PhaseUserOverride,
  ): InspectorLayout {
    const opens = selectionOpens(phase, environment.selection);
    const collapsed = override.inspectorCollapsed ?? !opens;
    const panels = phase === "ship" ? SHIP_INSPECTOR_PANELS : (["selection"] as const);
    return {
      collapsed,
      opensOn: OPENS_ON[phase],
      panels,
      selectedId: collapsed ? null : (environment.selection?.id ?? null),
      transition: environment.prefersReducedMotion ? "instant" : "smooth",
    };
  }
}

function tabAllowed(phase: LifecyclePhase, tab: CenterTab): boolean {
  if (phase === "discover") return tab === "architecture-canvas";
  if (phase === "plan") return (PLAN_TABS as readonly string[]).includes(tab);
  if (phase === "build") return isBuildTab(tab);
  return (SHIP_TABS as readonly string[]).includes(tab);
}

function buildExplicit(tab: CenterTab | undefined): BuildCenterTab | undefined {
  if (tab !== undefined && isBuildTab(tab)) return tab;
  return undefined;
}

function planPrimary(tab: CenterTab | undefined): CenterTab {
  if (tab === "spec-tree" || tab === "plan-preview") return tab;
  return "plan-preview";
}

function shipPrimary(tab: CenterTab | undefined): CenterTab {
  if (tab !== undefined && (SHIP_TABS as readonly string[]).includes(tab)) return tab;
  return "landing-summary";
}
