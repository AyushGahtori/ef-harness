export const OFFICE_LOGICAL_TAB_ROOMS = [
  "ceo_office",
  "flagged",
  "engineering_bullpen",
  "qa_lab",
  "merge_bay",
  "shipping_dock",
  "break_room",
] as const;

export type OfficeRoomId = (typeof OFFICE_LOGICAL_TAB_ROOMS)[number];

export const OFFICE_ROOM_LABEL: Record<OfficeRoomId, string> = {
  ceo_office: "CEO Office",
  flagged: "Waiting on You / Flagged Workers",
  engineering_bullpen: "Engineering Bullpen",
  qa_lab: "QA Lab (Pool 2 Test Rigs)",
  merge_bay: "Merge Bay",
  shipping_dock: "Shipping Dock",
  break_room: "Break Room",
};

export const BULLPEN_VISIBLE_DESK_CAP = 28;
export const ARIA_LIVE_DEBOUNCE_MS = 1_500;

export type PressureLevel = "GREEN" | "YELLOW" | "ORANGE" | "RED";

export type CenterWorkspaceTab = "office" | "board";

export type ChimeCue = "feature_done" | "needs_you" | "build_complete";

export interface OfficeWorkerRecord {
  readonly agentId: string;
  readonly title: string;
  readonly roomId: OfficeRoomId;
  readonly featureKey?: string;
  readonly stateLabel: string;
  readonly statusIcon: string;
  readonly flagged?: boolean;
  readonly priority: number;
  readonly inboxItem?: boolean;
}

export interface SeatedWorkerPlacement {
  readonly worker: OfficeWorkerRecord;
  readonly deskIndex: number;
  readonly seated: boolean;
}

export interface HotDeskOverflowSnapshot {
  readonly seated: readonly SeatedWorkerPlacement[];
  readonly overflowCount: number;
  readonly overflowLabel: string;
}

export interface OfficeSelection {
  readonly agentId: string;
  readonly title: string;
  readonly openedBy: "click" | "keyboard" | "toggle";
}

export interface PressureShiftEvent {
  readonly from: PressureLevel;
  readonly to: PressureLevel;
  readonly atMs: number;
  readonly orangeEntered: boolean;
}

export interface PressureMachinePort {
  readonly pressure: PressureLevel;
  subscribe(listener: (event: PressureShiftEvent) => void): () => void;
}

export interface AnimationDirectorPort {
  readonly continuousMotionCount: number;
  setMotionEnabled(enabled: boolean): void;
  seatAllAtDesks(): void;
}

export interface PixiTickerPort {
  readonly running: boolean;
  readonly frameCount: number;
  stop(): void;
  start(): void;
}

export interface BoardViewPort {
  readonly visible: boolean;
  showBoard(selection: OfficeSelection | null): void;
  hideBoard(): void;
  currentSelection(): OfficeSelection | null;
}

export interface WorkerInspectorPort {
  open(selection: OfficeSelection): void;
}

export interface InboxPort {
  openFromCeoInbox(): void;
}

export interface OfficeCameraPort {
  panToAgent(agentId: string): void;
  setFocusRing(agentId: string | null): void;
}

export interface PhaseLayoutPresetPort {
  readonly buildPhaseDefaultTab: CenterWorkspaceTab;
}

export interface FocusModePort {
  readonly active: boolean;
}

export interface MediaQueryPort {
  prefersReducedMotion(): boolean;
  forcedColorsActive(): boolean;
}

export interface CenterTabPort {
  readonly activeTab: CenterWorkspaceTab;
  setTab(tab: CenterWorkspaceTab): void;
}