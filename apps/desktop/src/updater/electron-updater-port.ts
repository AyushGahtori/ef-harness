import { createRequire } from "node:module";
import type { ElectronUpdaterPort, UpdateDescriptor } from "./ports.js";

interface AutoUpdaterLike {
  downloadUpdate(): Promise<readonly string[]>;
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
  readonly currentVersion?: { readonly version?: string };
}

function loadAutoUpdater(): AutoUpdaterLike {
  const require = createRequire(import.meta.url);
  const loaded: unknown = require("electron-updater");
  if (!loaded || typeof loaded !== "object" || !("autoUpdater" in loaded)) {
    throw new Error("electron-updater did not export autoUpdater");
  }
  return (loaded as { autoUpdater: AutoUpdaterLike }).autoUpdater;
}

/** Real `electron-updater` binding. Callers inject this port into ParkFirstAutoUpdater. */
export function createElectronUpdaterPort(): ElectronUpdaterPort {
  return {
    async downloadUpdate(): Promise<UpdateDescriptor> {
      const updater = loadAutoUpdater();
      const files = await updater.downloadUpdate();
      const version = updater.currentVersion?.version ?? files[0] ?? "0.0.0";
      return { version };
    },
    quitAndInstall(): void {
      loadAutoUpdater().quitAndInstall(false, true);
    },
  };
}
