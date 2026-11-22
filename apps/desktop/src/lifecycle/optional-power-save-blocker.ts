import { LOW_BATTERY_PERCENT, PREVENT_APP_SUSPENSION, type ExecutionState } from "./types.js";

export interface PowerSaveBlockerLike {
  start(type: "prevent-app-suspension"): number;
  stop(id: number): void;
  isStarted(id: number): boolean;
}

export const PREVENT_SLEEP_SETTING_LABEL = "Prevent sleep during active build";

export class OptionalPowerSaveBlocker {
  private optedIn = false;
  private blockerId: number | null = null;
  private releaseReason = "";

  constructor(private readonly blocker: PowerSaveBlockerLike) {}

  get settingLabel(): string {
    return PREVENT_SLEEP_SETTING_LABEL;
  }

  isOptedIn(): boolean {
    return this.optedIn;
  }

  isActive(): boolean {
    return this.blockerId !== null && this.blocker.isStarted(this.blockerId);
  }

  lastReleaseReason(): string {
    return this.releaseReason;
  }

  setOptIn(enabled: boolean): void {
    this.optedIn = enabled;
    if (!enabled) this.release("opt-out");
  }

  sync(input: { readonly state: ExecutionState; readonly batteryPercent: number | null }): void {
    const lowBattery = input.batteryPercent !== null && input.batteryPercent < LOW_BATTERY_PERCENT;
    const shouldHold = this.optedIn && input.state === "BUILDING" && !lowBattery;
    if (shouldHold) {
      if (this.blockerId === null || !this.blocker.isStarted(this.blockerId)) {
        this.blockerId = this.blocker.start(PREVENT_APP_SUSPENSION);
      }
      return;
    }
    if (lowBattery && this.optedIn) {
      this.release("low-battery");
      return;
    }
    this.release(`state:${input.state}`);
  }

  private release(reason: string): void {
    if (this.blockerId === null) return;
    const id = this.blockerId;
    this.blocker.stop(id);
    this.blockerId = null;
    this.releaseReason = reason;
  }
}
