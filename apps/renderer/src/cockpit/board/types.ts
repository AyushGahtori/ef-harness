/**
 * Board cockpit types.
 *
 * Task state names match `task_states` in schema/state.sql. Holds, inbox
 * subscriptions, merge position, and pool phase are joined read-model fields.
 * Sibling engines are not on this branch; these interfaces are the local ports.
 */

export const BOARD_LANES = [
  "queued",
  "working",
  "waiting_on_you",
  "held",
  "verifying",
  "integrating",
  "done",
] as const;

export type BoardLaneId = (typeof BOARD_LANES)[number];

export const BOARD_LANE_LABEL: Readonly<Record<BoardLaneId, string>> = {
  queued: "Queued",
  working: "Working",
  waiting_on_you: "Waiting on You",
  held: "Held",
  verifying: "Verifying",
  integrating: "Integrating",
  done: "Done",
};

export const CANONICAL_TASK_STATES = [
  "DRAFTED",
  "READY",
  "LEASED",
  "CODING",
  "STATIC_AUDIT",
  "CLEAN_VERIFY",
  "ACCEPTED",
  "MERGED_TO_FEATURE",
  "WAITING_INPUT",
  "PARKED",
  "ESCALATED",
  "EXHAUSTED",
  "HUMAN_OWNED",
  "SUPERSEDED",
  "CANCELLED",
] as const;

export type CanonicalTaskState = (typeof CANONICAL_TASK_STATES)[number];

export const HEALTH_BADGE_KINDS = [
  "stuck_clock",
  "loop",
  "throttled",
  "allowance_reset",
  "escalation",
] as const;

export type HealthBadgeKind = (typeof HEALTH_BADGE_KINDS)[number];

export const BOARD_CARD_HEIGHT_PX = 160;
export const BOARD_SWIMLANE_HEIGHT_PX = 40;
export const HEALTH_SLOT_PX = 16;
export const AGENT_TAG_MAX_CHARS = 22;
export const STATUS_LINE_BUDGET_MS = 0.1;
export const BOARD_RENDER_BUDGET_MS = 10;
export const BOARD_FILTER_BUDGET_MS = 2;
export const FRAME_BATCH_WINDOW_MS = 800;
export const STATUS_LINE_LLM_CALLS = 0;

export type WorkingSubBadge = "thinking" | "waiting_for_run_slot" | "running_command";

export type BoardActivity = "none" | "feature_wiring" | "project_merge" | "verifying";

export type BoardThemeName = "light" | "dark";

export type BoardViewMode = "all" | "active_only" | "needs_attention" | "by_feature" | "by_connection";

export type QuickActionId =
  | "pause_task"
  | "resume"
  | "jump_to_inbox"
  | "open_diff"
  | "i_fixed_it_myself";

export interface TaskHoldSnapshot {
  readonly reason: string;
  readonly source: string;
  readonly summary: string;
}

export interface DependencyWait {
  readonly taskId: string;
  readonly title: string;
}

export interface BoardHealthSignal {
  readonly kind: HealthBadgeKind;
  readonly label: string;
}

export type BoardStatusEvent =
  | {
      readonly kind: "editing";
      readonly path: string;
      readonly step: number;
      readonly stepEstimate: number;
    }
  | {
      readonly kind: "running";
      readonly command: string;
      readonly runSlot: number;
      readonly runSlotCapacity: number;
      readonly elapsedSeconds: number;
    }
  | {
      readonly kind: "waiting_for_run_slot";
      readonly queuePosition: number;
      readonly blocker: string;
    }
  | {
      readonly kind: "verifying";
      readonly flow: string;
      readonly retry: number;
      readonly retryMax: number;
      readonly hint: number;
    }
  | {
      readonly kind: "merge_queue";
      readonly behindCount: number;
      readonly behindLabel: string;
    }
  | {
      readonly kind: "held";
      readonly reason: string;
      readonly quarantined: boolean;
    }
  | {
      readonly kind: "queued_dependency";
      readonly taskId: string;
      readonly title: string;
    }
  | {
      readonly kind: "inbox_block";
      readonly need: string;
      readonly blockedTaskIds: readonly string[];
    }
  | {
      readonly kind: "checks";
      readonly passed: number;
      readonly total: number;
    }
  | {
      readonly kind: "integrating";
      readonly detail: string;
    }
  | {
      readonly kind: "accepted";
      readonly acceptedAtLabel: string;
      readonly levelLabel: string;
      readonly spendLabel: string;
    }
  | {
      readonly kind: "attempt_checks";
      readonly passed: number;
      readonly failed: number;
      readonly attempt: number;
    }
  | {
      readonly kind: "throttled";
      readonly retryInLabel: string;
    };

export interface FormattedStatusLine {
  readonly text: string;
  readonly title: string;
  readonly llmCalls: 0;
}

/**
 * One task as the board reads it. Column names from `task_runtime` are mapped
 * in `boardTaskFromStateDb`. There is no percent-complete field.
 */
export interface BoardTaskRecord {
  readonly taskId: string;
  readonly feature: string;
  readonly state: string;
  readonly level: string;
  readonly title: string;
  readonly agentId: string;
  readonly connectionId: string;
  readonly connectionLabel: string;
  readonly providerId: string;
  readonly holderAttempt: string | null;
  readonly submissionPending: boolean;
  readonly holds: readonly TaskHoldSnapshot[];
  readonly openInboxItemId: string | null;
  readonly inboxNeed: string | null;
  readonly inboxBlockedTaskIds: readonly string[];
  readonly blockedBy: readonly DependencyWait[];
  readonly mergeBehindCount: number | null;
  readonly mergeBehindLabel: string | null;
  readonly activity: BoardActivity;
  readonly reviewer: string | null;
  readonly poolPhase: WorkingSubBadge | null;
  readonly runSlot: number | null;
  readonly runSlotCapacity: number | null;
  readonly queuePosition: number | null;
  readonly queueBlocker: string | null;
  readonly runningCommand: string | null;
  readonly elapsedSeconds: number | null;
  readonly verifyFlow: string | null;
  readonly retry: number | null;
  readonly retryMax: number | null;
  readonly hint: number | null;
  readonly statusEvent: BoardStatusEvent | null;
  readonly requirementCount: number;
  readonly updatedAtMs: number;
  readonly acceptedLabel: string | null;
  readonly spendLabel: string | null;
}

