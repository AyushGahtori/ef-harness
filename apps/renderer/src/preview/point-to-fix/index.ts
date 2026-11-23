export {
  BeforeAfterBaselineApprover,
  InMemoryVisualBaselineStore,
  verifyCrossViewportAfterFix,
} from "./baseline-approver.js";
export type { VisualBaselineStore } from "./baseline-approver.js";
import { captureElementContext, captureGapRegion } from "./capture.js";

export { captureElementContext, captureGapRegion };
/** Task 161 export: element click + drag-box gap capture. */
export const ElementAndGapContextCapturer = {
  captureElement: captureElementContext,
  captureGap: captureGapRegion,
} as const;
export type { CaptureEnvironment, DomLikeElement } from "./capture.js";
export { bindComposerElementTarget, formatElementTargetLabel } from "./composer-binding.js";
export { POINT_TO_FIX_PICKER_INJECTION_SCRIPT } from "./injection-script.js";
export { PointToFixPickerOverlay } from "./overlay.js";
export { createPointToFixPickerOverlay } from "./picker-facade.js";
export type {
  PointToFixPickerCallbacks,
  PointToFixPickerOverlayOptions,
} from "./picker-facade.js";
export { isEfPickResultMessage, validatePickResultMessage } from "./pick-message.js";
export { parseEfSourceAttribute, validateEfSourceInWorkspace } from "./source-path.js";
export type { SourcePathValidation } from "./source-path.js";
export {
  EF_PICK_RESULT_TYPE,
  PICKER_SHORTCUT,
} from "./types.js";
export type {
  BaselineApprovalState,
  ComposerElementTarget,
  CrossViewportCheckResult,
  EfPickResultMessage,
  ElementPickContext,
  GapPickContext,
  HoverOutlineState,
  PickContextBundle,
  PointToFixMode,
  PreviewTheme,
  PreviewViewportWidth,
  VisualSteerRouteResult,
  VisualSteerV1Output,
} from "./types.js";
export { createVisualSteerRouter, VisualSteerRouter } from "./visual-steer-router.js";
export type { VisualSteerRouterOptions } from "./visual-steer-router.js";