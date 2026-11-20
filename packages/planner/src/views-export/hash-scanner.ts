import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { digestSha256, normalizeLf } from "./canonical-hash.js";
import { errorCode } from "./fs-error.js";
import type { ExportPauseLock, ExportWriteLease } from "./locks.js";
import { fileContentHash, parseManifest, type ViewManifest } from "./manifest.js";
import { manifestPath, viewRelativeFrom, viewsRoot } from "./paths.js";
import { createParcelWatchBackend, type WatchBackend, type WatchSubscription } from "./watch-backend.js";

export const VIEW_WATCH_DEBOUNCE_MS = 300;

export interface DirtyView {
  readonly filePath: string;
  readonly reason: "offline_edit" | "watcher_delta" | "deleted_on_disk";
  readonly manifestSha256: string | null;
  readonly diskSha256: string | null;
}

export interface ColdOpenReport {
  readonly kind: "missing_views" | "offline_edits" | "clean" | "manifest_unreadable";
  readonly dirtyFiles: readonly DirtyView[];
  readonly suppressed: number;
}

export interface ViewManifestHashScannerOptions {
  readonly projectRoot: string;
  readonly pauseLock: ExportPauseLock;
  readonly lease: ExportWriteLease;
  readonly backend?: WatchBackend;
  readonly debounceMs?: number;
}

/**
 * Debounced `@parcel/watcher` subscription while the app is open, plus a full
 * manifest hash scan on cold open and focus return. Self-writes are ignored
 * when an `ExportWriteLease` covers the path or the on-disk SHA-256 still
 * matches `.manifest.json`.
 */
export class ViewManifestHashScanner {
  private subscription: WatchSubscription | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private flushing: Promise<void> | null = null;
  private suppressed = 0;
  private readonly pending = new Map<string, string>();
  private readonly idle: Array<() => void> = [];
  private readonly listeners = new Set<(view: DirtyView) => void>();
  private readonly debounceMs: number;
  private readonly backend: WatchBackend | null;

  constructor(private readonly options: ViewManifestHashScannerOptions) {
    this.debounceMs = options.debounceMs ?? VIEW_WATCH_DEBOUNCE_MS;
    this.backend = options.backend ?? null;
  }

