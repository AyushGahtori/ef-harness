import { PAUSE_AFFORDANCE_MS, UNDO_WINDOW_MS } from "./constants.js";
import { PlanPreviewError } from "./errors.js";
import { formatUsd, formatWindowPercent } from "./money.js";
import type { AutoStartToast, BuildCockpitEntry, ConnectionKind, GraceAction, GraceStatus } from "./types.js";

let toastSequence = 0;

export function autoStartBanner(input: {
  readonly connection: ConnectionKind;
  readonly taskCount: number;
  readonly costMicroUsd: bigint;
  readonly windowPpm: number;
}): string {
  const cost =
    input.connection === "api"
      ? `~${formatUsd(input.costMicroUsd)}`
      : `~${formatWindowPercent(input.windowPpm)} of 5-hour allowance`;
  return `Auto-starting ${input.taskCount.toString()}-task fix (${cost}) — Pause / Review`;
}

export function createAutoStartToast(input: {
  readonly revisionId: string;
  readonly connection: ConnectionKind;
  readonly taskCount: number;
  readonly costMicroUsd: bigint;
  readonly windowPpm: number;
  readonly nowMs: number;
}): AutoStartToast {
  toastSequence += 1;
  const banner = autoStartBanner(input);
  const timeline: BuildCockpitEntry = {
    surface: "build-cockpit",
    kind: "auto_start",
    banner,
    revisionId: input.revisionId,
    taskCount: input.taskCount,
    costLabel: input.connection === "api" ? `~${formatUsd(input.costMicroUsd)}` : `~${formatWindowPercent(input.windowPpm)} of 5-hour allowance`,
    openedAtMs: input.nowMs,
    undoWindowMs: UNDO_WINDOW_MS,
    pauseAffordanceMs: PAUSE_AFFORDANCE_MS,
  };
  return {
    id: `auto-${input.revisionId}-${input.nowMs.toString()}-${toastSequence.toString()}`,
    banner,
    revisionId: input.revisionId,
    taskCount: input.taskCount,
    costLabel: timeline.costLabel,
    openedAtMs: input.nowMs,
    pauseUntilMs: input.nowMs + PAUSE_AFFORDANCE_MS,
    undoUntilMs: input.nowMs + UNDO_WINDOW_MS,
    undoWindowMs: UNDO_WINDOW_MS,
    pauseAffordanceMs: PAUSE_AFFORDANCE_MS,
    timeline,
  };
}

interface TrackedToast {
  readonly toast: AutoStartToast;
  status: GraceStatus;
}

export class AutoStartGraceWindow {
  private readonly tracked = new Map<string, TrackedToast>();
  private readonly cockpit: BuildCockpitEntry[] = [];

  admit(toast: AutoStartToast): AutoStartToast {
    if (this.tracked.has(toast.id)) {
      throw new PlanPreviewError("duplicate_toast", `Auto-start toast ${toast.id} is already open`);
    }
    this.tracked.set(toast.id, { toast, status: "pending" });
    this.cockpit.push(toast.timeline);
    return toast;
  }

  timeline(): readonly BuildCockpitEntry[] {
    return [...this.cockpit];
  }

  status(id: string): GraceStatus {
    return this.require(id).status;
  }

  pause(id: string, nowMs: number): GraceAction {
    const tracked = this.require(id);
    if (tracked.status !== "pending") {
      return action(false, tracked.status, "Auto-start is no longer waiting", false);
    }
    if (nowMs > tracked.toast.pauseUntilMs) {
      return action(false, tracked.status, "Pause affordance expired", false);
    }
    tracked.status = "paused";
    return action(true, "paused", "Paused", true);
  }

  undo(id: string, nowMs: number): GraceAction {
    const tracked = this.require(id);
    if (tracked.status === "started") {
      return action(false, tracked.status, "Auto-start already began", false);
    }
    if (nowMs > tracked.toast.undoUntilMs) {
      return action(false, tracked.status, "Undo window expired", false);
    }
    tracked.status = "cancelled";
    return action(true, "cancelled", "Auto-start cancelled", false);
  }

  review(id: string, nowMs: number): GraceAction {
    const tracked = this.require(id);
    if (tracked.status === "started" || tracked.status === "cancelled") {
      return action(false, tracked.status, "Review is closed", false);
    }
    if (nowMs > tracked.toast.undoUntilMs) {
      return action(false, tracked.status, "Undo window expired", false);
    }
    tracked.status = "reviewing";
    return action(true, "reviewing", "Opening Plan Preview", true);
  }

  settle(id: string, nowMs: number): GraceAction {
    const tracked = this.require(id);
    if (tracked.status === "paused" || tracked.status === "reviewing" || tracked.status === "cancelled") {
      return action(true, tracked.status, "Auto-start is held", tracked.status !== "cancelled");
    }
    if (tracked.status === "started") {
      return action(true, "started", "Auto-start already began", false);
    }
    if (nowMs <= tracked.toast.undoUntilMs) {
      return action(true, "pending", "Undo window is still open", false);
    }
    tracked.status = "started";
    return action(true, "started", "Auto-start began", false);
  }

  private require(id: string): TrackedToast {
    const tracked = this.tracked.get(id);
    if (!tracked) throw new PlanPreviewError("unknown_toast", `Unknown auto-start toast ${id}`);
    return tracked;
  }
}

function action(ok: boolean, status: GraceStatus, message: string, openPlanPreview: boolean): GraceAction {
  return { ok, status, message, openPlanPreview };
}
