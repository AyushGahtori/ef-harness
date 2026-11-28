export const packageName = "@ef-harness/renderer" as const;
export const layer = 5 as const;

export function packageIdentity(): {
  readonly name: typeof packageName;
  readonly layer: typeof layer;
} {
  return { name: packageName, layer };
}

export {
  M1_CONTENT_SECURITY_POLICY,
  M1_TASK_PATH,
  M1_VIEWER_DOCUMENT,
  M1_VIEWER_MOUNT_ID,
  createClientStateSyncer,
  escapeText,
  renderDiffText,
} from "./m1-viewer/index.js";
export type {
  DomainEvent,
  SyncApply,
} from "./m1-viewer/index.js";
export * from "./presets/index.js";
export * from "./shell/index.js";
export { BoardCockpitView } from "./cockpit/board/index.js";
export type {
  BoardHealthSignalPort,
  BoardQuickActionPort,
  BoardTaskRecord,
  ThreePoolCapacitySnapshot,
  WorkerInspectorPort,
} from "./cockpit/board/index.js";
export { WelcomeBackScreen, renderWelcomeBack } from "./cockpit/welcome-back/index.js";
export { IsolatedPreviewWebviewHost } from "./preview/host/index.js";
export { createVisualSteerRouter, VisualSteerRouter } from "./preview/point-to-fix/index.js";
export { DiagnosticsHealthView, renderHealthDocument } from "./diagnostics/index.js";
export { diagnosticsHealthSlot } from "./diagnostics/mount.js";
export {
  HotDeskOverflowAggregator,
  ORANGE_FALLBACK_BANNER,
  OfficeReducedMotionAdapter,
  OfficeSemanticMirrorTree,
  OfficeView,
  OrangePressureAutoBoardFallback,
  bindPressureHysteresisStateMachine,
  governorPressureFromShell,
  shellCenterTab,
} from "./office/a11y/index.js";
export type {
  AnimationDirectorPort,
  BoardViewPort,
  CenterTabPort,
  GovernorPressureMachine,
  MediaQueryPort,
  OfficeViewMount,
  OfficeWorkerRecord,
  PhaseLayoutPresetPort,
  PixiTickerPort,
  PressureMachinePort,
} from "./office/a11y/index.js";
export { ROOM_IDS as OFFICE_ROOM_IDS } from "./office/renderer/room-ids.js";
export type { OfficeRoomId as CanonicalOfficeRoomId } from "./office/renderer/room-ids.js";
export { formatAgentOfficeTag, HelperSpriteClusterManager } from "./office/cast/index.js";
export {
  BurstCollapseEventQueue,
  FloorPlanWalkableGridPort,
  InMemoryOfficeCastProjector,
  LocalWalkableGridPort,
  OfficeCastProjectorPortAdapter,
  OfficeFrameBudgetMonitor,
  TruthfulAnimationDirector,
  walkableGridFromFloorPlan,
} from "./office/director/index.js";
export {
  BeforeAfterBaselineApprover,
  InMemoryVisualBaselineStore,
  verifyCrossViewportAfterFix,
} from "./preview/point-to-fix/index.js";
export type {
  WelcomeActionId,
  WelcomeBackModel,
  WelcomeBackView,
  WelcomeButton,
  WelcomeChoice,
} from "./cockpit/welcome-back/index.js";
