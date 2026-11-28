import { ROOM_IDS, type OfficeRoomId } from "../renderer/room-ids.js";

/** The 11 canonical kebab-case rooms from Task 162. */
export const OFFICE_LOGICAL_TAB_ROOMS = ROOM_IDS;

export type { OfficeRoomId };

export const FLAGGED_GROUP_LABEL = "Waiting on You / Flagged Workers";

/**
 * Screen-reader tab order: CEO office, the priority-flagged group, then the other ten rooms.
 */
export const OFFICE_MIRROR_TAB_GROUPS = [
  "ceo-office",
  "flagged",
  "front-desk",
  "discovery-lounge",
  "research-library",
  "architecture-studio",
  "planning-war-room",
  "engineering-bullpen",
  "qa-verification-lab",
  "integration-merge-bay",
  "shipping-dock",
  "break-room",
] as const;

export type OfficeMirrorGroup = (typeof OFFICE_MIRROR_TAB_GROUPS)[number];

export const OFFICE_ROOM_LABEL: Record<OfficeRoomId, string> = {
  "ceo-office": "CEO Office",
  "front-desk": "Front Desk",
  "discovery-lounge": "Discovery Lounge",
  "research-library": "Research Library",
  "architecture-studio": "Architecture Studio",
  "planning-war-room": "Planning War Room",
  "engineering-bullpen": "Engineering Bullpen",
  "qa-verification-lab": "QA Verification Lab (Pool 2 Test Rigs)",
  "integration-merge-bay": "Integration Merge Bay",
  "shipping-dock": "Shipping Dock",
  "break-room": "Break Room",
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