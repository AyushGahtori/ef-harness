import type { OfficeThemeMode } from "./types.js";

/** Consumed from Task 122 `SingleAppShell` theme channel at integration. */
export type ShellThemePort = {
  readTheme: () => OfficeThemeMode;
  onThemeChange: (listener: (mode: OfficeThemeMode) => void) => () => void;
};