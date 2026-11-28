import type { RouterStore } from "./database.js";
import { FocusDraftMissingError, RouterInputError } from "./errors.js";
import type { FocusBinding, InputStartFocus } from "./types.js";

function sameFocus(left: InputStartFocus, right: InputStartFocus): boolean {
  if (left.activeTab !== right.activeTab) return false;
  if (left.openQuestionCardId !== right.openQuestionCardId) return false;
  if (left.openQuestionOptionsVersion !== right.openQuestionOptionsVersion) return false;
  if (left.focusedFeatureId !== right.focusedFeatureId) return false;
  if (left.inspectedTaskId !== right.inspectedTaskId) return false;
  if (left.previewSelectedElement !== right.previewSelectedElement) return false;
  if (left.selectedCanvasNodeIds.length !== right.selectedCanvasNodeIds.length) return false;
  return left.selectedCanvasNodeIds.every((id, index) => id === right.selectedCanvasNodeIds[index]);
}

/**
 * Captures UI context when input starts, not when the user presses Send.
 * The stored focus is immutable. A later popup does not rebind the draft.
 */
export class InputStartFocusSnapshotter {
  constructor(
    private readonly store: RouterStore,
    private readonly now: () => number,
  ) {}

  begin(input: { readonly draftId: string; readonly focus: InputStartFocus; readonly at?: number }): FocusBinding {
    if (input.draftId.trim() === "") throw new RouterInputError("draftId is required");
    const existing = this.store.getFocus(input.draftId);
    if (existing) return existing;
    const binding: FocusBinding = {
      draftId: input.draftId,
      capturedAt: input.at ?? this.now(),
      focus: input.focus,
      liveFocus: input.focus,
      confirmationRequired: false,
    };
    this.store.saveFocus(binding);
    return binding;
  }

  observeUi(input: {
    readonly draftId: string;
    readonly focus: InputStartFocus;
    readonly explicit: boolean;
  }): FocusBinding {
    const existing = this.store.getFocus(input.draftId);
    if (!existing) throw new FocusDraftMissingError(input.draftId);
    const changed = !sameFocus(existing.focus, input.focus);
    const binding: FocusBinding = {
      draftId: existing.draftId,
      capturedAt: existing.capturedAt,
      focus: existing.focus,
      liveFocus: input.focus,
      confirmationRequired: existing.confirmationRequired || (input.explicit && changed),
    };
    this.store.saveFocus(binding);
    return binding;
  }

  bind(draftId: string): FocusBinding {
    const existing = this.store.getFocus(draftId);
    if (!existing) throw new FocusDraftMissingError(draftId);
    return existing;
  }
}
