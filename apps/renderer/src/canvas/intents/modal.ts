import { A11ySurface, type A11yElement } from "./a11y.js";
import {
  APPLY_CHANGE_LABEL,
  CANCEL_PREVIEW_LABEL,
  EDIT_INSTRUCTION_LABEL,
  type ImpactPreviewTotals,
} from "./types.js";

export interface ModalActions {
  apply(): void;
  edit(): void;
  cancel(): void;
}

export class ZeroTokenImpactPreviewModal {
  readonly surface: A11ySurface;
  readonly actions = [APPLY_CHANGE_LABEL, EDIT_INSTRUCTION_LABEL, CANCEL_PREVIEW_LABEL] as const;

  constructor(
    readonly id: string,
    readonly totals: ImpactPreviewTotals,
    private readonly handlers: ModalActions,
  ) {
    this.surface = new A11ySurface(
      this.nodes(),
      "apply-change",
      () => this.handlers.cancel(),
      (elementId) => this.activate(elementId),
      "cancel",
    );
  }

  press(key: string): void {
    this.surface.press(key);
  }

  private activate(elementId: string): void {
    if (elementId === "apply-change") this.handlers.apply();
    else if (elementId === "edit-instruction") this.handlers.edit();
    else if (elementId === "cancel") this.handlers.cancel();
  }

  private nodes(): A11yElement[] {
    return [
      {
        id: "impact-dialog",
        role: "dialog",
        name: "Impact preview",
        tabIndex: -1,
        disabled: false,
        checked: null,
        modal: true,
        live: "off",
        text: this.totals.plainEnglish,
        parentId: null,
      },
      {
        id: "impact-live",
        role: "status",
        name: "Impact totals",
        tabIndex: -1,
        disabled: false,
        checked: null,
        modal: false,
        live: "assertive",
        text: this.totals.announcement,
        parentId: "impact-dialog",
      },
      button("apply-change", APPLY_CHANGE_LABEL),
      button("edit-instruction", EDIT_INSTRUCTION_LABEL),
      button("cancel", CANCEL_PREVIEW_LABEL),
    ];
  }
}

function button(id: string, name: string): A11yElement {
  return {
    id,
    role: "button",
    name,
    tabIndex: 0,
    disabled: false,
    checked: null,
    modal: false,
    live: "off",
    text: name,
    parentId: "impact-dialog",
  };
}
