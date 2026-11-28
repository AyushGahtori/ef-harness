import { createRequire } from "node:module";

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
  throw new Error(
    "@parcel/watcher is not installed for @ef-harness/integrator. Add it to packages/integrator dependencies.",
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