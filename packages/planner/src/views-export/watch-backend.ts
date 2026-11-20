import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface WatchEvent {
  readonly type: string;
  readonly path: string;
}

export interface WatchSubscription {
  unsubscribe(): Promise<void>;
}

export interface WatchBackend {
  subscribe(
    directory: string,
    callback: (error: Error | null, events: readonly WatchEvent[]) => void,
  ): Promise<WatchSubscription>;
}

interface ParcelSubscription {
  unsubscribe(): Promise<void>;
}

interface ParcelWatcherModule {
  subscribe(
    directory: string,
    callback: (error: Error | null, events: readonly WatchEvent[]) => void,
  ): Promise<ParcelSubscription>;
}

export async function createParcelWatchBackend(): Promise<WatchBackend> {
  const parcel = await loadParcelWatcher();
  return {
    async subscribe(directory, callback) {
      const subscription = await parcel.subscribe(directory, (error, events) => {
        callback(error, events);
      });
      return {
        async unsubscribe() {
          await subscription.unsubscribe();
        },
      };
    },
  };
}

export async function loadParcelWatcher(): Promise<ParcelWatcherModule> {
  const require = createRequire(import.meta.url);
  const direct = tryRequire(require, "@parcel/watcher");
  if (direct) return direct;
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let hop = 0; hop < 8; hop += 1) {
    const candidate = path.join(dir, "node_modules", "@parcel", "watcher");
    if (existsSync(path.join(candidate, "package.json"))) {
      const loaded = tryRequire(createRequire(path.join(candidate, "package.json")), candidate);
      if (loaded) return loaded;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    "@parcel/watcher is not resolvable from @ef-harness/planner. Add it to that package's dependencies.",
  );
}

function tryRequire(require: NodeRequire, specifier: string): ParcelWatcherModule | null {
  try {
    const loaded: unknown = require(specifier);
    if (!isParcelWatcher(loaded)) return null;
    return loaded;
  } catch {
    return null;
  }
}

function isParcelWatcher(value: unknown): value is ParcelWatcherModule {
  if (typeof value !== "object" || value === null || !("subscribe" in value)) return false;
  return typeof value.subscribe === "function";
}
