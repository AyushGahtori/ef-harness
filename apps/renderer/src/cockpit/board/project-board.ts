import { connectionDotColor, formatAgentTag, formatTierPill } from "./agent-identity.js";
import { DeterministicStatusLineFormatter } from "./deterministic-status-line-formatter.js";
import { FeatureSwimlaneGrouper } from "./feature-swimlane-grouper.js";
import { holdBadge, isUserPauseReason } from "./hold-badge.js";
import { mapTaskToBoardLane } from "./map-task-to-board-lane.js";
import { formatPoolCapacityHeader } from "./pool-capacity-header.js";
import {
  BOARD_CARD_HEIGHT_PX,
  BOARD_LANES,
  BOARD_LANE_LABEL,
  HEALTH_BADGE_KINDS,
  HEALTH_SLOT_PX,
  QUICK_ACTION_LABEL,
  SUB_BADGE_LABEL,
  type BoardCardModel,
  type BoardHealthSignal,
  type BoardHealthSignalPort,
  type BoardLaneId,
  type BoardTaskRecord,
  type BoardThemeName,
  type BoardViewMode,
  type BoardViewSnapshot,
  type CardActionModel,
  type HealthBadgeKind,
  type HealthSlotModel,
  type QuickActionId,
  type RenderedLane,
  type RenderedRow,
  type ThreePoolCapacitySnapshot,
} from "./types.js";
import { VirtualizedLaneColumn } from "./virtualized-lane-column.js";

export interface IndexedTask {
  readonly task: BoardTaskRecord;
  readonly lane: BoardLaneId;
  readonly haystack: string;
  readonly agentLabel: string;
  readonly agentFull: string;
}

interface CardRef {
  readonly kind: "card";
  readonly indexed: IndexedTask;
  readonly heightPx: number;
}

interface SwimRef {
  readonly kind: "swimlane";
  readonly key: string;
  readonly label: string;
  readonly summary: string;
  readonly collapsed: boolean;
  readonly heightPx: number;
}

type RowRef = CardRef | SwimRef;

const grouper = new FeatureSwimlaneGrouper();
const columns = new VirtualizedLaneColumn();

export function indexBoardTasks(tasks: readonly BoardTaskRecord[]): IndexedTask[] {
  const indexed: IndexedTask[] = [];
  const seen = new Set<string>();
  for (const task of tasks) {
    if (seen.has(task.taskId)) continue;
    seen.add(task.taskId);
    const tag = formatAgentTag(task.agentId, task.title);
    const holdText = task.holds.length === 0 ? "" : `\n${task.holds.map((hold) => hold.summary).join(" ")}`;
    const phaseLabel = task.poolPhase ? SUB_BADGE_LABEL[task.poolPhase] : "";
    const haystack =
      `${tag.full}\n${task.title}\n${task.feature}\n${task.connectionLabel}\n${task.agentId}\n${task.state}\n${phaseLabel}\n${task.runningCommand ?? ""}\n${task.verifyFlow ?? ""}${holdText}`.toLowerCase();
    indexed.push({
      task,
      lane: mapTaskToBoardLane(task),
      haystack,
      agentLabel: tag.label,
      agentFull: tag.full,
    });
  }
  return indexed;
}

export function isQuickActionEnabled(task: BoardTaskRecord, action: QuickActionId): boolean {
  return actionsFor(task).some((item) => item.id === action && item.enabled);
}

function actionsFor(task: BoardTaskRecord): readonly CardActionModel[] {
  const lane = mapTaskToBoardLane(task);
  const paused = task.holds.some((item) => isUserPauseReason(item.reason));
  const activeWork = lane === "working" || lane === "verifying" || lane === "integrating";
  return [
    { id: "pause_task", label: QUICK_ACTION_LABEL.pause_task, enabled: activeWork && !paused },
    { id: "resume", label: QUICK_ACTION_LABEL.resume, enabled: paused },
    {
      id: "jump_to_inbox",
      label: QUICK_ACTION_LABEL.jump_to_inbox,
      enabled: task.openInboxItemId !== null,
    },
    {
      id: "open_diff",
      label: QUICK_ACTION_LABEL.open_diff,
      enabled: task.state !== "DRAFTED" && lane !== "queued",
    },
    {
      id: "i_fixed_it_myself",
      label: QUICK_ACTION_LABEL.i_fixed_it_myself,
      enabled: lane !== "done",
    },
  ];
}