  onDirty(listener: (view: DirtyView) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  suppressedCount(): number {
    return this.suppressed;
  }

  async scanColdOpen(): Promise<ColdOpenReport> {
    return this.scanManifest("offline_edit");
  }

  async scanOnFocusReturn(): Promise<ColdOpenReport> {
    return this.scanManifest("offline_edit");
  }

  async start(): Promise<void> {
    if (this.subscription) return;
    const directory = viewsRoot(this.options.projectRoot);
    try {
      await access(directory);
    } catch {
      return;
    }
    const backend = this.backend ?? (await createParcelWatchBackend());
    this.subscription = await backend.subscribe(directory, (error, events) => {
      if (error) return;
      for (const event of events) this.enqueue(event.path);
    });
  }

  async stop(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.pending.clear();
    if (this.subscription) {
      await this.subscription.unsubscribe();
      this.subscription = null;
    }
    this.wake();
  }

  whenIdle(): Promise<void> {
    if (this.isIdle()) return Promise.resolve();
    return new Promise((resolve) => {
      let settled = false;
      const finish = (): void => {
        if (settled) return;
        settled = true;
        resolve();
      };
      this.idle.push(finish);
      if (this.isIdle()) {
        const index = this.idle.indexOf(finish);
        if (index >= 0) this.idle.splice(index, 1);
        finish();
      }
    });
  }

  private async scanManifest(reason: DirtyView["reason"]): Promise<ColdOpenReport> {
    const directory = viewsRoot(this.options.projectRoot);
    const manifestFile = manifestPath(this.options.projectRoot);
    const directoryExists = await exists(directory);
    const manifestText = await readText(manifestFile);
    if (!directoryExists || manifestText === null) {
      return { kind: "missing_views", dirtyFiles: [], suppressed: this.suppressed };
    }
    const manifest = parseManifest(manifestText);
    if (!manifest) {
      return { kind: "manifest_unreadable", dirtyFiles: [], suppressed: this.suppressed };
    }
    const dirtyFiles: DirtyView[] = [];
    const seen = new Set<string>();
    for (const record of manifest.records) {
      if (record.nodeId !== "" || seen.has(record.filePath)) continue;
      seen.add(record.filePath);
      const dirty = await this.compareFile(directory, record.filePath, manifest, reason);
      if (!dirty) continue;
      this.options.pauseLock.pause(dirty.filePath, dirty.reason);
      dirtyFiles.push(dirty);
    }
    return {
      kind: dirtyFiles.length > 0 ? "offline_edits" : "clean",
      dirtyFiles,
      suppressed: this.suppressed,
    };
  }

  private enqueue(eventPath: string): void {
    const relative = viewRelativeFrom(viewsRoot(this.options.projectRoot), eventPath);
    if (relative === null || relative.length === 0) return;
    if (relative === ".manifest.json" || relative.startsWith(".tmp.")) {
      this.suppressed += 1;
      return;
    }
    this.pending.set(relative, eventPath);
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flushing = this.flush().finally(() => {
        this.flushing = null;
        this.wake();
      });
    }, this.debounceMs);
  }

  private async flush(): Promise<void> {
    const paths = [...this.pending.keys()];
    this.pending.clear();
    const directory = viewsRoot(this.options.projectRoot);
    const manifest = await this.readManifest();
    for (const relative of paths) {
      const leased = this.options.lease.covers(relative);
      const match = await this.matchesManifest(directory, relative, manifest);
      if (leased || match) {
        this.suppressed += 1;
        continue;
      }
      const dirty = await this.compareFile(directory, relative, manifest, "watcher_delta");
      if (!dirty) {
        this.suppressed += 1;
        continue;
      }
      this.options.pauseLock.pause(dirty.filePath, dirty.reason);
      for (const listener of this.listeners) listener(dirty);
    }
  }

  private async readManifest(): Promise<ViewManifest | null> {
    const text = await readText(manifestPath(this.options.projectRoot));
    if (text === null) return null;
    return parseManifest(text);
  }

  private async matchesManifest(
    directory: string,
    relative: string,
    manifest: ViewManifest | null,
  ): Promise<boolean> {
    if (!manifest) return false;
    const expected = fileContentHash(manifest, relative);
    if (expected === null) return false;
    const disk = await readText(path.join(directory, relative));
    if (disk === null) return false;
    return digestSha256(normalizeLf(disk)) === expected;
  }

  private async compareFile(
    directory: string,
    relative: string,
    manifest: ViewManifest | null,
    reason: DirtyView["reason"],
  ): Promise<DirtyView | null> {
    const expected = manifest ? fileContentHash(manifest, relative) : null;
    const disk = await readText(path.join(directory, relative));
    const diskSha256 = disk === null ? null : digestSha256(normalizeLf(disk));
    if (expected !== null && diskSha256 === expected) return null;
    const resolvedReason = disk === null ? "deleted_on_disk" : reason;
    return {
      filePath: relative,
      reason: resolvedReason,
      manifestSha256: expected,
      diskSha256,
    };
  }

  private isIdle(): boolean {
    return this.timer === null && this.flushing === null && this.pending.size === 0;
  }

  private wake(): void {
    if (!this.isIdle()) return;
    const waiters = this.idle.splice(0);
    for (const waiter of waiters) waiter();
  }
}

async function exists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

async function readText(file: string): Promise<string | null> {
  try {
    return await readFile(file, "utf8");
  } catch (error) {
    if (errorCode(error) === "ENOENT") return null;
    throw error;
  }
}
