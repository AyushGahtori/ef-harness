import type { ThemePreference } from "./types.js";

export interface ShellPanePreferences {
  leftWidthPx: number;
  leftCollapsed: boolean;
  inspectorWidthPx: number;
  inspectorCollapsed: boolean;
  theme: ThemePreference;
  focusMode: boolean;
}

export interface ShellPreferenceStore {
  read(windowId: string): ShellPanePreferences | null;
  write(windowId: string, prefs: ShellPanePreferences): void;
}

export class MemoryPreferenceStore implements ShellPreferenceStore {
  readonly saved = new Map<string, ShellPanePreferences>();

  read(windowId: string): ShellPanePreferences | null {
    const found = this.saved.get(windowId);
    return found ? { ...found } : null;
  }

  write(windowId: string, prefs: ShellPanePreferences): void {
    this.saved.set(windowId, { ...prefs });
  }
}

export const DEFAULT_PREFERENCES: ShellPanePreferences = {
  leftWidthPx: 360,
  leftCollapsed: false,
  inspectorWidthPx: 380,
  inspectorCollapsed: false,
  theme: "system",
  focusMode: false,
};
