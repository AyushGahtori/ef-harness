import { attachHealthSlots } from "../health/board-slot.js";
import { HealthSignalBadgeStrip } from "../health/badge-strip.js";
import type { HealthSignal, HealthSignalKind } from "../health/types.js";
import { reduceBoardKey } from "./board-keyboard.js";
import { BoardFrameBatcher } from "./board-frame-batcher.js";
import { DeterministicStatusLineFormatter } from "./deterministic-status-line-formatter.js";
import { mapTaskToBoardLane } from "./map-task-to-board-lane.js";
import { indexBoardTasks, isQuickActionEnabled, projectBoard, type IndexedTask } from "./project-board.js";
import { renderBoardHtml } from "./render-board-html.js";
import {
  BOARD_LANES,
  type BoardHealthSignal,
  type BoardHealthSignalPort,
  type BoardKeyEvent,
  type BoardLaneId,
  type BoardQuickActionPort,
  type BoardTaskPatch,
  type BoardTaskRecord,
  type BoardThemeName,
  type BoardViewMode,
  type BoardViewSnapshot,
  type DaemonStorePort,
  type InspectorSelection,
  type QuickActionId,
  type ThreePoolCapacitySnapshot,
  type WorkerInspectorPort,
} from "./types.js";

export interface BoardCockpitOptions {
  readonly tasks: readonly BoardTaskRecord[];
  readonly capacity: ThreePoolCapacitySnapshot;
  readonly inspector: WorkerInspectorPort;
  readonly actions: BoardQuickActionPort;
  readonly health: BoardHealthSignalPort;
  readonly theme: BoardThemeName;
  readonly viewportHeightPx: number;
  readonly overscanPx: number;
}

export type BoardCockpitBindOptions = Omit<BoardCockpitOptions, "tasks" | "capacity">;

function zeroScroll(): Record<BoardLaneId, number> {
  return {
    queued: 0,
    working: 0,
    waiting_on_you: 0,
    held: 0,
    verifying: 0,
    integrating: 0,
    done: 0,
  };
}

function workingAgents(tasks: readonly BoardTaskRecord[]): number {
  const agents = new Set<string>();
  for (const task of tasks) {
    if (mapTaskToBoardLane(task) === "working") agents.add(task.agentId);
  }
  return agents.size;
}

/**
 * Seven-lane board. Reads task records shaped like state.db and paints only
 * the virtualized viewport. Task 122's shell binds pointer and key events to
 * the methods below; this class does not import that shell.
 */
export class BoardCockpitView {
  private tasks: readonly BoardTaskRecord[];
  private capacity: ThreePoolCapacitySnapshot;
  private readonly inspector: WorkerInspectorPort;
  private readonly actions: BoardQuickActionPort;
  private readonly health: BoardHealthSignalPort;
  private readonly formatter = new DeterministicStatusLineFormatter();
  private readonly batcher = new BoardFrameBatcher<BoardTaskRecord>();
  private byId = new Map<string, BoardTaskRecord>();
  private indexed: IndexedTask[] | null = null;
  private cached: BoardViewSnapshot | null = null;
  private mode: BoardViewMode = "all";
  private search = "";
  private featureGroupingEnabled: boolean;
  private readonly collapsedGroups = new Set<string>();
  private doneCollapsed = true;
  private selectedTaskId: string | null = null;
  private readonly scrollTop = zeroScroll();
  private readonly theme: BoardThemeName;
  private readonly viewportHeightPx: number;
  private readonly overscanPx: number;

  constructor(options: BoardCockpitOptions) {
    this.tasks = options.tasks;
    this.capacity = options.capacity;
    this.inspector = options.inspector;
    this.actions = options.actions;
    this.health = options.health;
    this.theme = options.theme;
    this.viewportHeightPx = options.viewportHeightPx;
    this.overscanPx = options.overscanPx;
    this.featureGroupingEnabled = workingAgents(options.tasks) >= 12 || options.tasks.length >= 500;
    this.reindexMap();
  }

