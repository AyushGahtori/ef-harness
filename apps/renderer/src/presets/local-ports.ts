import {
  PLAN_CENTER_SURFACE,
  type AppliedPhasePreset,
  type CenterTab,
  type DiscoverRailPort,
  type LifecyclePhase,
  type PlanCenterSurface,
  type PlanPreviewPort,
  type PresetPorts,
  type ShellLayoutContextPort,
  type ShellLayoutSnapshot,
} from "./types.js";

/** Stand-in for the shell readiness chip until that sibling is wired. */
export class LocalDiscoverRail implements DiscoverRailPort {
  constructor(
    private readonly stage = "Discover",
    private readonly readiness = 0,
  ) {}

  stageChip(): string {
    return this.stage;
  }

  honestReadinessCount(): number {
    if (!Number.isInteger(this.readiness) || this.readiness < 0) {
      throw new Error("Honest readiness count must be a non-negative integer");
    }
    return this.readiness;
  }
}

/**
 * Structural Plan center slots. Task 108 `PlanPreviewBuilder` fills the ledger,
 * crew preset, and Wave ranges inside these slots at integration.
 */
export class LocalPlanPreviewCenter implements PlanPreviewPort {
  describeCenter(): PlanCenterSurface {
    return PLAN_CENTER_SURFACE;
  }
}

export function defaultPresetPorts(): PresetPorts {
  return {
    discover: new LocalDiscoverRail(),
    plan: new LocalPlanPreviewCenter(),
  };
}

/** In-memory stand-in for Task 122 `ShellLayoutContext`. */
export class LocalShellLayoutContext implements ShellLayoutContextPort {
  applyCount = 0;
  lastReason: "initial" | "user-switch" | null = null;
  preset: AppliedPhasePreset | null = null;

  applyPreset(preset: AppliedPhasePreset, reason: "initial" | "user-switch"): void {
    this.applyCount += 1;
    this.lastReason = reason;
    this.preset = preset;
  }

  currentPhase(): LifecyclePhase | null {
    return this.preset?.phase ?? null;
  }

  currentTab(): CenterTab | null {
    return this.preset?.center.primaryTab ?? null;
  }

  read(): ShellLayoutSnapshot {
    return { phase: this.currentPhase(), activeTab: this.currentTab() };
  }
}
