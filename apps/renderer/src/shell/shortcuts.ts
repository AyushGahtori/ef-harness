import { isCenterTabId, isPhaseId, type FocusZone } from "./types.js";

export interface KeyInput {
  key: string;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  meta?: boolean;
}

export interface ShortcutBinding {
  id: string;
  keys: string;
  command: string;
}

export const ShellKeyboardShortcuts = {
  phaseDiscover: { id: "phase-discover", keys: "Ctrl+1", command: "phase:discover" },
  phasePlan: { id: "phase-plan", keys: "Ctrl+2", command: "phase:plan" },
  phaseBuild: { id: "phase-build", keys: "Ctrl+3", command: "phase:build" },
  phaseShip: { id: "phase-ship", keys: "Ctrl+4", command: "phase:ship" },
  toggleLeft: { id: "toggle-left", keys: "Ctrl+B", command: "toggle-left" },
  toggleInspector: { id: "toggle-inspector", keys: "Ctrl+I", command: "toggle-inspector" },
  focusMode: { id: "focus-mode", keys: "Ctrl+.", command: "toggle-focus" },
  dismiss: { id: "dismiss", keys: "Esc", command: "dismiss" },
  emergencyStop: {
    id: "emergency-stop",
    keys: "Ctrl+Shift+Backspace",
    command: "stop-confirm",
  },
  composer: { id: "composer", keys: "Ctrl+Space", command: "dictate" },
  tabNext: { id: "tab-next", keys: "ArrowRight", command: "tab-next" },
  tabPrevious: { id: "tab-previous", keys: "ArrowLeft", command: "tab-previous" },
} as const satisfies Record<string, ShortcutBinding>;

function letter(key: string): string {
  return key.length === 1 ? key.toLowerCase() : key;
}

export function commandForKey(input: KeyInput, focusZone: FocusZone): string | null {
  const key = letter(input.key);
  const ctrl = input.ctrl === true;
  const shift = input.shift === true;
  const alt = input.alt === true;
  if (alt || input.meta) return null;
  if (ctrl && shift && key === "Backspace") return "stop-confirm";
  if (ctrl && !shift && (key === " " || key === "Space")) return "dictate";
  if (ctrl && !shift && key >= "1" && key <= "4") {
    const phase = ["discover", "plan", "build", "ship"][Number(key) - 1];
    return phase && isPhaseId(phase) ? `phase:${phase}` : null;
  }
  if (ctrl && !shift && key === "b") return "toggle-left";
  if (ctrl && !shift && key === "i") return "toggle-inspector";
  if (ctrl && !shift && key === ".") return "toggle-focus";
  if (!ctrl && !shift && key === "Escape") return "dismiss";
  if (!ctrl && !shift && focusZone === "tablist" && key === "ArrowRight") return "tab-next";
  if (!ctrl && !shift && focusZone === "tablist" && key === "ArrowLeft") return "tab-previous";
  if (!ctrl && !shift && focusZone === "tablist" && key === "Home") return "tab-first";
  if (!ctrl && !shift && focusZone === "tablist" && key === "End") return "tab-last";
  return null;
}

export function tabCommand(id: string): string | null {
  return isCenterTabId(id) ? `tab:${id}` : null;
}