export interface BoardTaskPatch {
  readonly taskId: string;
  readonly atMs: number;
  readonly next: BoardTaskRecord;
}

/** Local port for Task 119 ThreePoolCapacityScheduler. */
export interface ThreePoolCapacitySnapshot {
  readonly thinkingUsed: number;
  readonly thinkingCapacity: number;
  readonly runSlotsUsed: number;
  readonly runSlotsCapacity: number;
  readonly verifierRunSlots: number;
  readonly workerRunSlots: number;
  readonly runSlotQueueDepth: number;
  readonly mergeQueueIdle: boolean;
  readonly mergeQueueDetail: string;
}

/** Local port for Task 122 DaemonStoreProvider. */
export interface DaemonStoreSnapshot {
  readonly revision: number;
  readonly tasks: readonly BoardTaskRecord[];
  readonly capacity: ThreePoolCapacitySnapshot;
}

export interface DaemonStorePort {
  getSnapshot(): DaemonStoreSnapshot;
  subscribe(listener: (snapshot: DaemonStoreSnapshot) => void): () => void;
}

/** Local port for Task 126 Worker Inspector. */
export interface InspectorSelection {
  readonly taskId: string;
  readonly agentTag: string;
  readonly lane: BoardLaneId;
  readonly openedBy: "click" | "enter";
}

export interface WorkerInspectorPort {
  open(selection: InspectorSelection): void;
}

/** Local port for card actions, including Task 173 "I fixed it myself". */
export interface QuickActionRequest {
  readonly action: QuickActionId;
  readonly taskId: string;
  readonly inboxItemId: string | null;
}

export interface BoardQuickActionPort {
  perform(request: QuickActionRequest): void;
}

/** Local port for Task 125. Empty signals still reserve the five slots. */
export interface BoardHealthSignalPort {
  signalsFor(taskId: string): readonly BoardHealthSignal[];
}

export interface HealthSlotModel {
  readonly kind: HealthBadgeKind;
  readonly sizePx: number;
  readonly label: string | null;
}

export interface CardActionModel {
  readonly id: QuickActionId;
  readonly label: string;
  readonly enabled: boolean;
}

export interface BoardCardModel {
  readonly taskId: string;
  readonly lane: BoardLaneId;
  readonly agentLabel: string;
  readonly agentFull: string;
  readonly tier: string;
  readonly connectionId: string;
  readonly connectionLabel: string;
  readonly providerId: string;
  readonly dotColor: string;
  readonly statusText: string;
  readonly statusTitle: string;
  readonly subBadge: string | null;
  readonly subBadgeId: WorkingSubBadge | null;
  readonly holdBadge: string | null;
  readonly holdTitle: string | null;
  readonly quarantined: boolean;
  readonly highlighted: boolean;
  readonly selected: boolean;
  readonly inboxItemId: string | null;
  readonly health: readonly HealthSlotModel[];
  readonly actions: readonly CardActionModel[];
  readonly heightPx: number;
}

export interface SwimlaneRowModel {
  readonly kind: "swimlane";
  readonly key: string;
  readonly label: string;
  readonly summary: string;
  readonly collapsed: boolean;
  readonly topPx: number;
  readonly heightPx: number;
}

export interface CardRowModel {
  readonly kind: "card";
  readonly card: BoardCardModel;
  readonly topPx: number;
  readonly heightPx: number;
}

export type RenderedRow = SwimlaneRowModel | CardRowModel;

export interface CardPlacement {
  readonly taskId: string;
  readonly topPx: number;
  readonly heightPx: number;
}

export interface RenderedLane {
  readonly id: BoardLaneId;
  readonly label: string;
  readonly count: number;
  readonly density: "slim" | "regular";
  readonly collapsed: boolean;
  readonly taskIds: readonly string[];
  readonly cards: readonly CardPlacement[];
  readonly totalHeightPx: number;
  readonly scrollTop: number;
  readonly viewportHeightPx: number;
  readonly scrollable: boolean;
  readonly rows: readonly RenderedRow[];
}

export interface BoardViewSnapshot {
  readonly capacityHeader: string;
  readonly mode: BoardViewMode;
  readonly search: string;
  readonly featureGrouping: boolean;
  readonly groupBy: "none" | "feature" | "connection";
  readonly theme: BoardThemeName;
  readonly lanes: readonly RenderedLane[];
  readonly selectedTaskId: string | null;
  readonly taskCount: number;
  readonly requirementTotal: number;
  readonly visibleCardCount: number;
  readonly mountedCardIds: readonly string[];
}

export interface BoardKeyEvent {
  readonly key: string;
}

export const QUICK_ACTION_LABEL: Readonly<Record<QuickActionId, string>> = {
  pause_task: "Pause task",
  resume: "Resume",
  jump_to_inbox: "Jump to Inbox question",
  open_diff: "Open diff",
  i_fixed_it_myself: "I fixed it myself",
};

export const SUB_BADGE_LABEL: Readonly<Record<WorkingSubBadge, string>> = {
  thinking: "Thinking",
  waiting_for_run_slot: "Waiting for run slot",
  running_command: "Running command",
};
