import type { ShellThemePort } from "./ports.js";
import type { OfficeThemeMode } from "./types.js";

export class MemoryShellThemePort implements ShellThemePort {
  private mode: OfficeThemeMode = "light";
  private listeners = new Set<(mode: OfficeThemeMode) => void>();

  readTheme(): OfficeThemeMode {
    return this.mode;
  }

  setTheme(mode: OfficeThemeMode): void {
    this.mode = mode;
    for (const listener of this.listeners) {
      listener(mode);
    }
  }

  onThemeChange(listener: (mode: OfficeThemeMode) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}