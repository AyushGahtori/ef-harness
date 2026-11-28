import {
  STATUS_LINE_LLM_CALLS,
  type BoardStatusEvent,
  type BoardTaskRecord,
  type FormattedStatusLine,
} from "./types.js";
import { truncateRepoPath } from "./path-truncation.js";
import { mapTaskToBoardLane } from "./map-task-to-board-lane.js";
import { holdBadge } from "./hold-badge.js";

function line(text: string, title = text): FormattedStatusLine {
  return { text, title, llmCalls: STATUS_LINE_LLM_CALLS };
}

export function formatRunningLine(
  command: string,
  runSlot: number,
  runSlotCapacity: number,
  elapsedSeconds: number,
): FormattedStatusLine {
  return line(`Running ${command} (run slot ${runSlot}/${runSlotCapacity} · ${elapsedSeconds}s)`);
}

export function formatWaitingForRunSlotLine(queuePosition: number, blocker: string): FormattedStatusLine {
  return line(`Waiting for run slot (#${queuePosition} in queue · ${blocker})`);
}

export function formatVerifyingLine(
  flow: string,
  retry: number | null,
  retryMax: number | null,
  hint: number | null,
): FormattedStatusLine {
  if (retry !== null && retry > 0 && retryMax !== null && hint !== null && hint > 0) {
    return line(`Verifying ${flow} (Retry ${retry}/${retryMax} · Hint ${hint})`);
  }
  return line(`Verifying ${flow}`);
}

export function formatMergeQueueLine(behindCount: number, behindLabel: string): FormattedStatusLine {
  return line(`Queued in merge queue (#${behindCount} behind ${behindLabel})`);
}

export function formatHeldLine(reason: string, quarantined: boolean): FormattedStatusLine {
  const suffix = quarantined ? " (verified diff quarantined)" : "";
  return line(`Held: ${reason}${suffix}`);
}

function formatEvent(event: BoardStatusEvent): FormattedStatusLine {
  switch (event.kind) {
    case "editing": {
      const path = truncateRepoPath(event.path);
      const suffix = `(step ${event.step} of ~${event.stepEstimate})`;
      return line(`Editing ${path.display} ${suffix}`, `Editing ${path.full} ${suffix}`);
    }
    case "running":
      return formatRunningLine(event.command, event.runSlot, event.runSlotCapacity, event.elapsedSeconds);
    case "waiting_for_run_slot":
      return formatWaitingForRunSlotLine(event.queuePosition, event.blocker);
    case "verifying":
      return formatVerifyingLine(event.flow, event.retry, event.retryMax, event.hint);
    case "merge_queue":
      return formatMergeQueueLine(event.behindCount, event.behindLabel);
    case "held":
      return formatHeldLine(event.reason, event.quarantined);
    case "queued_dependency":
      return line(`Waits for ${event.taskId} (${event.title})`);
    case "inbox_block": {
      if (event.blockedTaskIds.length === 0) return line(`Needs ${event.need}`);
      return line(`Needs ${event.need} · blocks ${event.blockedTaskIds.join(", ")}`);
    }
    case "checks":
      return line(`${event.passed} of ${event.total} checks`);
    case "integrating":
      return line(event.detail.length > 0 ? event.detail : "Integrating");
    case "accepted":
      return line(`Accepted ${event.acceptedAtLabel} · ${event.levelLabel} · ${event.spendLabel}`);
    case "attempt_checks":
      return line(
        `Running tests · ${event.passed} passed, ${event.failed} failed · attempt ${event.attempt}`,
      );
    case "throttled":
      return line(`Rate-limited · retry in ${event.retryInLabel}`);
  }
}

function derive(task: BoardTaskRecord): FormattedStatusLine {
  const lane = mapTaskToBoardLane(task);
  if (lane === "held") {
    const badge = holdBadge(task.holds);
    const base = badge?.text ?? "Held";
    const title = badge?.title ?? base;
    if (task.submissionPending && !base.includes("(verified diff quarantined)")) {
      return line(`${base} (verified diff quarantined)`, title);
    }
    return line(base, title);
  }
  if (lane === "waiting_on_you") {
    if (task.inboxNeed) {
      return formatEvent({
        kind: "inbox_block",
        need: task.inboxNeed,
        blockedTaskIds: task.inboxBlockedTaskIds,
      });
    }
    if (task.openInboxItemId) return line(`Waiting on you · inbox ${task.openInboxItemId}`);
    if (task.state === "EXHAUSTED") return line("Attempts exhausted");
    if (task.state === "HUMAN_OWNED") return line("Human owned");
    return line("Waiting on you");
  }
  if (lane === "integrating") {
    if (task.mergeBehindCount !== null && task.mergeBehindLabel) {
      return formatMergeQueueLine(task.mergeBehindCount, task.mergeBehindLabel);
    }
    if (task.activity === "feature_wiring") return line("Feature wiring");
    return line("Project merge queue");
  }
  if (lane === "verifying") {
    const flow =
      task.verifyFlow ??
      (task.reviewer === "reviewer@1" ? "reviewer@1" : null) ??
      (task.state === "STATIC_AUDIT" ? "static audit" : "clean verify");
    return formatVerifyingLine(flow, task.retry, task.retryMax, task.hint);
  }
  if (lane === "working") {
    if (
      task.poolPhase === "running_command" &&
      task.runningCommand !== null &&
      task.runSlot !== null &&
      task.runSlotCapacity !== null &&
      task.elapsedSeconds !== null
    ) {
      return formatRunningLine(task.runningCommand, task.runSlot, task.runSlotCapacity, task.elapsedSeconds);
    }
    if (task.poolPhase === "waiting_for_run_slot" && task.queuePosition !== null && task.queueBlocker) {
      return formatWaitingForRunSlotLine(task.queuePosition, task.queueBlocker);
    }
    if (task.poolPhase === "thinking") return line("Thinking");
    if (task.state === "ESCALATED") return line("Escalated");
    if (task.state === "LEASED") return line("Claimed");
    return line("Working");
  }
  if (lane === "done") {
    if (task.state === "CANCELLED") return line("Cancelled");
    if (task.state === "SUPERSEDED") return line("Superseded");
    if (task.state === "MERGED_TO_FEATURE") return line("Merged to harness/integration");
    if (task.acceptedLabel && task.spendLabel) {
      return formatEvent({
        kind: "accepted",
        acceptedAtLabel: task.acceptedLabel,
        levelLabel: task.level,
        spendLabel: task.spendLabel,
      });
    }
    return line("Accepted");
  }
  const dependency = task.blockedBy[0];
  if (dependency) return line(`Waits for ${dependency.taskId} (${dependency.title})`);
  if (task.state === "DRAFTED") return line("Drafted");
  if (task.state === "PARKED") return line("Parked");
  return line("Ready");
}

/** Code-written captions. `llmCalls` stays 0. */
export class DeterministicStatusLineFormatter {
  readonly llmCalls = STATUS_LINE_LLM_CALLS;

  format(event: BoardStatusEvent): FormattedStatusLine {
    return formatEvent(event);
  }

  formatTask(task: BoardTaskRecord): FormattedStatusLine {
    if (task.statusEvent) return formatEvent(task.statusEvent);
    return derive(task);
  }
}