  static bindStore(store: DaemonStorePort, options: BoardCockpitBindOptions): BoardCockpitView {
    const initial = store.getSnapshot();
    const view = new BoardCockpitView({
      ...options,
      tasks: initial.tasks,
      capacity: initial.capacity,
    });
    store.subscribe((snapshot) => {
      view.replaceSnapshot(snapshot.tasks, snapshot.capacity);
    });
    return view;
  }

  snapshot(): BoardViewSnapshot {
    if (this.cached) return this.cached;
    const snap = projectBoard({
      indexed: this.index(),
      capacity: this.capacity,
      mode: this.mode,
      search: this.search,
      featureGroupingEnabled: this.featureGroupingEnabled,
      collapsedGroups: this.collapsedGroups,
      doneCollapsed: this.doneCollapsed,
      selectedTaskId: this.selectedTaskId,
      scrollTop: this.scrollTop,
      theme: this.theme,
      viewportHeightPx: this.viewportHeightPx,
      overscanPx: this.overscanPx,
      health: this.health,
      formatter: this.formatter,
    });
    this.selectedTaskId = snap.selectedTaskId;
    this.cached = snap;
    return snap;
  }

  renderHtml(): string {
    const snap = this.snapshot();
    return renderBoardHtml(snap, this.healthMarkup(snap));
  }

  /** Inline Task 125 slots for the cards this frame actually paints. */
  healthSlots(): ReturnType<typeof attachHealthSlots> {
    return this.healthSlotsFor(this.snapshot());
  }

  setMode(mode: BoardViewMode): void {
    this.mode = mode;
    this.cached = null;
  }

  setSearch(query: string): void {
    this.search = query;
    this.cached = null;
  }

  toggleFeatureGrouping(): void {
    this.featureGroupingEnabled = !this.featureGroupingEnabled;
    this.cached = null;
  }

  toggleDoneCollapsed(): void {
    this.doneCollapsed = !this.doneCollapsed;
    this.cached = null;
  }

  toggleGroup(key: string): void {
    if (this.collapsedGroups.has(key)) this.collapsedGroups.delete(key);
    else this.collapsedGroups.add(key);
    this.cached = null;
  }

  setScroll(lane: BoardLaneId, scrollTop: number): void {
    this.scrollTop[lane] = Math.max(0, scrollTop);
    this.cached = null;
  }

  handleKeyDown(event: BoardKeyEvent): void {
    const snap = this.snapshot();
    const decision = reduceBoardKey({
      lanes: snap.lanes.map((lane) => ({ id: lane.id, cards: lane.cards })),
      selectedTaskId: snap.selectedTaskId,
      scrollTop: this.scrollTop,
      viewportHeightPx: this.viewportHeightPx,
      key: event.key,
    });
    if (decision.type === "activate") {
      this.activateCard(decision.taskId, "enter");
      return;
    }
    if (decision.type === "move") {
      this.selectedTaskId = decision.taskId;
      this.scrollTop[decision.lane] = decision.scrollTop;
      this.cached = null;
    }
  }

  activateCard(taskId: string, openedBy: InspectorSelection["openedBy"]): boolean {
    const task = this.byId.get(taskId);
    if (!task) return false;
    const indexed = this.index().find((item) => item.task.taskId === taskId);
    this.inspector.open({
      taskId,
      agentTag: indexed?.agentFull ?? `${task.agentId} · ${task.title}`,
      lane: mapTaskToBoardLane(task),
      openedBy,
    });
    return true;
  }

  performQuickAction(action: QuickActionId, taskId: string): boolean {
    const task = this.byId.get(taskId);
    if (!task || !isQuickActionEnabled(task, action)) return false;
    this.actions.perform({ action, taskId, inboxItemId: task.openInboxItemId });
    return true;
  }

