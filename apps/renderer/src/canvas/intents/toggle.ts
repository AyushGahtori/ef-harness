import { A11ySurface, type A11yElement } from "./a11y.js";
import type { ToggleMode } from "./types.js";

export class CorrectVsChangeTogglePreset {
  readonly locked = false as const;
  readonly options = ["correct", "change"] as const;
  readonly surface: A11ySurface;
  private modeValue: ToggleMode;

  constructor(initial: ToggleMode) {
    this.modeValue = initial;
    this.surface = new A11ySurface(this.nodes(initial), initial, () => undefined, (id) => this.activate(id), "none");
  }

  get mode(): ToggleMode {
    return this.modeValue;
  }

  press(key: string): void {
    this.surface.press(key);
  }

  private activate(id: string): void {
    if (id !== "correct" && id !== "change") return;
    this.modeValue = id;
    this.surface.replace(this.nodes(id), id);
  }

  private nodes(mode: ToggleMode): A11yElement[] {
    return [
      {
        id: "correct-change",
        role: "radiogroup",
        name: "Correct (misheard) or Change",
        tabIndex: -1,
        disabled: false,
        checked: null,
        modal: false,
        live: "off",
        text: "",
        parentId: null,
      },
      radio("correct", "Correct (misheard)", mode === "correct"),
      radio("change", "Change", mode === "change"),
      {
        id: "toggle-live",
        role: "status",
        name: "Selected edit kind",
        tabIndex: -1,
        disabled: false,
        checked: null,
        modal: false,
        live: "polite",
        text: mode === "correct" ? "Correct (misheard) selected" : "Change selected",
        parentId: "correct-change",
      },
    ];
  }
}

function radio(id: ToggleMode, name: string, checked: boolean): A11yElement {
  return {
    id,
    role: "radio",
    name,
    tabIndex: 0,
    disabled: false,
    checked,
    modal: false,
    live: "off",
    text: name,
    parentId: "correct-change",
  };
}
