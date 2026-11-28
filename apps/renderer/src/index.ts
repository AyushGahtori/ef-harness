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
export { DiagnosticsHealthView, renderHealthDocument } from "./diagnostics/index.js";
export { diagnosticsHealthSlot } from "./diagnostics/mount.js";
export type {
  WelcomeActionId,
  WelcomeBackModel,
  WelcomeBackView,
  WelcomeButton,
  WelcomeChoice,
} from "./cockpit/welcome-back/index.js";
