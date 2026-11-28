import type { BoardActivity, BoardStatusEvent, BoardTaskRecord, WorkingSubBadge } from "./types.js";

export interface StateDbHoldRow {
  readonly reason: string;
  readonly source: string;
  readonly summary: string;
}

export interface StateDbDependencyRow {
  readonly task: string;
  readonly title: string;
}

/**
 * Canonical `task_runtime` columns plus the joins the board needs
 * (holds, open inbox, pool phase, daemon status event). No progress percent.
 */
export interface StateDbBoardRow {
  readonly task: string;
  readonly feature: string;
  readonly state: string;
  readonly level: string;
  readonly holder_attempt: string | null;
  readonly submission_pending: 0 | 1;
  readonly title: string;
  readonly agent_id: string;
  readonly connection_id: string;
  readonly connection_label: string;
  readonly provider_id: string;
  readonly holds: readonly StateDbHoldRow[];
  readonly open_inbox_item: string | null;
  readonly inbox_need: string | null;
  readonly inbox_blocked_tasks: readonly string[];
  readonly blocked_by: readonly StateDbDependencyRow[];
  readonly merge_behind_count: number | null;
  readonly merge_behind_label: string | null;
  readonly activity: BoardActivity;
  readonly reviewer: string | null;
  readonly pool_phase: WorkingSubBadge | null;
  readonly run_slot: number | null;
  readonly run_slot_capacity: number | null;
  readonly queue_position: number | null;
  readonly queue_blocker: string | null;
  readonly running_command: string | null;
  readonly elapsed_seconds: number | null;
  readonly verify_flow: string | null;
  readonly retry: number | null;
  readonly retry_max: number | null;
  readonly hint: number | null;
  readonly status_event: BoardStatusEvent | null;
  readonly requirement_count: number;
  readonly updated_at_ms: number;
  readonly accepted_label: string | null;
  readonly spend_label: string | null;
}

export function boardTaskFromStateDb(row: StateDbBoardRow): BoardTaskRecord {
  return {
    taskId: row.task,
    feature: row.feature,
    state: row.state,
    level: row.level,
    title: row.title,
    agentId: row.agent_id,
    connectionId: row.connection_id,
    connectionLabel: row.connection_label,
    providerId: row.provider_id,
    holderAttempt: row.holder_attempt,
    submissionPending: row.submission_pending === 1,
    holds: row.holds.map((hold) => ({
      reason: hold.reason,
      source: hold.source,
      summary: hold.summary,
    })),
    openInboxItemId: row.open_inbox_item,
    inboxNeed: row.inbox_need,
    inboxBlockedTaskIds: row.inbox_blocked_tasks,
    blockedBy: row.blocked_by.map((item) => ({ taskId: item.task, title: item.title })),
    mergeBehindCount: row.merge_behind_count,
    mergeBehindLabel: row.merge_behind_label,
    activity: row.activity,
    reviewer: row.reviewer,
    poolPhase: row.pool_phase,
    runSlot: row.run_slot,
    runSlotCapacity: row.run_slot_capacity,
    queuePosition: row.queue_position,
    queueBlocker: row.queue_blocker,
    runningCommand: row.running_command,
    elapsedSeconds: row.elapsed_seconds,
    verifyFlow: row.verify_flow,
    retry: row.retry,
    retryMax: row.retry_max,
    hint: row.hint,
    statusEvent: row.status_event,
    requirementCount: row.requirement_count,
    updatedAtMs: row.updated_at_ms,
    acceptedLabel: row.accepted_label,
    spendLabel: row.spend_label,
  };
}