function modeAllows(lane: BoardLaneId, mode: BoardViewMode): boolean {
  if (mode === "active_only") return lane !== "queued" && lane !== "done";
  if (mode === "needs_attention") return lane === "waiting_on_you" || lane === "held";
  return true;
}

function healthSlots(signals: readonly BoardHealthSignal[]): readonly HealthSlotModel[] {
  const labels = new Map<HealthBadgeKind, string>();
  for (const signal of signals) labels.set(signal.kind, signal.label);
  return HEALTH_BADGE_KINDS.map((kind) => ({
    kind,
    sizePx: HEALTH_SLOT_PX,
    label: labels.get(kind) ?? null,
  }));
}

function materialize(
  item: IndexedTask,
  selectedTaskId: string | null,
  query: string,
  health: BoardHealthSignalPort,
  formatter: DeterministicStatusLineFormatter,
): BoardCardModel {
  const task = item.task;
  const badge = holdBadge(task.holds);
  const status = formatter.formatTask(task);
  return {
    taskId: task.taskId,
    lane: item.lane,
    agentLabel: item.agentLabel,
    agentFull: item.agentFull,
    tier: formatTierPill(task.level),
    connectionId: task.connectionId,
    connectionLabel: task.connectionLabel,
    providerId: task.providerId,
    dotColor: connectionDotColor(task.connectionId),
    statusText: status.text,
    statusTitle: status.title,
    subBadge: task.poolPhase ? SUB_BADGE_LABEL[task.poolPhase] : null,
    subBadgeId: task.poolPhase,
    holdBadge: badge?.text ?? null,
    holdTitle: badge?.title ?? null,
    quarantined: task.submissionPending,
    highlighted: query.length > 0,
    selected: task.taskId === selectedTaskId,
    inboxItemId: task.openInboxItemId,
    health: healthSlots(health.signalsFor(task.taskId)),
    actions: actionsFor(task),
    heightPx: BOARD_CARD_HEIGHT_PX,
  };
}

export interface ProjectBoardInput {
  readonly indexed: readonly IndexedTask[];
  readonly capacity: ThreePoolCapacitySnapshot;
  readonly mode: BoardViewMode;
  readonly search: string;
  readonly featureGroupingEnabled: boolean;
  readonly collapsedGroups: ReadonlySet<string>;
  readonly doneCollapsed: boolean;
  readonly selectedTaskId: string | null;
  readonly scrollTop: Readonly<Record<BoardLaneId, number>>;
  readonly theme: BoardThemeName;
  readonly viewportHeightPx: number;
  readonly overscanPx: number;
  readonly health: BoardHealthSignalPort;
  readonly formatter: DeterministicStatusLineFormatter;
}

