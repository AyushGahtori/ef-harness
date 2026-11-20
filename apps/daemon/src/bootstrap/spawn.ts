import { spawn, type SpawnOptions } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { repositoryRoot } from "./paths.js";

export interface DetachedSpawn {
  readonly command: string;
  readonly args: readonly string[];
  readonly options: SpawnOptions & { detached: true; stdio: "ignore"; windowsHide: true };
  readonly unref: true;
}

export function resolveDaemonRuntime(repoRoot: string, env: NodeJS.ProcessEnv = process.env): {
  readonly command: string;
  readonly viaElectron: boolean;
} {
  if (env.EF_HARNESS_ALLOW_SYSTEM_NODE === "1" && env.EF_HARNESS_NODE_BIN) {
    return { command: env.EF_HARNESS_NODE_BIN, viaElectron: false };
  }
  try {
    const require = createRequire(path.join(repoRoot, "package.json"));
    const resolved: unknown = require("electron");
    if (typeof resolved === "string" && resolved.length > 0) {
      return { command: resolved, viaElectron: true };
    }
  } catch {
    if (env.EF_HARNESS_ALLOW_SYSTEM_NODE !== "1") {
      throw new Error("Electron executable is required to spawn harnessd");
    }
  }
  if (env.EF_HARNESS_ALLOW_SYSTEM_NODE === "1") {
    return { command: process.execPath, viaElectron: false };
  }
  throw new Error("Electron executable is required to spawn harnessd");
}

/**
 * Detached spawn used for `harnessd`. The child is the Electron executable in plain Node mode.
 * Callers must `unref()` so the window process can exit without killing the daemon.
 */
export function buildDetachedHarnessdSpawn(input: {
  readonly command: string;
  readonly scriptArgs: readonly string[];
  readonly env: NodeJS.ProcessEnv;
}): DetachedSpawn {
  const env: NodeJS.ProcessEnv = { ...input.env, ELECTRON_RUN_AS_NODE: "1" };
  return {
    command: input.command,
    args: input.scriptArgs,
    unref: true,
    options: {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
      env,
    },
  };
}

export function spawnDetachedHarnessd(spec: DetachedSpawn): void {
  const child = spawn(spec.command, [...spec.args], spec.options);
  child.unref();
}

export function daemonRepoRoot(moduleDir: string): string {
  return repositoryRoot(moduleDir);
}
