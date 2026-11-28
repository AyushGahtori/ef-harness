import {
  ALLOWANCE_CLUSTER_LABEL,
  allowanceActions,
  backoffActions,
  escalationActions,
  loopActions,
  STUCK_CLUSTER_LABEL,
  stuckActions,
} from "./actions.js";
import {
  allowanceLabel,
  loopLabel,
  rateLimitLabel,
  retryEscalationLabel,
  stuckLabel,
  waitingRunSlotLabel,
  DISPUTE_LABEL,
  exhaustedLabel,
} from "./format.js";
import { combineLoopReadings } from "./loop-patterns.js";
import type {
  HealthSignal,
  SuppressionReason,
  WorkerHealthDetection,
  WorkerHealthTelemetry,
} from "./types.js";
import { STUCK_THRESHOLD_MS } from "./types.js";

function seal(
  signal: Omit<HealthSignal, "flashing" | "modal" | "inline" | "stealsFocus">,
): HealthSignal {
  return {
    ...signal,
    flashing: false,
    modal: false,
    inline: true,
    stealsFocus: false,
  };
}

export function lastForwardProgressAt(worker: WorkerHealthTelemetry, nowMs: number): number {
  const marks = [
    worker.progress.lastFileEditAtMs,
    worker.progress.lastCompletedToolCallAtMs,
    worker.progress.lastTokenChunkAtMs,
  ].filter((value): value is number => value !== null);
  if (marks.length > 0) {
    return Math.max(...marks);
  }
  const anyStep =
    worker.progress.fileEdits +
      worker.progress.completedToolCalls +
      worker.progress.tokenChunks >
    0;
  if (anyStep) return nowMs;
  return worker.startedAtMs;
}

function collectSuppressions(worker: WorkerHealthTelemetry, nowMs: number): SuppressionReason[] {
  const reasons: SuppressionReason[] = [];
  if (worker.poolState === "waiting_run_slot") reasons.push("pool2_run_slot");
  if (worker.inbox?.active) reasons.push("inbox_reply");
  if (worker.hold?.active) reasons.push("task_hold");
  const backoffOpen =
    worker.backoff !== null && worker.backoff.active && worker.backoff.retryAtMs >= nowMs;
  const pacingBackoffWithoutClock =
    worker.pacingState === "backoff_429" && (worker.backoff === null || backoffOpen);
  if (backoffOpen || pacingBackoffWithoutClock) {
    reasons.push("rate_limit_backoff");
  }
  const allowanceOpen =
    worker.allowance !== null && worker.allowance.active && worker.allowance.resetAtMs > nowMs;
  const pacingWindowWithoutClock =
    worker.pacingState === "window_exhausted" && (worker.allowance === null || allowanceOpen);
  if (allowanceOpen || pacingWindowWithoutClock) {
    reasons.push("allowance_reset");
  }
  return reasons;
}

export function detectWorkerHealth(
  worker: WorkerHealthTelemetry,
  nowMs: number,
): WorkerHealthDetection {
  const suppressions = worker.active ? collectSuppressions(worker, nowMs) : [];
  const signals: HealthSignal[] = [];

  if (worker.active && worker.poolState === "waiting_run_slot") {
    const since = worker.poolWaitSinceMs ?? worker.startedAtMs;
    signals.push(
      seal({
        kind: "waiting_run_slot",
        variant: "slot",
        alarm: false,
        tone: "violet",
        label: waitingRunSlotLabel(nowMs - since),
        clusterLabel: null,
        taskId: worker.taskId,
        connectionId: worker.connectionId,
        attemptId: worker.attemptId,
        detail: null,
        actions: [],
      }),
    );
  }

  if (worker.active) {
    const loop = combineLoopReadings(worker.loop, worker.steps);
    if (loop.count >= 3) {
      signals.push(
        seal({
          kind: "loop_detected",
          variant: "loop",
          alarm: true,
          tone: "red",
          label: loopLabel(loop.count),
          clusterLabel: null,
          taskId: worker.taskId,
          connectionId: worker.connectionId,
          attemptId: worker.attemptId,
          detail: loop.errorSnippet,
          actions: loopActions(),
        }),
      );
    }

    const backoff = worker.backoff;
    if (backoff && backoff.active && backoff.retryAtMs >= nowMs) {
      signals.push(
        seal({
          kind: "rate_limited_backoff",
          variant: "backoff",
          alarm: true,
          tone: "amber",
          label: rateLimitLabel(backoff.retryAtMs - nowMs),
          clusterLabel: null,
          taskId: worker.taskId,
          connectionId: worker.connectionId,
          attemptId: worker.attemptId,
          detail: null,
          actions: backoffActions(),
        }),
      );
    }

    const allowance = worker.allowance;
    if (allowance && allowance.active && allowance.resetAtMs > nowMs) {
      signals.push(
        seal({
          kind: "allowance_window_wait",
          variant: "allowance",
          alarm: true,
          tone: "violet",
          label: allowanceLabel(allowance.providerLabel, allowance.resetAtMs - nowMs),
          clusterLabel: ALLOWANCE_CLUSTER_LABEL,
          taskId: worker.taskId,
          connectionId: worker.connectionId,
          attemptId: worker.attemptId,
          detail: allowance.window,
          actions: allowanceActions(),
        }),
      );
    }

    if (worker.hint.retriesExhausted) {
      signals.push(
        seal({
          kind: "escalated_or_retrying",
          variant: "exhausted",
          alarm: true,
          tone: "red",
          label: exhaustedLabel(worker.hint.failedAttempts, worker.hint.attemptLimit),
          clusterLabel: null,
          taskId: worker.taskId,
          connectionId: worker.connectionId,
          attemptId: worker.attemptId,
          detail: null,
          actions: escalationActions(),
        }),
      );
    }
    if (worker.hint.disputeTest) {
      signals.push(
        seal({
          kind: "escalated_or_retrying",
          variant: "dispute",
          alarm: true,
          tone: "red",
          label: DISPUTE_LABEL,
          clusterLabel: null,
          taskId: worker.taskId,
          connectionId: worker.connectionId,
          attemptId: worker.attemptId,
          detail: null,
          actions: escalationActions(),
        }),
      );
    }
    if (worker.hint.hintLevel >= 2) {
      signals.push(
        seal({
          kind: "escalated_or_retrying",
          variant: "hint",
          alarm: true,
          tone: "red",
          label: retryEscalationLabel(
            worker.hint.hintLevel,
            worker.hint.attemptLimit,
            worker.hint.escalatedTo,
          ),
          clusterLabel: null,
          taskId: worker.taskId,
          connectionId: worker.connectionId,
          attemptId: worker.attemptId,
          detail: null,
          actions: escalationActions(),
        }),
      );
    }

    const elapsed = nowMs - lastForwardProgressAt(worker, nowMs);
    if (suppressions.length === 0 && elapsed >= STUCK_THRESHOLD_MS) {
      signals.push(
        seal({
          kind: "stuck_no_progress",
          variant: "clock",
          alarm: true,
          tone: "red",
          label: stuckLabel(elapsed),
          clusterLabel: STUCK_CLUSTER_LABEL,
          taskId: worker.taskId,
          connectionId: worker.connectionId,
          attemptId: worker.attemptId,
          detail: null,
          actions: stuckActions(),
        }),
      );
    }
  }

  return {
    taskId: worker.taskId,
    connectionId: worker.connectionId,
    attemptId: worker.attemptId,
    signals,
    suppressions,
    stuck: signals.some((signal) => signal.kind === "stuck_no_progress"),
  };
}