export function projectBoard(input: ProjectBoardInput): BoardViewSnapshot {
  const query = input.search.trim().toLowerCase();
  const matched = input.indexed.filter(
    (item) => modeAllows(item.lane, input.mode) && (query.length === 0 || item.haystack.includes(query)),
  );
  const groupBy: "none" | "feature" | "connection" =
    input.mode === "by_connection"
      ? "connection"
      : input.mode === "by_feature" || input.featureGroupingEnabled
        ? "feature"
        : "none";
  const keyOf =
    groupBy === "connection"
      ? (task: BoardTaskRecord) => task.connectionId
      : (task: BoardTaskRecord) => task.feature;
  const labelOf =
    groupBy === "connection"
      ? (task: BoardTaskRecord) => task.connectionLabel
      : (task: BoardTaskRecord) => task.feature;
  const summaries =
    groupBy === "none" ? null : grouper.summarize(
      matched.map((item) => item.task),
      keyOf,
      labelOf,
    );
  const byLane = new Map<BoardLaneId, IndexedTask[]>();
  for (const lane of BOARD_LANES) byLane.set(lane, []);
  for (const item of matched) byLane.get(item.lane)?.push(item);

  let selected = input.selectedTaskId;
  const selectedVisible = selected !== null && matched.some((item) => item.task.taskId === selected);
  if (!selectedVisible) {
    selected = null;
    for (const lane of BOARD_LANES) {
      const first = byLane.get(lane)?.[0];
      if (first) {
        selected = first.task.taskId;
        break;
      }
    }
  }

  const lanes: RenderedLane[] = [];
  const mountedCardIds: string[] = [];
  for (const lane of BOARD_LANES) {
    const laneItems = byLane.get(lane) ?? [];
    const collapsed = lane === "done" && input.doneCollapsed;
    const rowRefs: RowRef[] = [];
    if (!collapsed) {
      if (groupBy === "none" || !summaries) {
        for (const item of laneItems) {
          rowRefs.push({ kind: "card", indexed: item, heightPx: BOARD_CARD_HEIGHT_PX });
        }
      } else {
        const grouped = grouper.rowsForLane(
          laneItems.map((item) => item.task),
          summaries,
          input.collapsedGroups,
          keyOf,
        );
        const byId = new Map(laneItems.map((item) => [item.task.taskId, item]));
        for (const row of grouped) {
          if (row.kind === "swimlane") {
            rowRefs.push(row);
            continue;
          }
          const indexed = byId.get(row.task.taskId);
          if (!indexed) continue;
          rowRefs.push({ kind: "card", indexed, heightPx: BOARD_CARD_HEIGHT_PX });
        }
      }
    }
    const scrollTop = input.scrollTop[lane] ?? 0;
    const virtual = columns.window(
      rowRefs,
      (row) => row.heightPx,
      scrollTop,
      input.viewportHeightPx,
      input.overscanPx,
    );
    const cards: { taskId: string; topPx: number; heightPx: number }[] = [];
    let cursor = 0;
    for (const row of rowRefs) {
      if (row.kind === "card") {
        cards.push({ taskId: row.indexed.task.taskId, topPx: cursor, heightPx: row.heightPx });
      }
      cursor += row.heightPx;
    }
    const rows: RenderedRow[] = [];
    for (const item of virtual.items) {
      const row = item.item;
      if (row.kind === "swimlane") {
        rows.push({
          kind: "swimlane",
          key: row.key,
          label: row.label,
          summary: row.summary,
          collapsed: row.collapsed,
          topPx: item.startPx,
          heightPx: item.sizePx,
        });
        continue;
      }
      const card = materialize(row.indexed, selected, query, input.health, input.formatter);
      mountedCardIds.push(card.taskId);
      rows.push({ kind: "card", card, topPx: item.startPx, heightPx: item.sizePx });
    }
    const count = laneItems.length;
    lanes.push({
      id: lane,
      label: BOARD_LANE_LABEL[lane],
      count,
      density: collapsed || count === 0 ? "slim" : "regular",
      collapsed,
      taskIds: laneItems.map((item) => item.task.taskId),
      totalHeightPx: virtual.totalHeightPx,
      scrollTop,
      viewportHeightPx: input.viewportHeightPx,
      scrollable: virtual.totalHeightPx > input.viewportHeightPx,
      rows,
      cards,
    });
  }

  let requirementTotal = 0;
  for (const item of input.indexed) requirementTotal += item.task.requirementCount;

  return {
    capacityHeader: formatPoolCapacityHeader(input.capacity),
    mode: input.mode,
    search: input.search,
    featureGrouping: groupBy === "feature",
    groupBy,
    theme: input.theme,
    lanes,
    selectedTaskId: selected,
    taskCount: input.indexed.length,
    requirementTotal,
    visibleCardCount: mountedCardIds.length,
    mountedCardIds,
  };
}
