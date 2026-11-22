import type {
  BoardHealthSignal,
  BoardHealthSignalPort,
  BoardQuickActionPort,
  BoardTaskRecord,
  BoardThemeName,
  InspectorSelection,
  QuickActionRequest,
  ThreePoolCapacitySnapshot,
  WorkerInspectorPort,
} from "../../src/cockpit/board/index.js";
import { BoardCockpitView } from "../../src/cockpit/board/index.js";

export const SAMPLE_CAPACITY: ThreePoolCapacitySnapshot = {
  thinkingUsed: 8,
  thinkingCapacity: 12,
  runSlotsUsed: 2,
  runSlotsCapacity: 2,
  verifierRunSlots: 1,
  workerRunSlots: 1,
  runSlotQueueDepth: 2,
  mergeQueueIdle: true,
  mergeQueueDetail: "",
};

export function makeTask(overrides: Partial<BoardTaskRecord> = {}): BoardTaskRecord {
  const task: BoardTaskRecord = {
    taskId: "T1",
    feature: "F-Menu",
    state: "READY",
    level: "mid",
    title: "print page",
    agentId: "A0014",
    connectionId: "chatgpt-plan",
    connectionLabel: "ChatGPT plan",
    providerId: "openai",
    holderAttempt: null,
    submissionPending: false,
    holds: [],
    openInboxItemId: null,
    inboxNeed: null,
    inboxBlockedTaskIds: [],
    blockedBy: [],
    mergeBehindCount: null,
    mergeBehindLabel: null,
    activity: "none",
    reviewer: null,
    poolPhase: null,
    runSlot: null,
    runSlotCapacity: null,
    queuePosition: null,
    queueBlocker: null,
    runningCommand: null,
    elapsedSeconds: null,
    verifyFlow: null,
    retry: null,
    retryMax: null,
    hint: null,
    statusEvent: null,
    requirementCount: 0,
    updatedAtMs: 0,
    acceptedLabel: null,
    spendLabel: null,
  };
  return { ...task, ...overrides };
}

export interface RecordedPorts {
  readonly opened: InspectorSelection[];
  readonly performed: QuickActionRequest[];
  readonly inspector: WorkerInspectorPort;
  readonly actions: BoardQuickActionPort;
  readonly health: BoardHealthSignalPort;
}

export function recordedPorts(
  signalsFor: (taskId: string) => readonly BoardHealthSignal[] = () => [],
): RecordedPorts {
  const opened: InspectorSelection[] = [];
  const performed: QuickActionRequest[] = [];
  return {
    opened,
    performed,
    inspector: {
      open(selection) {
        opened.push(selection);
      },
    },
    actions: {
      perform(request) {
        performed.push(request);
      },
    },
    health: { signalsFor },
  };
}

export function createView(
  tasks: readonly BoardTaskRecord[],
  options: {
    readonly theme?: BoardThemeName;
    readonly viewportHeightPx?: number;
    readonly overscanPx?: number;
    readonly capacity?: ThreePoolCapacitySnapshot;
    readonly health?: BoardHealthSignalPort;
  } = {},
): { view: BoardCockpitView } & RecordedPorts {
  const ports = recordedPorts();
  const view = new BoardCockpitView({
    tasks,
    capacity: options.capacity ?? SAMPLE_CAPACITY,
    inspector: ports.inspector,
    actions: ports.actions,
    health: options.health ?? ports.health,
    theme: options.theme ?? "light",
    viewportHeightPx: options.viewportHeightPx ?? 960,
    overscanPx: options.overscanPx ?? 0,
  });
  return { view, ...ports };
}

export function buildDenseBoard(): BoardTaskRecord[] {
  const tasks: BoardTaskRecord[] = [];
  const features = Array.from({ length: 25 }, (_, index) => `F${String(index + 1).padStart(2, "0")}`);
  let sequence = 0;
  const push = (state: string, extra: Partial<BoardTaskRecord> = {}) => {
    const feature = features[sequence % features.length] ?? "F01";
    tasks.push(
      makeTask({
        taskId: `T${sequence}`,
        state,
        feature,
        title: `task ${sequence}`,
        agentId: `A${String(2000 + sequence).padStart(4, "0")}`,
        requirementCount: 10,
        ...extra,
      }),
    );
    sequence += 1;
  };
  for (let index = 0; index < 400; index += 1) push("MERGED_TO_FEATURE");
  for (let index = 0; index < 70; index += 1) push("READY");
  for (let index = 0; index < 20; index += 1) {
    push("CODING", {
      poolPhase: "thinking",
      holderAttempt: `attempt-${index}`,
      agentId: index === 0 ? "A0014" : `W${String(index).padStart(4, "0")}`,
      title: index === 0 ? "print page" : `worker ${index}`,
    });
  }
  for (let index = 0; index < 10; index += 1) push("CLEAN_VERIFY", { verifyFlow: "unit" });
  return tasks;
}
