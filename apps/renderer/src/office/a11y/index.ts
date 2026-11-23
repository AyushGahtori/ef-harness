export {
  BULLPEN_VISIBLE_DESK_CAP,
  ARIA_LIVE_DEBOUNCE_MS,
  OFFICE_LOGICAL_TAB_ROOMS,
  OFFICE_ROOM_LABEL,
} from "./types.js";
export type {
  AnimationDirectorPort,
  BoardViewPort,
  CenterTabPort,
  CenterWorkspaceTab,
  ChimeCue,
  FocusModePort,
  HotDeskOverflowSnapshot,
  InboxPort,
  MediaQueryPort,
  OfficeCameraPort,
  OfficeRoomId,
  OfficeSelection,
  OfficeWorkerRecord,
  PhaseLayoutPresetPort,
  PixiTickerPort,
  PressureLevel,
  PressureMachinePort,
  PressureShiftEvent,
  WorkerInspectorPort,
} from "./types.js";
export { OfficeReducedMotionAdapter, type OfficeReducedMotionSnapshot } from "./office-reduced-motion-adapter.js";
export {
  OrangePressureAutoBoardFallback,
  ORANGE_FALLBACK_BANNER,
  GREEN_RECOVERY_OFFER,
  type OrangeFallbackSnapshot,
} from "./orange-pressure-auto-board-fallback.js";
export { OfficeSemanticMirrorTree, type MirrorFocusNode, type MirrorKeyDecision } from "./office-semantic-mirror-tree.js";
export {
  HotDeskOverflowAggregator,
  hotDeskOverflowLabel,
  rankWorkersForBullpen,
} from "./hot-desk-overflow-aggregator.js";
export {
  OptionalSoftChimesController,
  type ChimeSettings,
  type ChimePlayback,
} from "./optional-soft-chimes-controller.js";
export { DebouncedAriaLive } from "./debounced-aria-live.js";
export { detectHighContrastMode, type HighContrastGuidance } from "./high-contrast-mode.js";
export { toggleOfficeBoardView, type OfficeBoardToggleResult } from "./office-board-toggle.js";
export { reduceOfficeFocusTrap, type FocusTrapDecision } from "./focus-trap.js";
export { OfficeA11yCoordinator, type OfficeA11yCoordinatorOptions, type OfficeA11ySnapshot } from "./office-a11y-coordinator.js";