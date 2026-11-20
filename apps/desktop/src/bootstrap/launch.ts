import crypto from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
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
    await delay(100);
  }
  throw new Error("harnessd did not become ready");
}

export interface DetachedLaunch {
  readonly command: string;
  readonly args: readonly string[];
  readonly env: NodeJS.ProcessEnv;
}

export function launchDetached(spec: DetachedLaunch): void {
  const env: NodeJS.ProcessEnv = { ...spec.env, ELECTRON_RUN_AS_NODE: "1" };
  if (process.platform === "win32") {
    launchOutsideJob(spec.command, spec.args, env);
    return;
  }
  const child = spawn(spec.command, [...spec.args], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
    env,
  });
  child.unref();
}

/**
 * Electron's Windows job kills child processes when the shell exits.
 * Start-Process breaks harnessd out of that job so a closed viewer cannot stop a build.
 */
function launchOutsideJob(command: string, args: readonly string[], env: NodeJS.ProcessEnv): void {
  const file = path.join(os.tmpdir(), `ef-harnessd-launch-${process.pid}-${crypto.randomBytes(4).toString("hex")}.ps1`);
  const lines: string[] = [];
  for (const [key, value] of Object.entries(env)) {
    if (typeof value !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    lines.push(`$env:${key} = ${psQuote(value)}`);
  }
  const argList = args.map((arg) => psQuote(arg)).join(", ");
  const argumentList = args.length > 0 ? ` -ArgumentList ${argList}` : "";
  lines.push(`Start-Process -FilePath ${psQuote(command)}${argumentList} -WindowStyle Hidden`);
  lines.push("Remove-Item -LiteralPath $PSCommandPath -Force");
  fs.writeFileSync(file, `${lines.join("\r\n")}\r\n`, "utf8");
  const started = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", file],
    { windowsHide: true, encoding: "utf8", timeout: 20_000 },
  );
  if (started.status !== 0) {
    const detail = `${started.stdout ?? ""}\n${started.stderr ?? ""}`.trim();
    throw new Error(detail.length > 0 ? detail : `harnessd launcher exited ${started.status}`);
  }
}

function psQuote(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
