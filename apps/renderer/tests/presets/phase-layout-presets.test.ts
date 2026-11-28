import { describe, expect, it } from "vitest";
import {
  BUILD_QUICK_TOGGLE_LABELS,
  BUILD_QUICK_TOGGLE_TABS,
  DISCOVER_RAIL_SECTIONS,
  FIXED_SHELL_REGIONS,
  LocalDiscoverRail,
  LocalPlanPreviewCenter,
  PLAN_CENTER_SURFACE,
  PLAN_RAIL_SECTIONS,
  PhaseLayoutPresetManager,
  PhasePreferenceMemory,
  SHIP_CENTER_SURFACE,
  SHIP_INSPECTOR_PANELS,
  SHIP_RAIL_SECTIONS,
  type PhaseEnvironment,
} from "../../src/presets/index.js";

function env(overrides: Partial<PhaseEnvironment> = {}): PhaseEnvironment {
  return {
    projectId: "kitchen-app",
    prefersReducedMotion: false,
    governorLevel: "green",
    selection: null,
    ...overrides,
  };
}

describe("PhaseLayoutPresetManager", () => {
  it("opens Discover on a wide chat rail and the architecture canvas", () => {
    const manager = new PhaseLayoutPresetManager({
      ports: {
        discover: new LocalDiscoverRail("Discover", 4),
        plan: new LocalPlanPreviewCenter(),
      },
    });
    const preset = manager.apply("discover", env());

    expect(preset.llmCalls).toBe(0);
    expect(preset.fixedRegions).toEqual(FIXED_SHELL_REGIONS);
    expect(preset.leftRail.presentation).toBe("expanded");
    expect(preset.leftRail.wide).toBe(true);
    expect(preset.leftRail.chat).toBe("open");
    expect(preset.leftRail.sections).toEqual(DISCOVER_RAIL_SECTIONS);
    expect(preset.leftRail.stageChip).toBe("Discover");
    expect(preset.leftRail.honestReadinessCount).toBe(4);
    expect(preset.center.primaryTab).toBe("architecture-canvas");
    expect(preset.center.focusedTabs).toEqual(["architecture-canvas"]);
    expect(preset.center.planSurface).toBeNull();
    expect(preset.inspector.collapsed).toBe(true);
    expect(preset.inspector.opensOn).toBe("box");
    expect(preset.inspector.selectedId).toBeNull();
    expect(preset.userOverridesApplied).toBe(false);
  });

  it("keeps the Discover inspector collapsed until a box is clicked", () => {
    const manager = new PhaseLayoutPresetManager();
    const closed = manager.apply("discover", env());
    const opened = manager.apply(
      "discover",
      env({ selection: { kind: "box", id: "orders" } }),
    );

    expect(closed.inspector.collapsed).toBe(true);
    expect(opened.inspector.collapsed).toBe(false);
    expect(opened.inspector.selectedId).toBe("orders");
    expect(opened.inspector.transition).toBe("smooth");
  });

  it("focuses Plan on the preview, spec tree, and start build button", () => {
    const manager = new PhaseLayoutPresetManager();
    const preset = manager.apply("plan", env());
    const onTask = manager.apply("plan", env({ selection: { kind: "task", id: "T-1" } }));
    const onFeature = manager.apply("plan", env({ selection: { kind: "feature", id: "F-Orders" } }));

    expect(preset.leftRail.presentation).toBe("compact");
    expect(preset.leftRail.wide).toBe(false);
    expect(preset.leftRail.sections).toEqual(PLAN_RAIL_SECTIONS);
    expect(preset.leftRail.chat).toBe("open");
    expect(preset.center.primaryTab).toBe("plan-preview");
    expect(preset.center.focusedTabs).toEqual(["plan-preview", "spec-tree"]);
    expect(preset.center.planSurface).toEqual(PLAN_CENTER_SURFACE);
    expect(preset.center.planSurface?.startBuild).toEqual({ label: "Start build", prominent: true });
    expect(preset.center.planSurface?.crewPresetSelector).toBe("Crew Preset");
    expect(preset.center.planSurface?.chosenForYouLedger).toBe("Chosen for you");
    expect(preset.center.planSurface?.projectedWaves).toBe("Projected Waves 2+");
    expect(preset.inspector.collapsed).toBe(true);
    expect(onTask.inspector.collapsed).toBe(false);
    expect(onTask.inspector.selectedId).toBe("T-1");
    expect(onTask.inspector.opensOn).toBe("task-or-feature");
    expect(onFeature.inspector.selectedId).toBe("F-Orders");
    expect(preset.llmCalls).toBe(0);
  });

  it("defaults Build to Office with inbox, chat, and quick toggles", () => {
    const manager = new PhaseLayoutPresetManager();
    const preset = manager.apply("build", env({ governorLevel: "yellow" }));
    const worker = manager.apply("build", env({ selection: { kind: "worker", id: "A0014" } }));

    expect(preset.leftRail.sections).toEqual(["calm-inbox", "chat"]);
    expect(preset.leftRail.chat).toBe("collapsed-recent");
    expect(preset.center.primaryTab).toBe("office");
    expect(preset.center.officePresentation).toBe("animated");
    expect(preset.center.fallbackReasons).toEqual([]);
    expect(preset.center.quickToggleTabs).toEqual(BUILD_QUICK_TOGGLE_TABS);
    expect(preset.center.quickToggleLabels).toEqual(BUILD_QUICK_TOGGLE_LABELS);
    expect(preset.inspector.collapsed).toBe(true);
    expect(worker.inspector.collapsed).toBe(false);
    expect(worker.inspector.selectedId).toBe("A0014");
    expect(worker.inspector.opensOn).toBe("worker");
    expect(worker.inspector.transition).toBe("smooth");
  });

  it("falls back to Board on first build when motion is reduced or the governor is orange or red", () => {
    const manager = new PhaseLayoutPresetManager();

    const reduced = manager.apply("build", env({ prefersReducedMotion: true }));
    const orange = manager.apply("build", env({ governorLevel: "orange" }));
    const red = manager.apply("build", env({ governorLevel: "red" }));
    const both = manager.apply(
      "build",
      env({ prefersReducedMotion: true, governorLevel: "orange" }),
    );

    expect(reduced.center.primaryTab).toBe("board");
    expect(reduced.center.officePresentation).toBeNull();
    expect(reduced.center.fallbackReasons).toEqual(["reduced-motion"]);
    expect(reduced.inspector.transition).toBe("instant");
    expect(orange.center.primaryTab).toBe("board");
    expect(orange.center.fallbackReasons).toEqual(["governor-pressure"]);
    expect(red.center.fallbackReasons).toEqual(["governor-pressure"]);
    expect(both.center.fallbackReasons).toEqual(["reduced-motion", "governor-pressure"]);
    expect(reduced.center.quickToggleTabs).toEqual(BUILD_QUICK_TOGGLE_TABS);
  });

  it("uses a static seated Office when the user prefers Office under reduced motion", () => {
    const memory = new PhasePreferenceMemory();
    const manager = new PhaseLayoutPresetManager({ memory });
    manager.setBuildTab("kitchen-app", "office");

    const preset = manager.apply(
      "build",
      env({ prefersReducedMotion: true, governorLevel: "red" }),
    );

    expect(preset.center.primaryTab).toBe("office");
    expect(preset.center.officePresentation).toBe("static-seated");
    expect(preset.center.fallbackReasons).toEqual([]);
    expect(preset.userOverridesApplied).toBe(true);
  });

  it("does not store an automatic Board fallback as the user's preference", () => {
    const memory = new PhasePreferenceMemory();
    const manager = new PhaseLayoutPresetManager({ memory });
    const fallback = manager.apply("build", env({ prefersReducedMotion: true }));
    const relaxed = manager.apply("build", env({ prefersReducedMotion: false, governorLevel: "green" }));

    expect(fallback.center.primaryTab).toBe("board");
    expect(memory.preferredBuildTab("kitchen-app")).toBeNull();
    expect(relaxed.center.primaryTab).toBe("office");
    expect(relaxed.center.officePresentation).toBe("animated");
  });

  it("remembers an explicit Board preference across sessions", () => {
    const memory = new PhasePreferenceMemory();
    const manager = new PhaseLayoutPresetManager({ memory });
    manager.setBuildTab("kitchen-app", "board");
    const restored = new PhaseLayoutPresetManager({
      memory: PhasePreferenceMemory.restore(memory.serialize()),
    });

    expect(restored.apply("build", env()).center.primaryTab).toBe("board");
    expect(
      restored.apply("build", env({ prefersReducedMotion: true })).center.primaryTab,
    ).toBe("board");
    expect(restored.apply("build", env()).center.fallbackReasons).toEqual([]);
  });

  it("keeps per-phase overrides from leaking into another phase", () => {
    const manager = new PhaseLayoutPresetManager();
    manager.customize("kitchen-app", "discover", { inspectorCollapsed: false });
    manager.customize("kitchen-app", "build", { leftRailPresentation: "compact" });
    manager.customize("kitchen-app", "plan", { centerTab: "spec-tree" });
    manager.customize("kitchen-app", "build", { centerTab: "live-preview" });

    const discover = manager.apply("discover", env());
    const plan = manager.apply("plan", env());
    const build = manager.apply("build", env());
    const ship = manager.apply("ship", env());

    expect(discover.inspector.collapsed).toBe(false);
    expect(discover.leftRail.presentation).toBe("expanded");
    expect(plan.inspector.collapsed).toBe(true);
    expect(plan.center.primaryTab).toBe("spec-tree");
    expect(plan.center.focusedTabs).toEqual(["spec-tree", "plan-preview"]);
    expect(plan.leftRail.presentation).toBe("compact");
    expect(build.leftRail.presentation).toBe("compact");
    expect(build.center.primaryTab).toBe("live-preview");
    expect(build.center.quickToggleTabs).toEqual(BUILD_QUICK_TOGGLE_TABS);
    expect(ship.leftRail.presentation).toBe("expanded");
    expect(ship.center.primaryTab).toBe("landing-summary");
  });

  it("focuses Ship on the checklist, landing summary, and diff receipts", () => {
    const manager = new PhaseLayoutPresetManager();
    const preset = manager.apply("ship", env());
    const run = manager.apply("ship", env({ selection: { kind: "run", id: "deploy-4" } }));

    expect(preset.fixedRegions).toEqual(["top-bar", "composer"]);
    expect(preset.leftRail.sections).toEqual(SHIP_RAIL_SECTIONS);
    expect(preset.leftRail.chat).toBe("available");
    expect(preset.center.focusedTabs).toEqual(["landing-summary", "pr-ci-loop", "deploy-pipeline"]);
    expect(preset.center.shipSurface).toEqual(SHIP_CENTER_SURFACE);
    expect(preset.inspector.panels).toEqual(SHIP_INSPECTOR_PANELS);
    expect(preset.inspector.collapsed).toBe(true);
    expect(run.inspector.collapsed).toBe(false);
    expect(run.inspector.selectedId).toBe("deploy-4");
    expect(run.inspector.panels).toEqual(["diff", "ci-logs", "effect-receipts"]);
    expect(preset.llmCalls).toBe(0);
  });
});
