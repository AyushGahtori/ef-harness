import {
  REENTRY_AWAITING_RESUME,
  type BlockedActivity,
  type GateOpenInput,
  type GatePhase,
  type ResumeClick,
} from "./types.js";

const BLOCKED: readonly BlockedActivity[] = ["start_worker", "edit_file", "spend_tokens", "mutate_git"];

export class ReentryBlockedError extends Error {
  readonly activity: BlockedActivity;
  readonly phase: GatePhase;

  constructor(activity: BlockedActivity, phase: GatePhase) {
    super(`No-run-until-resume blocked ${activity} during ${phase}`);
    this.name = "ReentryBlockedError";
    this.activity = activity;
    this.phase = phase;
  }
}

/**
 * Holds a reopened project in REENTRY_AWAITING_RESUME until reconciliation finishes
 * and the developer explicitly chooses Resume. Review keeps workers stopped.
 * Stay Paused never dispatches.
 */
export class NoRunUntilResumeGate {
  private current: GatePhase = "OPEN";
  private reconciliationFinished = false;
  private resumeClearance = false;

  get phase(): GatePhase {
    return this.current;
  }

  open(input: GateOpenInput): GatePhase {
    this.reconciliationFinished = false;
    this.resumeClearance = false;
    if (input.untouchedNewIdleProject && input.reopen === "first_open" && !input.forceHold) {
      this.current = "OPEN";
      this.reconciliationFinished = true;
      this.resumeClearance = true;
      return this.current;
    }
    if (this.mustHold(input)) {
      this.current = REENTRY_AWAITING_RESUME;
      return this.current;
    }
    this.current = "OPEN";
    this.reconciliationFinished = true;
    this.resumeClearance = true;
    return this.current;
  }

  markReconciliationFinished(): void {
    this.reconciliationFinished = true;
  }

  grantResumeClearance(): void {
    this.resumeClearance = true;
  }

  tryActivity(activity: BlockedActivity): {
    readonly allowed: boolean;
    readonly phase: GatePhase;
    readonly activity: BlockedActivity;
  } {
    const allowed = this.current === "OPEN" || this.current === "RESUMED";
    return { allowed, phase: this.current, activity };
  }

  assertCan(activity: BlockedActivity): void {
    const decision = this.tryActivity(activity);
    if (!decision.allowed) {
      throw new ReentryBlockedError(activity, decision.phase);
    }
  }

  blockedActivities(): readonly BlockedActivity[] {
    if (this.current === "OPEN" || this.current === "RESUMED") return [];
    return BLOCKED;
  }

  click(action: ResumeClick): GatePhase {
    if (action === "Stay Paused") {
      this.current = "STAY_PAUSED";
      return this.current;
    }
    if (this.current === "OPEN") return this.current;
    if (!this.reconciliationFinished || !this.resumeClearance) return this.current;
    if (action === "Review changes first" || action === "Review Drift First") {
      this.current = "REVIEWING_DRIFT";
      return this.current;
    }
    this.current = "RESUMED";
    return this.current;
  }

  private mustHold(input: GateOpenInput): boolean {
    if (input.untouchedNewIdleProject) return false;
    if (input.forceHold) return true;
    if (input.reopen === "wake") {
      const sleptLong = (input.sleepMinutes ?? 0) > 30;
      return sleptLong || input.repoChanged || input.networkChanged || input.offline;
    }
    return true;
  }
}

export function createSpendLedger(): { tokens: number; cents: number; calls: string[] } {
  return { tokens: 0, cents: 0, calls: [] };
}
