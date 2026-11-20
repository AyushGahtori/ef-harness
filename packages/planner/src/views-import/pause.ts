import type { ExportPauseLock } from "./types.js";
import { normalizeViewPath } from "./manifest.js";

/** In-memory port of Task 085 `ExportPauseLock`. */
export class LocalExportPauseLock implements ExportPauseLock {
  private readonly held = new Map<string, string>();

  acquire(filePath: string, reason: string): void {
    this.held.set(normalizeViewPath(filePath), reason);
  }

  release(filePath: string): void {
    this.held.delete(normalizeViewPath(filePath));
  }

  isHeld(filePath: string): boolean {
    return this.held.has(normalizeViewPath(filePath));
  }

  heldFiles(): readonly string[] {
    return [...this.held.keys()].sort();
  }

  reason(filePath: string): string | null {
    return this.held.get(normalizeViewPath(filePath)) ?? null;
  }
}
