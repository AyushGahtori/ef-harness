import {
  NonDisruptivePhaseSwitchBanner,
  type BannerAnnounceResult,
} from "./non-disruptive-phase-switch-banner.js";
import { PhaseLayoutPresetManager } from "./phase-layout-preset-manager.js";
import type {
  CenterTab,
  LifecyclePhase,
  PhaseEnvironment,
  PhaseTransition,
  ShellLayoutContextPort,
  UserActivity,
} from "./types.js";

export interface WorkspaceSnapshot {
  readonly phase: LifecyclePhase;
  readonly activeTab: CenterTab;
  readonly composerText: string;
  readonly composerFocused: boolean;
  readonly inspecting: boolean;
  readonly inspectedId: string | null;
}

export interface PhaseWorkspaceOptions {
  readonly shell: ShellLayoutContextPort;
  readonly environment: () => PhaseEnvironment;
  readonly phase: LifecyclePhase;
  readonly presets?: PhaseLayoutPresetManager;
  readonly banner?: NonDisruptivePhaseSwitchBanner;
}

/**
 * Owns the composer and the current tab so a backend phase change can be
 * proved not to interrupt typing or inspection. The layout changes only
 * through an explicit switch.
 */
export class PhaseWorkspaceController {
  private readonly banner: NonDisruptivePhaseSwitchBanner;
  private composerText = "";
  private composerFocused = false;
  private inspecting = false;
  private inspectedId: string | null = null;
  private phase: LifecyclePhase;
  private activeTab: CenterTab;

  private constructor(
    private readonly presets: PhaseLayoutPresetManager,
    private readonly shell: ShellLayoutContextPort,
    private readonly environment: () => PhaseEnvironment,
    banner: NonDisruptivePhaseSwitchBanner,
    phase: LifecyclePhase,
  ) {
    this.banner = banner;
    const initial = this.presets.apply(phase, environment());
    this.phase = initial.phase;
    this.activeTab = initial.center.primaryTab;
    this.shell.applyPreset(initial, "initial");
  }

  static open(options: PhaseWorkspaceOptions): PhaseWorkspaceController {
    return new PhaseWorkspaceController(
      options.presets ?? new PhaseLayoutPresetManager(),
      options.shell,
      options.environment,
      options.banner ?? new NonDisruptivePhaseSwitchBanner(),
      options.phase,
    );
  }

  focusComposer(): void {
    this.composerFocused = true;
  }

  blurComposer(): void {
    this.composerFocused = false;
  }

  inspect(id: string): void {
    this.inspecting = true;
    this.inspectedId = id;
  }

  stopInspecting(): void {
    this.inspecting = false;
    this.inspectedId = null;
  }

  type(text: string): void {
    this.composerFocused = true;
    this.composerText += text;
  }

  snapshot(): WorkspaceSnapshot {
    return {
      phase: this.phase,
      activeTab: this.activeTab,
      composerText: this.composerText,
      composerFocused: this.composerFocused,
      inspecting: this.inspecting,
      inspectedId: this.inspectedId,
    };
  }

  bannerView() {
    return this.banner.view();
  }

  backendTransition(transition: PhaseTransition): BannerAnnounceResult {
    const before = this.snapshot();
    const result = this.banner.announce(transition, this.activity());
    const after = this.snapshot();
    if (!sameWorkspace(before, after)) {
      throw new Error("Phase banner changed the active tab or interrupted the composer");
    }
    return result;
  }

  acceptBanner(): void {
    const transition = this.banner.accept();
    if (!transition) return;
    this.applyTransition(transition);
  }

  stay(): WorkspaceSnapshot {
    const before = this.snapshot();
    this.banner.stay();
    const after = this.snapshot();
    if (
      after.phase !== before.phase ||
      after.activeTab !== before.activeTab ||
      after.composerText !== before.composerText
    ) {
      throw new Error("Stay here changed the workspace");
    }
    return after;
  }

  pressKey(key: string): void {
    const result = this.banner.handleKey(key, this.activity());
    if (result.accepted && result.transition) {
      this.applyTransition(result.transition);
      return;
    }
    if (!result.consumed && this.composerFocused && key.length === 1) {
      this.composerText += key;
    }
  }

  private applyTransition(transition: PhaseTransition): void {
    const preset = this.presets.apply(transition.to, this.environment());
    this.phase = preset.phase;
    this.activeTab = preset.center.primaryTab;
    this.shell.applyPreset(preset, "user-switch");
  }

  private activity(): UserActivity {
    return {
      composerFocused: this.composerFocused,
      typing: this.composerFocused,
      inspecting: this.inspecting,
      activeTab: this.activeTab,
      composerText: this.composerText,
    };
  }
}

function sameWorkspace(before: WorkspaceSnapshot, after: WorkspaceSnapshot): boolean {
  return (
    after.phase === before.phase &&
    after.activeTab === before.activeTab &&
    after.composerText === before.composerText &&
    after.composerFocused === before.composerFocused &&
    after.inspecting === before.inspecting &&
    after.inspectedId === before.inspectedId
  );
}
