export {
  DisconnectedMonitorBoundsGuard,
  DisconnectedMonitorError,
  MIN_VISIBLE_HEIGHT,
  MIN_VISIBLE_WIDTH,
  STOP_BUTTON_WIDTH,
  TOP_BAR_HEIGHT,
  intersectionSize,
  isTopBarStopVisible,
  stopButtonRect,
} from "./disconnected-monitor-bounds-guard.js";
export {
  InMemoryMainShell,
  InMemoryScreenPort,
  InMemoryTrayLifecycle,
  InMemoryWindow,
  InMemoryWindowFactory,
} from "./electron-ports.js";
export { PopOutWindowCoordinator, popOutWindowId } from "./pop-out-window-coordinator.js";
export type { PopOutCoordinatorOptions } from "./pop-out-window-coordinator.js";
export { SharedHarnessdStream } from "./shared-harnessd-stream.js";
export {
  DOCK_BACK_LABEL,
  MAX_POP_OUT_WINDOWS,
  POP_OUT_TITLE,
  POP_OUT_VIEWS,
} from "./types.js";
export type {
  BoundsEvent,
  BoundsRecovery,
  BoundsRecoveryReason,
  CenterWorkspaceTabState,
  ConnectedDisplay,
  DaemonSnapshot,
  DipRect,
  EntitySelectionRoute,
  HarnessdEvent,
  MainShellPort,
  ManagedWindow,
  PopOutResult,
  PopOutView,
  PrimaryCloseResult,
  SavedWindowPlacement,
  ScreenEventPayload,
  ScreenPort,
  ThemeName,
  TrayLifecyclePort,
  WindowFactory,
} from "./types.js";
