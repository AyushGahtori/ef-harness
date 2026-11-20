import { spawn } from "node:child_process";
import type { DaemonProbe } from "./probe.js";

export interface EnsureHarnessdDeps {
  readonly appVersion: string;
  readonly timeoutMs: number;
  probe(): Promise<DaemonProbe | null>;
  parkAndExit(): Promise<void>;
  waitUntilGone(previousPid: number): Promise<void>;
  spawn(): Promise<void>;
}

/** Version-mismatch handover: park the old daemon, wait, then start this app's harnessd. */
export async function ensureHarnessd(deps: EnsureHarnessdDeps): Promise<DaemonProbe> {
  const current = await deps.probe();
  if (current && current.daemonVersion !== deps.appVersion) {
    await deps.parkAndExit();
    await deps.waitUntilGone(current.pid);
    await deps.spawn();
  } else if (!current) {
    await deps.spawn();
  }
  const deadline = Date.now() + deps.timeoutMs;
  while (Date.now() < deadline) {
    const next = await deps.probe();
    if (next && next.daemonVersion === deps.appVersion) return next;
    await delay(50);
  }
  throw new Error("harnessd did not become ready");
}

export interface DetachedLaunch {
  readonly command: string;
  readonly args: readonly string[];
  readonly env: NodeJS.ProcessEnv;
}

export function launchDetached(spec: DetachedLaunch): void {
  const child = spawn(spec.command, [...spec.args], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
    env: { ...spec.env, ELECTRON_RUN_AS_NODE: "1" },
  });
  child.unref();
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
