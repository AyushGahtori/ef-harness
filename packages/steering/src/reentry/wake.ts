import { ColdOpenReconciler } from "./cold-open-reconciler.js";
import { classifyWake, formatDuration, parseTime, type WakeKind } from "./time.js";
import type { AttemptRecord, ColdOpenInput, ColdOpenReport } from "./types.js";

export interface WakeInput {
  readonly suspendedAt: string;
  readonly resumedAt: string;
  readonly repoChanged: boolean;
  readonly networkChanged: boolean;
  readonly offline: boolean;
  readonly buildWasInProgress: boolean;
}

export interface WakeReconciliation {
  readonly sleepMs: number;
  readonly fastPath: boolean;
  readonly holdWelcomeBack: boolean;
  readonly kind: WakeKind;
  readonly inFlightOutcome: "unknown" | "none";
  readonly resumeFromCheckpoint: boolean;
  readonly dispatchedWorkers: false;
  readonly tokensSpent: number;
  readonly centsSpent: number;
  readonly fullReport: ColdOpenReport | null;
  readonly note: string;
  readonly deadAttemptIds: readonly string[];
}

/**
 * Lightweight entry for Task 131 powerMonitor resume.
 * Sleep under 10 minutes stays on the fast path. Sleep over 30 minutes,
 * or any repo or network change, holds at the welcome-back screen.
 */
export function reconcileAfterWake(
  wake: WakeInput,
  coldOpen: ColdOpenInput,
  reconciler: ColdOpenReconciler,
): WakeReconciliation {
  const suspended = parseTime(wake.suspendedAt);
  const resumed = parseTime(wake.resumedAt);
  const sleepMs = suspended === null || resumed === null ? Number.POSITIVE_INFINITY : Math.max(0, resumed - suspended);
  const classification = classifyWake(sleepMs, {
    repoChanged: wake.repoChanged,
    networkChanged: wake.networkChanged,
    offline: wake.offline,
  });
  const working = coldOpen.snapshot.attempts.filter((attempt) => attempt.status === "WORKING");
  const inFlight = wake.buildWasInProgress || working.length > 0;
  if (!classification.holdWelcomeBack) {
    coldOpen.gate?.open({
      reopen: "wake",
      buildWasInProgress: wake.buildWasInProgress,
      sleepMinutes: Number.isFinite(sleepMs) ? sleepMs / (60 * 1000) : 0,
      repoChanged: false,
      networkChanged: false,
      offline: false,
      forceHold: false,
      untouchedNewIdleProject: false,
    });
    const deadAttemptIds = classification.fastPath ? [] : deadAttempts(working);
    return {
      sleepMs,
      fastPath: classification.fastPath,
      holdWelcomeBack: false,
      kind: classification.kind,
      inFlightOutcome: inFlight ? "unknown" : "none",
      resumeFromCheckpoint: inFlight,
      dispatchedWorkers: false,
      tokensSpent: 0,
      centsSpent: 0,
      fullReport: null,
      note: classification.fastPath
        ? `Woke after ${formatDuration(sleepMs)} — fast path, in-flight calls stay unknown until the checkpoint resumes`
        : `Slept ${formatDuration(sleepMs)} (30 minutes or less) — resuming without a full welcome-back`,
      deadAttemptIds,
    };
  }
  const report = reconciler.reconcile({
    ...coldOpen,
    nowIso: Number.isFinite(resumed ?? Number.NaN) && resumed !== null ? wake.resumedAt : coldOpen.nowIso,
    reopen: "wake",
    buildWasInProgress: wake.buildWasInProgress,
    sleepMinutes: Number.isFinite(sleepMs) ? sleepMs / (60 * 1000) : 31,
    offline: wake.offline,
    repoChanged: wake.repoChanged,
    networkChanged: wake.networkChanged,
    forceHold: true,
  });
  return {
    sleepMs,
    fastPath: false,
    holdWelcomeBack: true,
    kind: classification.kind,
    inFlightOutcome: inFlight ? "unknown" : "none",
    resumeFromCheckpoint: inFlight,
    dispatchedWorkers: false,
    tokensSpent: report.tokensSpent,
    centsSpent: report.centsSpent,
    fullReport: report,
    note: report.wakeNote ?? `Paused while laptop slept (${formatDuration(sleepMs)}) — review before resume`,
    deadAttemptIds: report.orphans.map((attempt) => attempt.id),
  };
}

function deadAttempts(working: readonly AttemptRecord[]): readonly string[] {
  return working.filter((attempt) => attempt.pid === null || attempt.pid <= 0).map((attempt) => attempt.id);
}
