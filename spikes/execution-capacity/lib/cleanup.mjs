import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { pidAlive } from "./spawn.mjs";

const watchdogPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "watchdog.mjs");

/**
 * @param {string} scratch
 * @param {string} stateFile
 */
export function createCleanup(scratch, stateFile) {
  /** @type {number[]} */
  const pids = [];
  /** @type {Array<{ dispose: () => Promise<void> }>} */
  const resources = [];
  let closed = false;
  const state = { done: false, scratch, pids, parent: process.pid };
  const writeState = () => {
    fs.writeFileSync(stateFile, JSON.stringify(state));
  };
  writeState();
  const watchdog = spawn(process.execPath, [watchdogPath, String(process.pid), stateFile], {
    shell: false,
    windowsHide: true,
    stdio: "ignore",
    detached: false,
  });
  if (watchdog.pid) pids.push(watchdog.pid);
  return {
    scratch,
    track(pid) {
      if (pid && !pids.includes(pid)) pids.push(pid);
      writeState();
    },
    trackResource(resource) {
      resources.push(resource);
      if (resource.pid) this.track(resource.pid);
    },
    async cleanup(reason) {
      if (closed) return;
      closed = true;
      for (const resource of resources.splice(0)) {
        try {
          await resource.dispose();
        } catch {
          // Keep going so scratch is still removed.
        }
      }
      for (const pid of pids) {
        if (pid === watchdog.pid) continue;
        if (pidAlive(pid)) {
          try {
            process.kill(pid);
          } catch {
            // Already gone.
          }
        }
      }
      fs.rmSync(scratch, { recursive: true, force: true });
      state.done = true;
      state.reason = reason;
      writeState();
      if (watchdog.pid && pidAlive(watchdog.pid)) {
        try {
          watchdog.kill();
        } catch {
          // The watchdog exits on its own when done is set.
        }
      }
    },
    installSignals() {
      const handler = () => {
        this.cleanup("SIGINT").finally(() => process.exit(130));
      };
      process.on("SIGINT", handler);
      process.on("SIGBREAK", handler);
      process.on("SIGTERM", handler);
    },
  };
}
