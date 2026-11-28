import type { AnimationDirectorPort, MediaQueryPort, PhaseLayoutPresetPort } from "./types.js";

export interface OfficeReducedMotionSnapshot {
  readonly osReducedMotion: boolean;
  readonly userToggle: boolean;
  readonly active: boolean;
  readonly staticSeatedMode: boolean;
  readonly suggestedDefaultTab: "office" | "board";
}

/**
 * Respects OS `prefers-reduced-motion: reduce` and the in-app Static Office toggle.
 * When active, all continuous character motion stops and workers render seated at desks.
 */
export class OfficeReducedMotionAdapter {
  private userToggle = false;

  constructor(
    private readonly media: MediaQueryPort,
    private readonly director: AnimationDirectorPort,
    private readonly phasePreset: PhaseLayoutPresetPort,
  ) {}

  setUserToggle(enabled: boolean): OfficeReducedMotionSnapshot {
    this.userToggle = enabled;
    return this.apply();
  }

  observeOsPreference(): OfficeReducedMotionSnapshot {
    return this.apply();
  }

  snapshot(): OfficeReducedMotionSnapshot {
    return this.read();
  }

  private apply(): OfficeReducedMotionSnapshot {
    const snap = this.read();
    this.director.setMotionEnabled(!snap.active);
    if (snap.active) {
      this.director.seatAllAtDesks();
    }
    return snap;
  }

  private read(): OfficeReducedMotionSnapshot {
    const osReducedMotion = this.media.prefersReducedMotion();
    const active = osReducedMotion || this.userToggle;
    const buildDefault = this.phasePreset.buildPhaseDefaultTab;
    const suggestedDefaultTab = active ? "board" : buildDefault;
    return {
      osReducedMotion,
      userToggle: this.userToggle,
      active,
      staticSeatedMode: active,
      suggestedDefaultTab,
    };
  }
}