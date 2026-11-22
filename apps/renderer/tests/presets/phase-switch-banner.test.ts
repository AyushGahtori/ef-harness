import { describe, expect, it } from "vitest";
import {
  LocalShellLayoutContext,
  NonDisruptivePhaseSwitchBanner,
  PhaseLayoutPresetManager,
  PhaseWorkspaceController,
  type LifecyclePhase,
  type PhaseEnvironment,
  type PhaseTransition,
} from "../../src/presets/index.js";

function environment(overrides: Partial<PhaseEnvironment> = {}): PhaseEnvironment {
  return {
    projectId: "kitchen-app",
    prefersReducedMotion: false,
    governorLevel: "green",
    selection: null,
    ...overrides,
  };
}

function workspace(phase: LifecyclePhase) {
  const shell = new LocalShellLayoutContext();
  const presets = new PhaseLayoutPresetManager();
  const banner = new NonDisruptivePhaseSwitchBanner();
  const current = environment();
  const controller = PhaseWorkspaceController.open({
    shell,
    presets,
    banner,
    phase,
    environment: () => current,
  });
  return { shell, banner, controller };
}

const planReady: PhaseTransition = {
  id: "discovery-done",
  from: "discover",
  to: "plan",
  reason: "discovery-ready-for-plan",
};

const shipReady: PhaseTransition = {
  id: "completion-wave",
  from: "build",
  to: "ship",
  reason: "completion-wave-ready-for-ship",
};

describe("NonDisruptivePhaseSwitchBanner", () => {
  it("offers Plan without leaving Discover or taking the composer", () => {
    const { shell, controller } = workspace("discover");
    controller.focusComposer();
    controller.type("what about receipts");
    const before = controller.snapshot();
    const announced = controller.backendTransition(planReady);
    const view = controller.bannerView();

    expect(announced.shown).toBe(true);
    expect(announced.focusStolen).toBe(false);
    expect(announced.activeTabChanged).toBe(false);
    expect(announced.llmCalls).toBe(0);
    expect(view?.blocking).toBe(false);
    expect(view?.placement).toBe("top-of-center");
    expect(view?.stayLabel).toBe("Stay here");
    expect(view?.message).toBe("Plan is ready to review → Switch to Plan");
    expect(view?.switchLabel).toBe("Switch to Plan");
    expect(controller.snapshot()).toEqual(before);
    expect(shell.applyCount).toBe(1);
    expect(shell.currentPhase()).toBe("discover");
    expect(shell.lastReason).toBe("initial");
  });

  it("keeps a Build diff and in-progress typing when Ship becomes ready", () => {
    const { shell, controller } = workspace("build");
    controller.inspect("diff:A0014");
    controller.focusComposer();
    controller.type("follow-up");
    const before = controller.snapshot();

    const announced = controller.backendTransition(shipReady);
    controller.type(" question");
    controller.pressKey("!");

    const after = controller.snapshot();
    expect(announced.banner?.message).toBe("Build complete — Ready to Ship → Switch to Ship");
    expect(after.phase).toBe("build");
    expect(after.activeTab).toBe(before.activeTab);
    expect(after.composerText).toBe("follow-up question!");
    expect(after.composerFocused).toBe(true);
    expect(after.inspecting).toBe(true);
    expect(after.inspectedId).toBe("diff:A0014");
    expect(shell.currentPhase()).toBe("build");
    expect(shell.applyCount).toBe(1);
    expect(controller.bannerView()?.focusStolen).toBe(false);
    expect(controller.bannerView()?.activeTabChanged).toBe(false);
  });

  it("does not treat Enter as Switch while the user is typing or inspecting", () => {
    const { controller } = workspace("build");
    controller.inspect("diff:A0014");
    controller.focusComposer();
    controller.type("follow-up");
    controller.backendTransition(shipReady);

    controller.pressKey("Enter");
    expect(controller.snapshot().phase).toBe("build");
    expect(controller.snapshot().composerText).toBe("follow-up");
    expect(controller.bannerView()?.message).toBe("Build complete — Ready to Ship → Switch to Ship");

    controller.blurComposer();
    controller.pressKey("Enter");
    expect(controller.snapshot().phase).toBe("build");
    expect(controller.bannerView()).not.toBeNull();
  });

  it("switches only after the banner is clicked", () => {
    const { shell, controller } = workspace("discover");
    controller.type("leave this draft");
    controller.backendTransition(planReady);

    controller.acceptBanner();

    expect(controller.snapshot().phase).toBe("plan");
    expect(controller.snapshot().activeTab).toBe("plan-preview");
    expect(controller.snapshot().composerText).toBe("leave this draft");
    expect(controller.bannerView()).toBeNull();
    expect(shell.applyCount).toBe(2);
    expect(shell.lastReason).toBe("user-switch");
    expect(shell.currentPhase()).toBe("plan");
    expect(shell.preset?.center.planSurface?.startBuild.label).toBe("Start build");
  });

  it("stays on the current tab when the user dismisses the banner", () => {
    const { shell, controller } = workspace("build");
    const tab = controller.snapshot().activeTab;
    controller.backendTransition(shipReady);

    controller.stay();

    expect(controller.bannerView()).toBeNull();
    expect(controller.snapshot().phase).toBe("build");
    expect(controller.snapshot().activeTab).toBe(tab);
    expect(shell.applyCount).toBe(1);
    expect(controller.backendTransition(shipReady).shown).toBe(false);

    const next: PhaseTransition = { ...shipReady, id: "completion-wave-2" };
    expect(controller.backendTransition(next).shown).toBe(true);
    expect(controller.snapshot().phase).toBe("build");
  });

  it("accepts Enter only when the user is not in the composer or inspector", () => {
    const { controller } = workspace("plan");
    controller.blurComposer();
    controller.stopInspecting();
    controller.backendTransition({
      id: "toward-build",
      from: "plan",
      to: "build",
      reason: "phase-changed",
    });

    expect(controller.bannerView()?.message).toBe("Switch to the Build layout?");
    controller.pressKey("Enter");
    expect(controller.snapshot().phase).toBe("build");
    expect(controller.snapshot().activeTab).toBe("office");
    expect(controller.bannerView()).toBeNull();
  });
});
