export { countNodes, h, runAxeCoreAudit, textContent } from "./a11y.js";
export { placementInside, placePopover } from "./geometry.js";
export { reduceEscape } from "./keyboard.js";
export { PostSendChangeHighlighter } from "./highlighter.js";
export {
  CanvasPopoverHost,
  createCanvasPopoverHost,
  renderedText,
} from "./host.js";
export type { PopoverHostOptions } from "./host.js";
export {
  LocalBoxChatIntentController,
  LocalCanvasSelectionContext,
  LocalComposerTargetStateMachine,
  LocalInspectorShell,
  LocalInteractiveArchitectureCanvas,
  LocalMotionPreference,
  LocalSiblingActionBus,
  ManualClock,
  MemoryCanvasNodeCatalog,
} from "./local-ports.js";
export type {
  BoxChatIntentPort,
  BoxSelectionSync,
  CanvasNodeCatalog,
  CanvasSelectionContextPort,
  CanvasViewportPort,
  ComposerSyncReceipt,
  ComposerTargetPort,
  InspectorShellPort,
  IntentLaunch,
  MotionPreferencePort,
  SiblingActionPort,
  SiblingCall,
} from "./ports.js";
export { NodeTypePopoverRegistry, modelText, popoverOmitsSealedSource } from "./registry.js";
export { MultiBoxSelectionController, selectionPillText } from "./selection.js";
export { CanvasQuickActionToolbar, toolbarActionsFor } from "./toolbar.js";
export {
  ARCHIVED_POPOVER,
  CANONICAL_NODE_TYPES,
  CHOSEN_FOR_YOU,
  FEATURE_RUNTIMES,
  HIGHLIGHT_MS,
  PAN_ZOOM,
  POPOVER_HEIGHT,
  POPOVER_WIDTH,
  PROJECT_STAGES,
  UnknownCanvasNodeTypeError,
  canonicalType,
} from "./types.js";
export type {
  ActiveHighlight,
  CanvasNode,
  GraphDelta,
  PopoverModel,
  VNode,
} from "./types.js";
export {
  SEALED_ORACLE_SOURCE,
  canvasEdges,
  canvasNodes,
  primaryNodes,
} from "./fixtures.js";
