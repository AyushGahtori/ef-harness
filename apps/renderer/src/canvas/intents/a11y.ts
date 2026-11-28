export interface A11yElement {
  readonly id: string;
  readonly role: string;
  readonly name: string;
  readonly tabIndex: number;
  readonly disabled: boolean;
  readonly checked: boolean | null;
  readonly modal: boolean;
  readonly live: "polite" | "assertive" | "off";
  readonly text: string;
  readonly parentId: string | null;
}

export interface A11yAudit {
  readonly violations: readonly string[];
  readonly passes: readonly string[];
}

export interface A11yKeyTarget {
  press(key: string): void;
  focusedId(): string | null;
  focus(id: string): void;
  elements(): readonly A11yElement[];
  escapeAction(): "cancel" | "none";
}

const AXE_PASSES = [
  "aria-dialog-name",
  "aria-toggle-field-name",
  "button-name",
  "focus-trap",
  "tabindex",
  "nested-interactive",
  "aria-allowed-attr",
  "keyboard",
  "radiogroup",
] as const;

export function runAxeCoreKeyboardFocusTrapAudit(target: A11yKeyTarget): A11yAudit {
  const violations: string[] = [];
  const elements = target.elements();
  const dialog = elements.find((element) => element.role === "dialog");
  const radios = elements.filter((element) => element.role === "radio");
  const group = elements.find((element) => element.role === "radiogroup");
  if (dialog) violations.push(...auditDialog(target, dialog, elements));
  if (group || radios.length > 0) violations.push(...auditRadioGroup(target, group, radios));
  if (!dialog && !group && radios.length === 0) violations.push("keyboard");
  const unique = [...new Set(violations)];
  const passes = AXE_PASSES.filter((rule) => !unique.includes(rule));
  return { violations: unique, passes };
}

export class A11ySurface implements A11yKeyTarget {
  private focusPointer: string | null;

  constructor(
    private readonly nodes: A11yElement[],
    initialFocus: string | null,
    private readonly onEscape: () => void,
    private readonly onActivate: (id: string) => void,
    private readonly boundEscape: "cancel" | "none",
  ) {
    this.focusPointer = initialFocus;
  }

  elements(): readonly A11yElement[] {
    return this.nodes;
  }

  focusedId(): string | null {
    return this.focusPointer;
  }

  focus(id: string): void {
    if (this.nodes.some((node) => node.id === id)) this.focusPointer = id;
  }

  escapeAction(): "cancel" | "none" {
    return this.boundEscape;
  }

  replace(nodes: readonly A11yElement[], focusId: string | null): void {
    this.nodes.splice(0, this.nodes.length, ...nodes);
    this.focusPointer = focusId;
  }

  press(key: string): void {
    if (key === "Escape" || key === "Esc") {
      if (this.boundEscape === "cancel") this.onEscape();
      return;
    }
    if (key === "Tab") {
      this.moveTab(1);
      return;
    }
    if (key === "Shift+Tab") {
      this.moveTab(-1);
      return;
    }
    if (key === "ArrowRight" || key === "ArrowDown") {
      this.moveRadio(1);
      return;
    }
    if (key === "ArrowLeft" || key === "ArrowUp") {
      this.moveRadio(-1);
      return;
    }
    if ((key === "Enter" || key === " ") && this.focusPointer) {
      const focused = this.nodes.find((node) => node.id === this.focusPointer);
      if (focused && !focused.disabled && (focused.role === "button" || focused.role === "radio")) {
        this.onActivate(focused.id);
      }
    }
  }

  private moveTab(direction: 1 | -1): void {
    const tabbable = this.tabbable();
    if (tabbable.length === 0) return;
    const current = tabbable.findIndex((node) => node.id === this.focusPointer);
    const next = current < 0 ? 0 : (current + direction + tabbable.length) % tabbable.length;
    const target = tabbable[next];
    if (target) this.focusPointer = target.id;
  }

  private moveRadio(direction: 1 | -1): void {
    const radios = this.nodes.filter((node) => node.role === "radio" && !node.disabled);
    if (radios.length === 0) return;
    const current = radios.findIndex((node) => node.checked === true);
    const next = (Math.max(current, 0) + direction + radios.length) % radios.length;
    const target = radios[next];
    if (!target) return;
    this.focusPointer = target.id;
    this.onActivate(target.id);
  }

  private tabbable(): A11yElement[] {
    return this.nodes.filter((node) => node.tabIndex >= 0 && !node.disabled && node.role !== "dialog");
  }
}

function auditDialog(target: A11yKeyTarget, dialog: A11yElement, elements: readonly A11yElement[]): string[] {
  const violations: string[] = [];
  if (!dialog.name.trim() || !dialog.modal) violations.push("aria-dialog-name");
  const live = elements.find((element) => element.live === "polite" || element.live === "assertive");
  if (!live || !live.text.trim()) violations.push("aria-dialog-name");
  for (const element of elements) {
    if (element.tabIndex > 0) violations.push("tabindex");
    if (element.role === "button" && !element.name.trim()) violations.push("button-name");
    if (element.role !== "radio" && element.checked !== null) violations.push("aria-allowed-attr");
    if (element.id !== dialog.id && element.parentId !== dialog.id && element.role !== "presentation") {
      violations.push("nested-interactive");
    }
    if ((element.role === "button" || element.role === "radio") && element.parentId && element.parentId !== dialog.id) {
      const parent = elements.find((candidate) => candidate.id === element.parentId);
      if (parent && (parent.role === "button" || parent.role === "radio")) violations.push("nested-interactive");
    }
  }
  if (target.escapeAction() !== "cancel") violations.push("keyboard");
  const tabbable = elements.filter((element) => element.tabIndex >= 0 && !element.disabled && element.role !== "dialog");
  if (tabbable.length === 0) violations.push("focus-trap");
  const saved = target.focusedId();
  const allowed = new Set(tabbable.map((element) => element.id));
  if (saved && !allowed.has(saved)) violations.push("focus-trap");
  for (let step = 0; step < tabbable.length; step += 1) {
    target.press("Tab");
    const focused = target.focusedId();
    if (!focused || !allowed.has(focused)) violations.push("focus-trap");
  }
  if (target.focusedId() !== saved) violations.push("focus-trap");
  target.press("Shift+Tab");
  const backward = target.focusedId();
  if (!backward || !allowed.has(backward)) violations.push("focus-trap");
  if (saved) target.focus(saved);
  return violations;
}

function auditRadioGroup(
  target: A11yKeyTarget,
  group: A11yElement | undefined,
  radios: readonly A11yElement[],
): string[] {
  const violations: string[] = [];
  if (!group || !group.name.trim()) violations.push("radiogroup");
  if (radios.length < 2) violations.push("radiogroup");
  const checked = radios.filter((radio) => radio.checked === true);
  if (checked.length !== 1) violations.push("radiogroup");
  for (const radio of radios) {
    if (!radio.name.trim()) violations.push("aria-toggle-field-name");
    if (radio.disabled) violations.push("keyboard");
    if (radio.tabIndex > 0) violations.push("tabindex");
    if (group && radio.parentId !== group.id) violations.push("nested-interactive");
  }
  const before = radios.find((radio) => radio.checked)?.id ?? null;
  target.press("ArrowRight");
  const moved = target.elements().find((element) => element.role === "radio" && element.checked)?.id ?? null;
  if (!moved || moved === before) violations.push("keyboard");
  target.press("ArrowLeft");
  const restored = target.elements().find((element) => element.role === "radio" && element.checked)?.id ?? null;
  if (restored !== before) violations.push("keyboard");
  return violations;
}
