import {
  INTERRUPTION_BUDGET_PER_HOUR,
  INTERRUPTION_WINDOW_MS,
  SNOOZE_MS,
} from "./types.js";

/**
 * Focus Mode and the hourly interruption budget.
 * Focus Mode suppresses every OS toast and holds routine batches.
 * Critical P0 cards stay visible in the in-app badge.
 */
export class FocusModeAndInterruptionBudget {
  private focusOn = false;
  private snoozedUntil: number | null = null;
  private releaseTimes: number[] = [];
  private soundOn = false;
  private criticalOsToasts = false;

  get focusMode(): boolean {
    return this.focusOn;
  }

  get soundEnabled(): boolean {
    return this.soundOn;
  }

  get criticalAlertsAllowed(): boolean {
    return this.criticalOsToasts;
  }

  setCriticalAlertsAllowed(allowed: boolean): void {
    this.criticalOsToasts = allowed;
  }

  setSoundEnabled(enabled: boolean): void {
    this.soundOn = enabled;
  }

  toggleFocus(): boolean {
    this.focusOn = !this.focusOn;
    return this.focusOn;
  }

  setFocus(on: boolean): void {
    this.focusOn = on;
  }

  applyShortcut(input: { readonly key: string; readonly ctrl?: boolean }): boolean {
    const key = input.key.length === 1 ? input.key.toLowerCase() : input.key;
    if (input.ctrl === true && key === ".") {
      this.toggleFocus();
      return true;
    }
    return false;
  }

  holdRoutine(now: number): boolean {
    return this.focusOn || (this.snoozedUntil !== null && now < this.snoozedUntil);
  }

  blockRoutineWindow(now: number): boolean {
    return this.releasesInWindow(now) >= INTERRUPTION_BUDGET_PER_HOUR;
  }

  recordRoutineWindow(now: number): void {
    this.releaseTimes.push(now);
  }

  snooze(now: number): void {
    this.snoozedUntil = now + SNOOZE_MS;
  }

  snoozed(now: number): boolean {
    return this.snoozedUntil !== null && now < this.snoozedUntil;
  }

  /**
   * Milliseconds until a held routine batch may release.
   * Focus Mode waits for the developer to turn it off, so this returns null.
   */
  msUntilRoutineAllowed(now: number): number | null {
    if (this.focusOn) return null;
    if (this.snoozedUntil !== null && now < this.snoozedUntil) return this.snoozedUntil - now;
    const active = this.releaseTimes.filter((stamp) => now - stamp < INTERRUPTION_WINDOW_MS);
    if (active.length < INTERRUPTION_BUDGET_PER_HOUR) return null;
    const oldest = active.reduce((min, stamp) => Math.min(min, stamp), now);
    return Math.max(0, INTERRUPTION_WINDOW_MS - (now - oldest));
  }

  allowOsToast(): boolean {
    if (!this.focusOn) return true;
    return this.criticalOsToasts;
  }

  releasesInWindow(now: number): number {
    this.releaseTimes = this.releaseTimes.filter((stamp) => now - stamp < INTERRUPTION_WINDOW_MS);
    return this.releaseTimes.length;
  }
}
