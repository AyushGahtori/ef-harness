import { compareText } from "./canonical-hash.js";
import { normalizeViewPath } from "./paths.js";

/**
 * Held by the direct-edit importer (Task 086) and by this scanner when a view
 * file has dirty unimported bytes or an open conflict card.
 * `KnowledgeViewExporter` must not overwrite a paused file.
 */
export class ExportPauseLock {
  private readonly reasons = new Map<string, string>();

  pause(filePath: string, reason: string): void {
    const key = normalizeViewPath(filePath);
    if (!this.reasons.has(key)) this.reasons.set(key, reason);
  }

  resume(filePath: string): void {
    this.reasons.delete(normalizeViewPath(filePath));
  }

  isPaused(filePath: string): boolean {
    return this.reasons.has(normalizeViewPath(filePath));
  }

  reason(filePath: string): string | null {
    return this.reasons.get(normalizeViewPath(filePath)) ?? null;
  }

  pausedFiles(): readonly string[] {
    return [...this.reasons.keys()].sort(compareText);
  }
}

export interface LeaseToken {
  readonly id: number;
  readonly paths: readonly string[];
}

/** Suppresses watcher events for paths this process is currently writing. */
export class ExportWriteLease {
  private nextId = 1;
  private readonly tokens = new Map<number, ReadonlySet<string>>();

  acquire(filePaths: readonly string[]): LeaseToken {
    const id = this.nextId;
    this.nextId += 1;
    const paths = new Set(filePaths.map((filePath) => normalizeViewPath(filePath)));
    this.tokens.set(id, paths);
    return { id, paths: [...paths].sort(compareText) };
  }

  release(token: LeaseToken): void {
    this.tokens.delete(token.id);
  }

  covers(filePath: string): boolean {
    const key = normalizeViewPath(filePath);
    for (const paths of this.tokens.values()) {
      if (paths.has(key)) return true;
    }
    return false;
  }

  activePaths(): readonly string[] {
    const paths = new Set<string>();
    for (const tokenPaths of this.tokens.values()) {
      for (const filePath of tokenPaths) paths.add(filePath);
    }
    return [...paths].sort(compareText);
  }
}