  enqueuePatches(patches: readonly BoardTaskPatch[]): void {
    for (const patch of patches) {
      if (patch.taskId !== patch.next.taskId) {
        throw new Error(`Patch id ${patch.taskId} does not match record ${patch.next.taskId}`);
      }
      const placed = this.batcher.push(patch.taskId, patch.next, patch.atMs);
      if (placed === "rotate") {
        this.flushFrame();
        this.batcher.push(patch.taskId, patch.next, patch.atMs);
      }
    }
  }

  flushFrame(): void {
    const updates = this.batcher.drain();
    if (updates.size === 0) return;
    const next: BoardTaskRecord[] = [];
    const seen = new Set<string>();
    for (const task of this.tasks) {
      next.push(updates.get(task.taskId) ?? task);
      seen.add(task.taskId);
    }
    for (const [id, task] of updates) {
      if (!seen.has(id)) next.push(task);
    }
    this.tasks = next;
    this.reindexMap();
    this.indexed = null;
    this.cached = null;
  }

  replaceSnapshot(tasks: readonly BoardTaskRecord[], capacity: ThreePoolCapacitySnapshot): void {
    this.batcher.drain();
    this.tasks = tasks;
    this.capacity = capacity;
    this.reindexMap();
    this.indexed = null;
    this.cached = null;
  }

  laneOf(taskId: string): BoardLaneId | null {
    const task = this.byId.get(taskId);
    if (!task) return null;
    return mapTaskToBoardLane(task);
  }

  occurrenceCount(taskId: string): number {
    let count = 0;
    for (const task of this.tasks) {
      if (task.taskId === taskId) count += 1;
    }
    return count;
  }

  private index(): IndexedTask[] {
    if (!this.indexed) this.indexed = indexBoardTasks(this.tasks);
    return this.indexed;
  }

  private reindexMap(): void {
    this.byId = new Map(this.tasks.map((task) => [task.taskId, task]));
  }

  private healthMarkup(snap: BoardViewSnapshot): Map<string, string> {
    const markup = new Map<string, string>();
    for (const slot of this.healthSlotsFor(snap)) markup.set(slot.taskId, slot.strip.render());
    return markup;
  }

  private healthSlotsFor(snap: BoardViewSnapshot): ReturnType<typeof attachHealthSlots> {
    const ids = mountedTaskIds(snap);
    const strips = new Map<string, HealthSignalBadgeStrip>();
    for (const taskId of ids) strips.set(taskId, this.stripFor(taskId));
    return attachHealthSlots(
      ids.map((taskId) => ({ taskId })),
      strips,
    );
  }

  private stripFor(taskId: string): HealthSignalBadgeStrip {
    const signals = this.health.signalsFor(taskId).map((signal) => toHealthSignal(taskId, signal));
    return new HealthSignalBadgeStrip(taskId, signals, false);
  }
}

export const BOARD_LANE_ORDER: readonly BoardLaneId[] = BOARD_LANES;

const BOARD_SIGNAL_KIND: Readonly<Record<BoardHealthSignal["kind"], HealthSignalKind>> = {
  stuck_clock: "stuck_no_progress",
  loop: "loop_detected",
  throttled: "rate_limited_backoff",
  allowance_reset: "allowance_window_wait",
  escalation: "escalated_or_retrying",
};

function mountedTaskIds(snap: BoardViewSnapshot): string[] {
  const ids: string[] = [];
  for (const lane of snap.lanes) {
    for (const row of lane.rows) {
      if (row.kind === "card") ids.push(row.card.taskId);
    }
  }
  return ids;
}

function toHealthSignal(taskId: string, signal: BoardHealthSignal): HealthSignal {
  return {
    kind: BOARD_SIGNAL_KIND[signal.kind],
    variant: signal.kind,
    alarm: true,
    tone: signal.kind === "loop" || signal.kind === "stuck_clock" ? "red" : "amber",
    label: signal.label,
    clusterLabel: null,
    taskId,
    connectionId: "",
    attemptId: "",
    detail: null,
    actions: [],
    flashing: false,
    modal: false,
    inline: true,
    stealsFocus: false,
  };
}
